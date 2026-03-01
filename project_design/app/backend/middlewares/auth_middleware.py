"""
인증 미들웨어 - 모든 /api/v1 요청에 JWT 검증
/auth/* 및 /health 는 제외
"""
import logging
import os

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

def _is_public(path: str) -> bool:
    # 정적 파일 (assets, js, css 등)
    if path.startswith("/assets/") or path.endswith((".js", ".css", ".ico", ".svg", ".png", ".html")):
        return True
    # 공개 경로
    if path in PUBLIC_PATHS:
        return True
    # /auth/** 전체
    if path.startswith("/auth/"):
        return True
    # /database/** (health check)
    if path.startswith("/database/"):
        return True
    return False


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 공개 경로는 통과
        if _is_public(path):
            return await call_next(request)

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
            # request.state에 사용자 정보 저장
            request.state.user_id = payload.get("sub")
            request.state.user_email = payload.get("email")
            request.state.user_name = payload.get("name")
            request.state.user_role = payload.get("role", "user")
        except Exception as e:
            return JSONResponse(
                status_code=401,
                content={"detail": "토큰이 만료되었거나 유효하지 않습니다.", "auth_required": True}
            )

        return await call_next(request)
