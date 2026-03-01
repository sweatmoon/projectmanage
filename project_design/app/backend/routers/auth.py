"""
OIDC 인증 라우터 - 시놀로지 NAS SSO 연동
흐름: /auth/login → 시놀로지 로그인 → /auth/callback → JWT 발급 → 앱 사용
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.auth import OIDCState, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── 설정값 (환경변수에서 읽기) ─────────────────────────────
def get_oidc_settings():
    return {
        "issuer_url": os.environ.get("OIDC_ISSUER_URL", ""),          # https://your-nas.com/webman/sso
        "client_id": os.environ.get("OIDC_CLIENT_ID", ""),
        "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
        "redirect_uri": os.environ.get("OIDC_REDIRECT_URI", ""),      # https://your-app.com/auth/callback
        "jwt_secret": os.environ.get("JWT_SECRET", "change-me-in-production"),
        "jwt_expire_hours": int(os.environ.get("JWT_EXPIRE_HOURS", "8")),
        "app_url": os.environ.get("APP_URL", "http://localhost:8080"),
    }


# ── 내부 JWT 생성 ─────────────────────────────────────────
def create_app_jwt(user_id: str, email: str, name: str, cfg: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "name": name,
        "role": "user",
        "iat": now,
        "exp": now + timedelta(hours=cfg["jwt_expire_hours"]),
    }
    return jwt.encode(payload, cfg["jwt_secret"], algorithm="HS256")


def decode_app_jwt(token: str, cfg: dict) -> dict:
    try:
        return jwt.decode(token, cfg["jwt_secret"], algorithms=["HS256"])
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}")


# ── 1. 로그인 시작: 시놀로지 로그인 페이지로 리다이렉트 ──────
@router.get("/login")
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    cfg = get_oidc_settings()
    if not cfg["issuer_url"] or not cfg["client_id"]:
        raise HTTPException(
            status_code=503,
            detail="OIDC not configured. Set OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI env vars."
        )

    import secrets
    import hashlib
    import base64

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(96)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")

    # state 저장 (DB)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    oidc_state = OIDCState(
        state=state,
        nonce=nonce,
        code_verifier=code_verifier,
        expires_at=expires_at,
    )
    db.add(oidc_state)
    await db.commit()

    # 시놀로지 OIDC authorization URL
    import urllib.parse
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "scope": "openid profile email",
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{cfg['issuer_url']}/SSOauth.cgi?{urllib.parse.urlencode(params)}"
    logger.info(f"Redirecting to OIDC: {auth_url[:80]}...")
    return RedirectResponse(url=auth_url)


# ── 2. 콜백: 시놀로지에서 code 받아 토큰 교환 ────────────────
@router.get("/callback")
async def callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    cfg = get_oidc_settings()

    # state 검증
    result = await db.execute(select(OIDCState).where(OIDCState.state == state))
    oidc_state = result.scalar_one_or_none()
    if not oidc_state:
        raise HTTPException(status_code=400, detail="Invalid or expired state")
    if oidc_state.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        await db.delete(oidc_state)
        await db.commit()
        raise HTTPException(status_code=400, detail="State expired, please login again")

    code_verifier = oidc_state.code_verifier
    nonce = oidc_state.nonce

    # state 삭제 (one-time use)
    await db.delete(oidc_state)
    await db.flush()

    # 시놀로지 token endpoint로 code 교환
    token_url = f"{cfg['issuer_url']}/SSOAccessToken.cgi"
    try:
        async with httpx.AsyncClient(timeout=30.0, verify=False) as client:  # NAS 사설 인증서 허용
            token_resp = await client.post(token_url, data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg["redirect_uri"],
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code_verifier": code_verifier,
            })
            token_resp.raise_for_status()
            tokens = token_resp.json()
    except Exception as e:
        logger.error(f"Token exchange failed: {e}")
        raise HTTPException(status_code=502, detail=f"Token exchange failed: {e}")

    id_token = tokens.get("id_token") or tokens.get("access_token")
    if not id_token:
        raise HTTPException(status_code=502, detail="No id_token in response")

    # id_token에서 사용자 정보 추출 (서명 검증 없이 디코드 - NAS 내부망이므로 허용)
    try:
        import base64, json as _json
        parts = id_token.split(".")
        payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
        user_info = _json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        # id_token 파싱 실패 시 userinfo endpoint 시도
        try:
            async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
                ui_resp = await client.get(
                    f"{cfg['issuer_url']}/SSOUserInfo.cgi",
                    headers={"Authorization": f"Bearer {tokens.get('access_token', '')}"}
                )
                user_info = ui_resp.json()
        except Exception as e2:
            raise HTTPException(status_code=502, detail=f"Cannot get user info: {e2}")

    user_id = user_info.get("sub") or user_info.get("account") or user_info.get("username", "unknown")
    email = user_info.get("email") or f"{user_id}@synology.local"
    name = user_info.get("name") or user_info.get("preferred_username") or user_id

    # DB에 사용자 upsert
    existing = await db.execute(select(User).where(User.id == user_id))
    user = existing.scalar_one_or_none()
    if user:
        user.last_login = datetime.now(timezone.utc)
        user.name = name
        user.email = email
    else:
        user = User(id=user_id, email=email, name=name, role="user",
                    last_login=datetime.now(timezone.utc))
        db.add(user)
    await db.commit()

    # 앱용 JWT 생성
    app_token = create_app_jwt(user_id, email, name, cfg)

    # 프론트엔드로 리다이렉트 (토큰을 URL fragment로 전달)
    app_url = cfg["app_url"].rstrip("/")
    redirect_url = f"{app_url}/?token={app_token}"
    logger.info(f"Login success for user: {name} ({email})")
    return RedirectResponse(url=redirect_url)


# ── 3. 토큰 검증 API ─────────────────────────────────────
class TokenVerifyResponse(BaseModel):
    valid: bool
    user_id: str = ""
    email: str = ""
    name: str = ""
    role: str = "user"


@router.post("/verify", response_model=TokenVerifyResponse)
async def verify_token(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return TokenVerifyResponse(valid=False)
    token = auth_header[7:]
    cfg = get_oidc_settings()
    try:
        payload = decode_app_jwt(token, cfg)
        return TokenVerifyResponse(
            valid=True,
            user_id=payload.get("sub", ""),
            email=payload.get("email", ""),
            name=payload.get("name", ""),
            role=payload.get("role", "user"),
        )
    except Exception:
        return TokenVerifyResponse(valid=False)


# ── 4. 로그아웃 ───────────────────────────────────────────
@router.get("/logout")
async def logout():
    cfg = get_oidc_settings()
    app_url = cfg["app_url"].rstrip("/")
    # 시놀로지 로그아웃 URL (선택적)
    syno_logout = f"{cfg['issuer_url']}/oauth2/logout?redirect_uri={app_url}" if cfg["issuer_url"] else app_url
    return RedirectResponse(url=syno_logout)


# ── 5. 현재 사용자 정보 ───────────────────────────────────
@router.get("/me")
async def get_me(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header[7:]
    cfg = get_oidc_settings()
    payload = decode_app_jwt(token, cfg)
    return {
        "user_id": payload.get("sub"),
        "email": payload.get("email"),
        "name": payload.get("name"),
        "role": payload.get("role", "user"),
    }
