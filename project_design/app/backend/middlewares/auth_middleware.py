"""
인증 미들웨어 - 모든 /api/v1 요청에 JWT 검증
/auth/* 및 /health 는 제외
접속 로그 자동 기록
"""
import logging
import os
import time

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from jose import jwt
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

# 인증 없이 접근 가능한 경로
PUBLIC_PATHS = {
    "/health",
    "/auth/login",
    "/auth/callback",
    "/auth/logout",
    "/auth/verify",
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
}

# 로그 기록 제외 경로 (정적 파일 등)
SKIP_LOG_PREFIXES = ("/assets/", "/favicon", "/vite")
SKIP_LOG_SUFFIXES = (".js", ".css", ".ico", ".svg", ".png", ".html", ".woff", ".woff2", ".ttf", ".map")

def _is_public(path: str) -> bool:
    if path.startswith("/assets/") or path.endswith((".js", ".css", ".ico", ".svg", ".png", ".html")):
        return True
    if path in PUBLIC_PATHS:
        return True
    if path.startswith("/auth/"):
        return True
    if path.startswith("/database/"):
        return True
    return False

def _should_log(path: str) -> bool:
    for prefix in SKIP_LOG_PREFIXES:
        if path.startswith(prefix):
            return False
    for suffix in SKIP_LOG_SUFFIXES:
        if path.endswith(suffix):
            return False
    return True

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        start_time = time.time()

        # 공개 경로는 통과
        if _is_public(path):
            response = await call_next(request)
            return response

        # OIDC 미설정 시 인증 스킵 (개발 환경)
        oidc_issuer = os.environ.get("OIDC_ISSUER_URL", "")
        if not oidc_issuer:
            return await call_next(request)

        # JWT 검증
        auth_header = request.headers.get("Authorization", "")
        token = None
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

        if not token:
            return JSONResponse(
                status_code=401,
                content={"detail": "로그인이 필요합니다.", "auth_required": True}
            )

        jwt_secret = os.environ.get("JWT_SECRET", "change-me-in-production")
        try:
            payload = jwt.decode(token, jwt_secret, algorithms=["HS256"])
            request.state.user_id = payload.get("sub")
            request.state.user_email = payload.get("email")
            request.state.user_name = payload.get("name")
            request.state.user_role = payload.get("role", "user")
        except Exception:
            return JSONResponse(
                status_code=401,
                content={"detail": "토큰이 만료되었거나 유효하지 않습니다.", "auth_required": True}
            )

        response = await call_next(request)

        # 접속 로그 기록 (API 요청만)
        if _should_log(path):
            try:
                duration_ms = int((time.time() - start_time) * 1000)
                await _write_access_log(
                    user_id=getattr(request.state, "user_id", None),
                    user_email=getattr(request.state, "user_email", None),
                    user_name=getattr(request.state, "user_name", None),
                    action="api",
                    method=request.method,
                    path=path,
                    status_code=response.status_code,
                    ip_address=_get_client_ip(request),
                    user_agent=request.headers.get("User-Agent", ""),
                    duration_ms=duration_ms,
                )
            except Exception as e:
                logger.warning(f"Access log write failed: {e}")

        return response


async def _write_access_log(
    user_id, user_email, user_name,
    action, method, path, status_code,
    ip_address, user_agent, duration_ms
):
    """접속 로그를 DB에 비동기 기록"""
    try:
        from core.database import db_manager
        from models.auth import AccessLog
        if db_manager.async_session_maker is None:
            return
        async with db_manager.async_session_maker() as session:
            log = AccessLog(
                user_id=user_id,
                user_email=user_email,
                user_name=user_name,
                action=action,
                method=method,
                path=path,
                status_code=status_code,
                ip_address=ip_address,
                user_agent=user_agent,
                duration_ms=duration_ms,
            )
            session.add(log)
            await session.commit()
    except Exception as e:
        logger.warning(f"Failed to write access log to DB: {e}")
