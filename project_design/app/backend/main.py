import importlib
import logging
import os
import pkgutil
import asyncio
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from core.config import settings
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.routing import APIRouter
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# MODULE_IMPORTS_START
from services.database import initialize_database, close_database
from services.auth import initialize_admin_user
from middlewares.auth_middleware import AuthMiddleware
# MODULE_IMPORTS_END


async def _auto_archive_scheduler():
    """매일 새벽 3시(KST)에 12개월 이상 감사 로그 자동 아카이브"""
    logger = logging.getLogger(__name__)
    logger.info("[SCHEDULER] 감사 로그 자동 아카이브 스케줄러 시작")
    while True:
        try:
            now = datetime.now(timezone.utc)
            # 다음 새벽 3시(KST = UTC+9 → UTC 18:00) 계산
            from datetime import timedelta
            target_hour_utc = 18  # KST 03:00 = UTC 18:00
            next_run = now.replace(hour=target_hour_utc, minute=0, second=0, microsecond=0)
            if next_run <= now:
                next_run += timedelta(days=1)
            wait_seconds = (next_run - now).total_seconds()
            logger.info(f"[SCHEDULER] 다음 아카이브 실행: {next_run.isoformat()} (대기 {int(wait_seconds)}초)")
            await asyncio.sleep(wait_seconds)

            # 아카이브 실행
            from core.database import db_manager
            from services.audit_service import archive_old_logs
            if db_manager.async_session_maker:
                async with db_manager.async_session_maker() as session:
                    count = await archive_old_logs(session, months=12)
                    logger.info(f"[SCHEDULER] 자동 아카이브 완료: {count}건 이관")
        except asyncio.CancelledError:
            logger.info("[SCHEDULER] 아카이브 스케줄러 종료")
            break
        except Exception as e:
            logger.error(f"[SCHEDULER] 아카이브 실패: {e}")
            await asyncio.sleep(3600)  # 오류 시 1시간 후 재시도


def setup_logging():
    """Configure the logging system."""
    if os.environ.get("IS_LAMBDA") == "true":
        return

    # Create the logs directory
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    # Generate log filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = f"{log_dir}/app_{timestamp}.log"

    # Configure log format
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # Configure the root logger
    logging.basicConfig(
        level=logging.INFO,
        format=log_format,
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )

    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("fastapi").setLevel(logging.INFO)

    logger = logging.getLogger(__name__)
    logger.info("=== Logging system initialized ===")
    logger.info(f"Log file: {log_file}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.info("=== Application startup initiated ===")

    # MODULE_STARTUP_START
    await initialize_database()
    await initialize_admin_user()
    # MODULE_STARTUP_END

    # 감사 로그 자동 아카이브 스케줄러 시작
    archive_task = asyncio.create_task(_auto_archive_scheduler())

    logger.info("=== Application startup completed successfully ===")
    yield
    # MODULE_SHUTDOWN_START
    archive_task.cancel()
    try:
        await archive_task
    except asyncio.CancelledError:
        pass
    await close_database()
    # MODULE_SHUTDOWN_END


app = FastAPI(
    title="Project Management API",
    description="악티보 일정관리 시스템 API",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Rate Limiter 설정 ────────────────────────────────────────
# RATE_LIMIT 환경변수로 조정 가능. 기본: 일반 API 200req/min, 인증 API 20req/min
# X-Forwarded-For 헤더를 우선 사용하여 프록시 뒤 클라이언트 IP 식별
def _get_real_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return get_remote_address(request)

limiter = Limiter(
    key_func=_get_real_ip,
    default_limits=[os.environ.get("RATE_LIMIT_DEFAULT", "200/minute")],
    storage_uri="memory://",   # 단일 인스턴스용 인메모리 저장소
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)


# ── 역방향 프록시 헤더 처리 미들웨어 ─────────────────────────
# NAS DSM 역방향 프록시(Synology Application Portal)를 통해
# HTTPS 요청이 HTTP로 컨테이너에 전달될 때,
# X-Forwarded-Proto: https 헤더를 올바르게 반영한다.
class ReverseProxyMiddleware(BaseHTTPMiddleware):
    """X-Forwarded-Proto / X-Forwarded-Host 헤더를 신뢰하여
    FastAPI가 올바른 스킴(https)과 호스트를 인식하게 한다.
    추가: HTTP 보안 헤더 일괄 주입 (정보시스템 감리 보안 요건)"""
    async def dispatch(self, request: Request, call_next):
        # X-Forwarded-Proto 처리
        forwarded_proto = request.headers.get("x-forwarded-proto", "")
        forwarded_host  = request.headers.get("x-forwarded-host", "")
        forwarded_for   = request.headers.get("x-forwarded-for", "")

        if forwarded_proto:
            request.scope["scheme"] = forwarded_proto.split(",")[0].strip()
        if forwarded_host:
            host = forwarded_host.split(",")[0].strip()
            # scope의 server 튜플을 프록시 호스트로 교체
            port = 443 if request.scope.get("scheme") == "https" else 80
            if ":" in host:
                h, p = host.rsplit(":", 1)
                try:
                    port = int(p)
                    host = h
                except ValueError:
                    pass
            request.scope["server"] = (host, port)

        response = await call_next(request)

        # ── HTTP 보안 헤더 주입 ──────────────────────────────
        # 클릭재킹(Clickjacking) 방어
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        # MIME 타입 스니핑 방어
        response.headers["X-Content-Type-Options"] = "nosniff"
        # XSS 필터 활성화 (레거시 브라우저용)
        response.headers["X-XSS-Protection"] = "1; mode=block"
        # HTTPS 강제 (HSTS) — Railway는 항상 HTTPS 제공
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        # 참조 정보 보호
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # 불필요한 브라우저 기능 비활성화
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # CSP: 자체 도메인 + 인라인 스크립트(React 빌드용)만 허용
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com; "
            "frame-ancestors 'self';"
        )

        return response


# MODULE_MIDDLEWARE_START
# 역방향 프록시 헤더 처리 (NAS DSM Application Portal / nginx proxy)
app.add_middleware(ReverseProxyMiddleware)

# ── CORS 허용 출처 설정 ─────────────────────────────────────
# ALLOWED_ORIGINS 환경변수로 쉼표 구분 도메인 목록을 지정할 수 있음.
# 예) ALLOWED_ORIGINS=https://my.app.com,https://staging.app.com
# 미설정 시 APP_URL(자신의 서버) + localhost(개발용)만 허용.
def _build_cors_origins() -> list[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "")
    app_url = os.environ.get("APP_URL", "").rstrip("/")
    # 기본 허용 목록: 자체 서버 + 로컬 개발 포트
    defaults = {
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    }
    if app_url:
        defaults.add(app_url)
    # 환경변수로 추가 도메인 병합
    if raw:
        for o in raw.split(","):
            o = o.strip().rstrip("/")
            if o:
                defaults.add(o)
    return sorted(defaults)

_CORS_ORIGINS = _build_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,          # 명시적 허용 도메인 목록
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Accept"],
    expose_headers=["X-Total-Count", "Content-Disposition"],
    max_age=600,                           # preflight 캐시 10분
)
# JWT 인증 미들웨어 (OIDC_ISSUER_URL 환경변수 설정 시 활성화)
app.add_middleware(AuthMiddleware)
# MODULE_MIDDLEWARE_END


# Auto-discover and include all routers from the local `routers` package
def include_routers_from_package(app: FastAPI, package_name: str = "routers") -> None:
    logger = logging.getLogger(__name__)

    try:
        pkg = importlib.import_module(package_name)
    except Exception as exc:
        logger.debug("Routers package '%s' not loaded: %s", package_name, exc)
        return

    discovered: int = 0
    for _finder, module_name, is_pkg in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        if is_pkg:
            continue
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            logger.warning("Failed to import module '%s': %s", module_name, exc)
            continue

        for attr_name in ("router", "admin_router"):
            if not hasattr(module, attr_name):
                continue
            attr = getattr(module, attr_name)
            if isinstance(attr, APIRouter):
                app.include_router(attr)
                discovered += 1
                logger.info("Included router: %s.%s", module_name, attr_name)
            elif isinstance(attr, (list, tuple)):
                for idx, item in enumerate(attr):
                    if isinstance(item, APIRouter):
                        app.include_router(item)
                        discovered += 1

    if discovered == 0:
        logger.debug("No routers discovered in package '%s'", package_name)


# Setup logging before router discovery
setup_logging()
include_routers_from_package(app, "routers")


# Add exception handler
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc

    logger = logging.getLogger(__name__)
    error_message = str(exc)
    error_type = type(exc).__name__
    logger.error(f"Exception: {error_type}: {error_message}\n{traceback.format_exc()}")

    is_dev = os.getenv("ENVIRONMENT", "prod").lower() == "dev"

    if is_dev:
        error_detail = f"{error_type}: {error_message}\n{traceback.format_exc()}"
        return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": error_detail})
    else:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal Server Error"}
        )


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/api/config")
def get_config():
    """프론트엔드에 API 기본 URL 제공 (Railway/프로덕션 환경용)"""
    app_url = os.environ.get("APP_URL", "")
    return {"API_BASE_URL": app_url}


# Serve frontend static files
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/")
    def serve_root():
        resp = FileResponse(str(FRONTEND_DIST / "index.html"))
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # API routes are handled above, serve SPA for everything else
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            resp = FileResponse(str(file_path))
            # assets 폴더(JS/CSS)는 해시 기반 파일명이므로 장기 캐시 허용
            # index.html은 항상 최신 버전 제공
            if not full_path.startswith("assets/"):
                resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                resp.headers["Pragma"] = "no-cache"
                resp.headers["Expires"] = "0"
            return resp
        resp = FileResponse(str(FRONTEND_DIST / "index.html"))
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
else:
    @app.get("/")
    def root():
        return {"message": "API is running. Frontend not built yet."}


if __name__ == "__main__":
    import sys
    import uvicorn
    from dotenv import load_dotenv

    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)

    is_debugging = "pydevd" in sys.modules or (hasattr(sys, "gettrace") and sys.gettrace() is not None)

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(settings.port),
    )
