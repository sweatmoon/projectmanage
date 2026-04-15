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
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.database import get_db
from models.auth import OIDCState, User, PendingUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# 인증 라우터 전용 limiter (엄격한 제한: brute-force 방어)
_auth_limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")

# ── Google OAuth 엔드포인트 상수 ─────────────────────────
GOOGLE_TOKEN_URL    = "https://oauth2.googleapis.com/token"
GOOGLE_AUTH_URL     = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


# ── 설정값 (환경변수에서 읽기) ─────────────────────────────
def get_oidc_settings():
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    use_google = bool(google_client_id)
    return {
        # Google OAuth (우선)
        "use_google": use_google,
        "google_client_id": google_client_id,
        "google_client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        # Synology SSO (폴백)
        "issuer_url": os.environ.get("OIDC_ISSUER_URL", ""),
        "client_id": google_client_id if use_google else os.environ.get("OIDC_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", "") if use_google else os.environ.get("OIDC_CLIENT_SECRET", ""),
        # 공통
        "redirect_uri": os.environ.get("OIDC_REDIRECT_URI", ""),
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
    if cfg["issuer_url"] or cfg["use_google"]:
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
    if cfg["issuer_url"] or cfg["use_google"]:
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


# ── 1. 로그인 시작 ──────────────────────────────────────────
@router.get("/login")
@_auth_limiter.limit("20/minute")  # 로그인 시도 분당 20회 제한
async def login(request: Request, db: AsyncSession = Depends(get_db)):
    cfg = get_oidc_settings()
    if not cfg["use_google"] and not cfg["issuer_url"]:
        raise HTTPException(
            status_code=503,
            detail="Auth not configured. Set GOOGLE_CLIENT_ID or OIDC_ISSUER_URL."
        )

    import secrets, hashlib, base64, urllib.parse

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(96)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.add(OIDCState(state=state, nonce=nonce, code_verifier=code_verifier, expires_at=expires_at))
    await db.commit()

    if cfg["use_google"]:
        # ── Google OAuth 2.0 ─────────────────────────────
        params = {
            "response_type": "code",
            "client_id": cfg["google_client_id"],
            "redirect_uri": cfg["redirect_uri"],
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "access_type": "offline",
            "prompt": "select_account",
        }
        auth_url = f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
        logger.info(f"Redirecting to Google OAuth: {auth_url[:80]}...")
    else:
        # ── Synology SSO (폴백) ──────────────────────────
        params = {
            "response_type": "code",
            "client_id": cfg["client_id"],
            "redirect_uri": cfg["redirect_uri"],
            "scope": "openid email",
            "state": state, "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        auth_url = f"{cfg['issuer_url']}/SSOOauth.cgi?{urllib.parse.urlencode(params)}"
        logger.info(f"Redirecting to Synology SSO: {auth_url[:80]}...")

    return RedirectResponse(url=auth_url)


# ── 2. 콜백: code 받아 토큰 교환 ─────────────────────────────
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
    await db.delete(oidc_state)
    await db.flush()

    import base64 as _b64, json as _json
    user_info: dict = {}

    if cfg["use_google"]:
        # ── Google OAuth 토큰 교환 ───────────────────────
        try:
            async with httpx.AsyncClient(timeout=30.0) as hc:
                token_resp = await hc.post(GOOGLE_TOKEN_URL, data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": cfg["redirect_uri"],
                    "client_id": cfg["google_client_id"],
                    "client_secret": cfg["google_client_secret"],
                })
                logger.info(f"Google token status: {token_resp.status_code}")
                tokens = token_resp.json()
                if token_resp.status_code >= 400 or tokens.get("error"):
                    return error_redirect(
                        f"Google 인증 오류: {tokens.get('error', token_resp.status_code)}",
                        tokens.get("error_description", token_resp.text[:200])
                    )
        except Exception as e:
            return error_redirect("Google 서버 연결 실패", str(e))

        # id_token에서 사용자 정보 추출
        id_token = tokens.get("id_token", "")
        if id_token and id_token.count(".") == 2:
            try:
                pb = id_token.split(".")[1]; pb += "=" * (4 - len(pb) % 4)
                user_info = _json.loads(_b64.urlsafe_b64decode(pb))
                logger.info(f"Google id_token claims: {list(user_info.keys())}")
            except Exception as e:
                logger.warning(f"id_token decode failed: {e}")
        if not user_info.get("sub"):
            try:
                async with httpx.AsyncClient(timeout=15.0) as hc:
                    ui = await hc.get(GOOGLE_USERINFO_URL,
                        headers={"Authorization": f"Bearer {tokens.get('access_token', '')}"})
                    if ui.status_code == 200:
                        user_info = ui.json()
                        logger.info(f"Google userinfo: {list(user_info.keys())}")
            except Exception as e:
                logger.warning(f"Google userinfo failed: {e}")
    else:
        # ── Synology SSO 토큰 교환 (폴백) ───────────────
        token_url = f"{cfg['issuer_url']}/SSOAccessToken.cgi"

        async def _synology_exchange(use_pkce: bool, use_basic: bool) -> dict | None:
            data = {"grant_type": "authorization_code", "code": code,
                    "redirect_uri": cfg["redirect_uri"]}
            headers = {}
            if use_basic:
                import base64 as _b64b
                creds = _b64b.b64encode(f"{cfg['client_id']}:{cfg['client_secret']}".encode()).decode()
                headers["Authorization"] = f"Basic {creds}"
            else:
                data["client_id"] = cfg["client_id"]
                data["client_secret"] = cfg["client_secret"]
            if use_pkce:
                data["code_verifier"] = code_verifier
            try:
                async with httpx.AsyncClient(timeout=30.0, verify=False) as hc:
                    resp = await hc.post(token_url, data=data, headers=headers)
                    logger.info(f"Synology [{use_pkce},{use_basic}] {resp.status_code}: {resp.text[:200]}")
                    r = resp.json() if resp.text else {}
                    if resp.status_code < 400 and not r.get("error"):
                        return r
            except Exception as e:
                logger.error(f"Synology token exception: {e}")
            return None

        tokens = None
        for pkce, basic in [(True, False), (True, True), (False, False), (False, True)]:
            tokens = await _synology_exchange(pkce, basic)
            if tokens:
                break
        if not tokens:
            return error_redirect("SSO 인증 실패: 토큰 교환 오류",
                f"URL: {token_url} | redirect_uri: {cfg['redirect_uri']}")

        id_token = tokens.get("id_token", "")
        if id_token and id_token.count(".") == 2:
            try:
                pb = id_token.split(".")[1]; pb += "=" * (4 - len(pb) % 4)
                user_info = _json.loads(_b64.urlsafe_b64decode(pb))
            except Exception: pass
        if not user_info.get("sub") and not user_info.get("account"):
            try:
                async with httpx.AsyncClient(timeout=15.0, verify=False) as hc:
                    ui = await hc.get(f"{cfg['issuer_url']}/SSOUserInfo.cgi",
                        headers={"Authorization": f"Bearer {tokens.get('access_token', '')}"})
                    if ui.status_code == 200:
                        user_info.update(ui.json())
            except Exception: pass
        if not user_info:
            for k in ("account", "username", "user"):
                if tokens.get(k):
                    user_info["account"] = tokens[k]; break
        if not user_info:
            return error_redirect("사용자 정보를 가져올 수 없습니다.", str(tokens))

    # ── 공통: user_info → user_id / email / name ─────────
    user_id = (user_info.get("sub") or user_info.get("account")
               or user_info.get("preferred_username", "unknown"))
    email = user_info.get("email") or f"{user_id}@unknown.local"
    name  = (user_info.get("name") or user_info.get("preferred_username")
             or user_info.get("display_name") or email.split("@")[0])
    logger.info(f"Resolved user → id={user_id!r}, name={name!r}, email={email!r}")
    if not user_id or user_id == "unknown":
        return error_redirect("사용자 정보를 가져올 수 없습니다.", str(user_info))

    # ── ADMIN_USERS 환경변수 체크 (최우선 - 항상 통과) ──────────
    admin_users = [u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()]
    is_env_admin = user_id in admin_users or email in admin_users

    # ── 접속 허용 체크 ────────────────────────────────────────
    # Google OAuth 환경에서는 반드시 다음 중 하나여야 접근 허용:
    #   1) ADMIN_USERS 환경변수에 등록된 이메일/ID (관리자)
    #   2) pending_users에서 관리자 승인을 받아 users 테이블에 role이 할당된 사용자
    # ※ allowed_users 테이블이 비어있어도 미승인 사용자는 접근 불가
    app_url = get_oidc_settings()["app_url"].rstrip("/")

    if is_env_admin:
        # 환경변수 admin은 항상 통과
        role = "admin"
        is_admin = True
    else:
        # users 테이블에 이미 승인된 사용자인지 확인 (pending 승인 → users 테이블에 추가됨)
        existing_user_result = await db.execute(select(User).where(User.id == user_id))
        existing_user_check = existing_user_result.scalar_one_or_none()

        if existing_user_check is None:
            # 한 번도 승인된 적 없는 신규 사용자 → 권한 신청 흐름
            logger.warning(f"Access denied (not approved) for user {user_id!r} - redirecting to request page")

            # pending_users upsert
            pending_result = await db.execute(
                select(PendingUser).where(PendingUser.user_id == user_id)
            )
            pending = pending_result.scalar_one_or_none()
            if pending is None:
                pending = PendingUser(
                    user_id=user_id,
                    email=email,
                    name=name,
                    status="pending",
                )
                db.add(pending)
                await db.commit()
                logger.info(f"New pending access request: {user_id!r} ({email})")
                return RedirectResponse(
                    url=f"{app_url}/access-request?status=submitted&email={email}"
                )
            elif pending.status == "rejected":
                await db.commit()
                from urllib.parse import quote
                reason = quote(pending.reject_reason or "관리자에 의해 거부되었습니다.")
                return RedirectResponse(
                    url=f"{app_url}/access-request?status=rejected&reason={reason}"
                )
            else:
                # 이미 pending 상태 (재로그인 시도)
                await db.commit()
                return RedirectResponse(
                    url=f"{app_url}/access-request?status=pending&email={email}"
                )

        # users 테이블에 존재: DB의 role 그대로 사용
        role = existing_user_check.role
        is_admin = role == "admin"

    # DB에 사용자 upsert + 마지막 로그인 시간 확인 (중복 로그 방지용)
    # is_env_admin 경로에서는 아직 user 객체가 없으므로 조회, 비admin 경로는 existing_user_check 재사용
    if is_env_admin:
        existing_result = await db.execute(select(User).where(User.id == user_id))
        user = existing_result.scalar_one_or_none()
    else:
        user = existing_user_check  # 이미 위에서 조회함
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
        user.role = role  # 최신 role 동기화
    else:
        user = User(id=user_id, email=email, name=name, role=role, last_login=now_utc)
        db.add(user)
    await db.commit()

    # 중복 로그인이 아닐 때만 감사/접속 로그 기록
    if not is_duplicate_login:
        try:
            from services.audit_service import write_audit_log, EventType, EntityType
            from middlewares.auth_middleware import _get_client_ip
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
            logger.error(f"[LOGIN_LOG] 감사 로그 실패: {type(e).__name__}: {e}", exc_info=True)

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
            logger.error(f"[LOGIN_LOG] 접속 로그 실패: {type(e).__name__}: {e}", exc_info=True)

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
@_auth_limiter.limit("60/minute")  # 토큰 검증 분당 60회 제한
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
    # 로그아웃 후 로그인 선택 페이지로 이동
    return RedirectResponse(url=f"{app_url}/logged-out")


# ── 5. 현재 사용자 정보 ───────────────────────────────────
@router.get("/request-status")
async def get_request_status(
    email: str = Query(..., description="신청자 이메일"),
    db: AsyncSession = Depends(get_db),
):
    """권한 신청 현황 조회 (공개 엔드포인트 - 이메일로 조회)"""
    from sqlalchemy import select as _select
    result = await db.execute(
        _select(PendingUser).where(PendingUser.email == email)
    )
    pending = result.scalar_one_or_none()
    if not pending:
        return {"status": "not_found"}
    return {
        "status": pending.status,
        "requested_at": pending.requested_at,
        "reject_reason": pending.reject_reason if pending.status == "rejected" else None,
    }


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
