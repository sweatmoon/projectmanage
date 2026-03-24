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
from models.auth import OIDCState, User, AllowedUser

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
def create_app_jwt(user_id: str, email: str, name: str, cfg: dict, role: str = "user") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "name": name,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=cfg["jwt_expire_hours"]),
    }
    return jwt.encode(payload, cfg["jwt_secret"], algorithm="HS256")


def decode_app_jwt(token: str, cfg: dict) -> dict:
    try:
        return jwt.decode(token, cfg["jwt_secret"], algorithms=["HS256"])
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}")


# ── 0. 개발환경 전용 로그인 (OIDC 미설정 시만 활성화) ────────
@router.get("/dev-login")
async def dev_login(db: AsyncSession = Depends(get_db)):
    """OIDC 미설정 개발환경에서 미리보기용 admin 토큰 발급"""
    cfg = get_oidc_settings()
    # OIDC가 설정된 프로덕션 환경에서는 절대 사용 불가
    if cfg["issuer_url"]:
        raise HTTPException(status_code=403, detail="개발 환경에서만 사용 가능합니다.")

    user_id = "dev_admin"
    email = "dev@localhost"
    name = "개발자(미리보기)"
    role = "admin"

    # DB에 dev user upsert
    from sqlalchemy import select
    existing = await db.execute(select(User).where(User.id == user_id))
    user = existing.scalar_one_or_none()
    if user:
        user.last_login = datetime.now(timezone.utc)
    else:
        user = User(id=user_id, email=email, name=name, role=role,
                    last_login=datetime.now(timezone.utc))
        db.add(user)
    await db.commit()

    token = create_app_jwt(user_id, email, name, cfg, role=role)

    # 개발환경 로그인 감사 로그
    try:
        from services.audit_service import write_audit_log, EventType, EntityType
        await write_audit_log(
            db,
            event_type=EventType.LOGIN,
            entity_type=EntityType.USER,
            entity_id=user_id,
            user_id=user_id,
            user_name=name,
            user_role=role,
            request_path="/auth/dev-login",
            description="개발 환경 로그인 (auto admin)",
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"Dev login audit log failed: {e}")

    app_url = cfg["app_url"].rstrip("/")
    return RedirectResponse(url=f"{app_url}/?token={token}")


# ── 0b. 개발환경 전용 일반사용자 로그인 (OIDC 미설정 시만 활성화) ─
@router.get("/dev-login-user")
async def dev_login_user(db: AsyncSession = Depends(get_db)):
    """OIDC 미설정 개발환경에서 일반 사용자(user role) 미리보기 토큰 발급"""
    cfg = get_oidc_settings()
    if cfg["issuer_url"]:
        raise HTTPException(status_code=403, detail="개발 환경에서만 사용 가능합니다.")

    user_id = "dev_user"
    email = "user@preview.local"
    name = "일반사용자(미리보기)"
    role = "user"

    from sqlalchemy import select
    existing = await db.execute(select(User).where(User.id == user_id))
    user = existing.scalar_one_or_none()
    if user:
        user.last_login = datetime.now(timezone.utc)
    else:
        user = User(id=user_id, email=email, name=name, role=role,
                    last_login=datetime.now(timezone.utc))
        db.add(user)
    await db.commit()

    token = create_app_jwt(user_id, email, name, cfg, role=role)

    try:
        from services.audit_service import write_audit_log, EventType, EntityType
        await write_audit_log(
            db,
            event_type=EventType.LOGIN,
            entity_type=EntityType.USER,
            entity_id=user_id,
            user_id=user_id,
            user_name=name,
            user_role=role,
            request_path="/auth/dev-login-user",
            description="개발 환경 일반사용자 로그인 (미리보기)",
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"Dev login user audit log failed: {e}")

    app_url = cfg["app_url"].rstrip("/")
    return RedirectResponse(url=f"{app_url}/?token={token}")


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
        "scope": "openid email",  # Synology SSO: profile 미지원, openid+email만 사용
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    # 시놀로지 SSO 실제 엔드포인트: SSOOauth.cgi (well-known 기준)
    auth_url = f"{cfg['issuer_url']}/SSOOauth.cgi?{urllib.parse.urlencode(params)}"
    logger.info(f"Redirecting to OIDC: {auth_url[:80]}...")
    return RedirectResponse(url=auth_url)


# ── 2. 콜백: 시놀로지에서 code 받아 토큰 교환 ────────────────
@router.get("/callback")
async def callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    cfg = get_oidc_settings()
    app_url = cfg["app_url"].rstrip("/") if cfg["app_url"] else str(request.base_url).rstrip("/")

    def error_redirect(msg: str, detail: str = ""):
        """오류 시 프론트엔드 에러 페이지로 리다이렉트"""
        logger.error(f"Auth callback error: {msg} | {detail}")
        from urllib.parse import quote
        return RedirectResponse(url=f"{app_url}/?auth_error={quote(msg)}", status_code=302)

    # state 검증
    result = await db.execute(select(OIDCState).where(OIDCState.state == state))
    oidc_state = result.scalar_one_or_none()
    if not oidc_state:
        return error_redirect("로그인 세션이 만료되었습니다. 다시 시도해주세요.", "Invalid state")
    if oidc_state.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        await db.delete(oidc_state)
        await db.commit()
        return error_redirect("로그인 세션이 만료되었습니다. 다시 시도해주세요.", "State expired")

    code_verifier = oidc_state.code_verifier
    nonce = oidc_state.nonce

    logger.info(f"Callback: state={state[:8]}... code={code[:8]}... code_verifier_len={len(code_verifier)}")

    # state 삭제 (one-time use)
    await db.delete(oidc_state)
    await db.flush()

    # 시놀로지 token endpoint로 code 교환
    token_url = f"{cfg['issuer_url']}/SSOAccessToken.cgi"

    async def _exchange_token(use_pkce: bool) -> dict | None:
        """토큰 교환 시도. use_pkce=True면 code_verifier 포함, False면 PKCE 생략."""
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": cfg["redirect_uri"],
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
        }
        if use_pkce:
            data["code_verifier"] = code_verifier
        pkce_label = "with PKCE" if use_pkce else "without PKCE"
        logger.info(f"Trying token exchange {pkce_label}: {token_url}")
        try:
            async with httpx.AsyncClient(timeout=30.0, verify=False) as client:
                resp = await client.post(token_url, data=data)
                logger.info(f"SSOAccessToken [{pkce_label}] status: {resp.status_code}")
                logger.info(f"SSOAccessToken [{pkce_label}] body: {resp.text[:500]}")
                try:
                    result = resp.json()
                except Exception:
                    result = {}
                if resp.status_code < 400 and not result.get("error"):
                    return result  # 성공
                logger.warning(f"Token exchange {pkce_label} failed: {result.get('error', resp.status_code)}")
                return None
        except Exception as e:
            logger.error(f"Token exchange {pkce_label} exception: {e}")
            return None

    # 1차 시도: PKCE 포함
    tokens = await _exchange_token(use_pkce=True)

    # 2차 시도: PKCE 없이 (일부 Synology DSM 설정에서 PKCE 비활성화)
    if tokens is None:
        logger.warning("PKCE token exchange failed, retrying without PKCE...")
        tokens = await _exchange_token(use_pkce=False)

    if tokens is None:
        return error_redirect(
            "SSO 인증 실패: 토큰 교환 오류",
            f"PKCE/non-PKCE 모두 실패 | URL: {token_url} | redirect_uri: {cfg['redirect_uri']}"
        )

    logger.info(f"SSO token response keys: {list(tokens.keys())}")

    import base64 as _b64, json as _json

    logger.info(f"SSO token response keys: {list(tokens.keys())}")

    # ── 사용자 정보 추출 우선순위 ─────────────────────────────
    # 1) id_token JWT 디코드
    # 2) SSOUserInfo.cgi 조회
    # 3) tokens에 직접 포함된 account/username 필드
    user_info: dict = {}

    # 1. id_token 디코드 시도
    id_token = tokens.get("id_token", "")
    if id_token and id_token.count(".") == 2:
        try:
            payload_b64 = id_token.split(".")[1]
            payload_b64 += "=" * (4 - len(payload_b64) % 4)
            user_info = _json.loads(_b64.urlsafe_b64decode(payload_b64))
            logger.info(f"id_token claims: {list(user_info.keys())}")
        except Exception as e:
            logger.warning(f"id_token decode failed: {e}")

    # 2. UserInfo endpoint 조회 (id_token에 sub 없을 때)
    if not user_info.get("sub") and not user_info.get("account"):
        try:
            access_token = tokens.get("access_token", "")
            async with httpx.AsyncClient(timeout=15.0, verify=False) as hc:
                ui_resp = await hc.get(
                    f"{cfg['issuer_url']}/SSOUserInfo.cgi",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if ui_resp.status_code == 200:
                    ui_data = ui_resp.json()
                    logger.info(f"SSOUserInfo response keys: {list(ui_data.keys())}")
                    user_info.update(ui_data)
        except Exception as e:
            logger.warning(f"SSOUserInfo.cgi failed: {e}")

    # 3. tokens 자체에 account 정보가 있는 경우 (일부 DSM 버전)
    if not user_info.get("sub") and not user_info.get("account"):
        for k in ("account", "username", "user", "userid", "user_id"):
            if tokens.get(k):
                user_info["account"] = tokens[k]
                logger.info(f"Using tokens['{k}'] as user_id: {tokens[k]}")
                break

    if not user_info:
        logger.error(f"No user info. Full token response: {tokens}")
        return error_redirect("사용자 정보를 가져올 수 없습니다. NAS SSO 설정을 확인하세요.", str(tokens))

    user_id = (user_info.get("sub") or user_info.get("account")
               or user_info.get("username") or user_info.get("preferred_username", "unknown"))
    email = user_info.get("email") or f"{user_id}@synology.local"
    name  = (user_info.get("name") or user_info.get("preferred_username")
             or user_info.get("display_name") or user_id)
    logger.info(f"Resolved user → id={user_id!r}, name={name!r}, email={email!r}")

    # ── 접속 허용 목록 체크 ────────────────────────────────────
    # AllowedUser 테이블에 등록된 사용자만 접근 허용
    # (테이블이 비어있으면 모든 사용자 허용 - 초기 설정 편의를 위해)
    allowed_count_result = await db.execute(select(AllowedUser).limit(1))
    has_allowlist = allowed_count_result.scalar_one_or_none() is not None

    if has_allowlist:
        allowed_result = await db.execute(
            select(AllowedUser).where(
                AllowedUser.user_id == user_id,
                AllowedUser.is_active == True,
            )
        )
        allowed_entry = allowed_result.scalar_one_or_none()
        if not allowed_entry:
            logger.warning(f"Access denied for user {user_id!r} - not in allowlist")
            app_url = get_oidc_settings()["app_url"].rstrip("/")
            return RedirectResponse(
                url=f"{app_url}/logged-out?reason=not_allowed"
            )
        # 허용 목록의 role을 우선 사용 (admin 환경변수보다 DB 설정 우선)
        role = allowed_entry.role
        is_admin = role == "admin"
    else:
        # 허용 목록이 비어있으면 ADMIN_USERS 환경변수로 폴백
        admin_users = [u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()]
        is_admin = user_id in admin_users or email in admin_users
        role = "admin" if is_admin else "user"

    # ADMIN_USERS 환경변수로 admin 역할 자동 지정 (허용 목록 없을 때 폴백)
    admin_users = [u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()]
    if not has_allowlist:
        is_admin = user_id in admin_users or email in admin_users
        role = "admin" if is_admin else "user"

    # DB에 사용자 upsert + 마지막 로그인 시간 확인 (중복 로그 방지용)
    existing = await db.execute(select(User).where(User.id == user_id))
    user = existing.scalar_one_or_none()
    now_utc = datetime.now(timezone.utc)

    # 5분 내 재로그인이면 SSO 자동 재인증으로 판단 → 로그 기록 스킵
    is_duplicate_login = False
    if user and user.last_login:
        last = user.last_login.replace(tzinfo=timezone.utc) if user.last_login.tzinfo is None else user.last_login
        if (now_utc - last).total_seconds() < 300:
            is_duplicate_login = True
            logger.info(f"Duplicate SSO login skipped for {user_id} (last: {last})")

    if user:
        user.last_login = now_utc
        user.name = name
        user.email = email
        user.role = role  # allowed_entry.role (admin/user/viewer) 또는 폴백 role 동기화
    else:
        user = User(id=user_id, email=email, name=name, role=role, last_login=now_utc)
        db.add(user)
    await db.commit()

    # 중복 로그인이 아닐 때만 감사/접속 로그 기록
    if not is_duplicate_login:
        try:
            from services.audit_service import write_audit_log, EventType, EntityType
            await write_audit_log(
                db,
                event_type=EventType.LOGIN,
                entity_type=EntityType.USER,
                entity_id=user_id,
                user_id=user_id,
                user_name=name,
                user_role=role,
                client_ip=_get_client_ip(request),
                user_agent=request.headers.get("User-Agent", ""),
                request_path="/auth/callback",
                description=f"로그인: {name} ({email}) role={role}",
            )
            await db.commit()
        except Exception as e:
            logger.warning(f"Audit log write failed: {e}")

        try:
            from models.auth import AccessLog
            from middlewares.auth_middleware import _get_client_ip
            log = AccessLog(
                user_id=user_id,
                user_email=email,
                user_name=name,
                action="login",
                method="GET",
                path="/auth/callback",
                status_code=302,
                ip_address=_get_client_ip(request),
                user_agent=request.headers.get("User-Agent", ""),
            )
            db.add(log)
            await db.commit()
        except Exception as e:
            logger.warning(f"Login log write failed: {e}")

    # 앱용 JWT 생성 (role 포함)
    app_token = create_app_jwt(user_id, email, name, cfg, role=role)

    # 프론트엔드로 리다이렉트 (토큰을 URL 쿼리 파라미터로 전달)
    # APP_URL 환경변수 우선, 없으면 요청 base_url(역방향 프록시 헤더 반영) 사용
    app_url = cfg["app_url"].rstrip("/") if cfg["app_url"] else str(request.base_url).rstrip("/")
    redirect_url = f"{app_url}/?token={app_token}"
    logger.info(f"Login success for user: {name} ({email}) role={role} → {app_url}")
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
async def logout(request: Request, db: AsyncSession = Depends(get_db)):
    cfg = get_oidc_settings()
    # 감사 로그 기록 (토큰에서 사용자 정보 추출)
    try:
        auth_header = request.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else ""
        from services.audit_service import write_audit_log, EventType, EntityType
        if token:
            payload = decode_app_jwt(token, cfg)
            user_id = payload.get("sub", "unknown")
            user_name = payload.get("name", "")
            user_role = payload.get("role", "user")
        else:
            user_id, user_name, user_role = "unknown", "", "user"
        await write_audit_log(
            db,
            event_type=EventType.LOGOUT,
            entity_type=EntityType.USER,
            entity_id=user_id,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            client_ip=request.client.host if request.client else "unknown",
            user_agent=request.headers.get("User-Agent", ""),
            request_path="/auth/logout",
            description=f"로그아웃: {user_name}",
        )
        await db.commit()
    except Exception as e:
        logger.warning(f"Logout audit log failed: {e}")

    app_url = cfg["app_url"].rstrip("/")
    # Synology SSO는 oauth2/logout 미지원 → 앱 로그인 페이지로 이동
    return RedirectResponse(url=f"{app_url}/auth/login")


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
