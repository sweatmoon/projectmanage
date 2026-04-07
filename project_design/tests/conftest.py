"""
공통 pytest fixtures
- 인메모리 SQLite DB (aiosqlite) 기반 비동기 세션
- FastAPI TestClient (httpx AsyncClient)
- JWT 토큰 생성 헬퍼
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

# ── 경로 설정: app/backend를 sys.path에 추가 ─────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app", "backend"))

# 테스트용 환경변수 설정 (인증 우회)
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("JWT_EXPIRE_HOURS", "8")
os.environ.setdefault("APP_URL", "http://testserver")
os.environ.setdefault("ENVIRONMENT", "test")
# GOOGLE_CLIENT_ID 미설정 → 인증 미들웨어 비활성화 (단위 테스트용)

from core.database import Base
from main import app
from core.database import get_db

# ── 인메모리 DB 엔진 ─────────────────────────────────────────
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)
TestSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


@pytest_asyncio.fixture(scope="session")
async def db_setup():
    """세션 전체에서 1회 테이블 생성"""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session(db_setup) -> AsyncGenerator[AsyncSession, None]:
    """각 테스트마다 트랜잭션 롤백으로 격리"""
    async with test_engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """FastAPI TestClient — DB 의존성 오버라이드"""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


# ── JWT 토큰 헬퍼 ─────────────────────────────────────────────
def make_jwt(role: str = "admin", sub: str = "test_user_001",
             email: str = "test@example.com", name: str = "테스트유저",
             secret: str = "test-secret-key-for-unit-tests-only") -> str:
    from jose import jwt
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "email": email,
        "name": name,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=8),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def admin_token() -> str:
    return make_jwt(role="admin")


@pytest.fixture
def user_token() -> str:
    return make_jwt(role="user")


@pytest.fixture
def viewer_token() -> str:
    return make_jwt(role="viewer")


@pytest.fixture
def admin_headers(admin_token) -> dict:
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
def user_headers(user_token) -> dict:
    return {"Authorization": f"Bearer {user_token}"}


@pytest.fixture
def viewer_headers(viewer_token) -> dict:
    return {"Authorization": f"Bearer {viewer_token}"}
