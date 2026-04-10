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
    "/api/config",   # 프론트엔드 런타임 설정 (인증 전 필요)
    "/api/v1/proposal-risk/debug",  # 디버그 엔드포인트 (임시 공개)
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
    # 정적 파일은 항상 공개
    if path.startswith("/assets/") or path.endswith((".js", ".css", ".ico", ".svg", ".png", ".html", ".woff", ".woff2", ".ttf", ".map")):
        return True
    # 명시적 공개 경로
    if path in PUBLIC_PATHS:
        return True
    # /auth/* 경로는 공개
    if path.startswith("/auth/"):
        return True
    # /database/* 경로는 공개
    if path.startswith("/database/"):
        return True
    # SPA 프론트엔드 라우트: /api/ 또는 /admin/ (슬래시 포함) 으로 시작하지 않으면 공개
    # /admin (정확히 이 경로, 슬래시 없이 끝남)은 SPA 페이지 진입점이므로 공개
    if path == "/admin":
        return True
    # /admin/... 은 백엔드 관리 API → 인증 필요 (아래에서 처리)
    # /api/... 는 백엔드 API → 인증 필요
    # 그 외는 모두 SPA 프론트엔드 라우트 → 공개
    if not path.startswith("/api/") and not path.startswith("/admin/"):
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

        # 인증 미설정 시 스킵 (개발 환경: OIDC_ISSUER_URL과 GOOGLE_CLIENT_ID 모두 없을 때)
        oidc_issuer = os.environ.get("OIDC_ISSUER_URL", "")
        google_client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
        if not oidc_issuer and not google_client_id:
            return await call_next(request)

        # JWT 검증
        # 1) Authorization: Bearer <token> 헤더 우선
        # 2) ?token= 쿼리파라미터 fallback (CSV 내보내기 등 window.open 용)
        auth_header = request.headers.get("Authorization", "")
        token = None
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

        if not token:
            token = request.query_params.get("token", None)

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

        # ── viewer 읽기 전용 강제 ─────────────────────────────
        # viewer 역할은 GET/HEAD/OPTIONS 외 모든 쓰기 요청 차단
        # 단, 아래 경로는 조회 목적으로 POST를 사용하므로 viewer에게도 허용
        VIEWER_ALLOWED_POST_PATHS = {
            "/api/v1/calendar/month",
            "/api/v1/calendar/range",
            "/api/v1/calendar/by_staffing_ids",
            "/api/v1/calendar/entries_by_person_ids",
            "/api/v1/calendar/staffing-total-count",   # 뷰어 달력 MD 카운트 조회
        }
        if (
            request.state.user_role == "viewer"
            and request.method.upper() not in ("GET", "HEAD", "OPTIONS")
            and path not in VIEWER_ALLOWED_POST_PATHS
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "조회 전용 계정입니다. 입력·수정·삭제 작업은 허용되지 않습니다."}
            )

        # ── user 역할: 달력 셀 토글(추가/제거) 차단 ───────────────
        # user는 달력 셀 클릭(toggle) 불가 - leader/admin만 허용
        # leader, admin, viewer(이미 위에서 차단)는 해당 없음
        if (
            request.state.user_role == "user"
            and request.method.upper() == "POST"
            and path == "/api/v1/calendar/toggle"
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "달력 셀 수정 권한이 없습니다. 리더 이상 권한이 필요합니다."}
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
