import logging
import os
import time

from core.database import db_manager
from sqlalchemy import text

logger = logging.getLogger(__name__)


async def check_database_health() -> bool:
    """Check if database is healthy"""
    start_time = time.time()
    logger.debug("[DB_OP] Starting database health check")
    try:
        if not db_manager.async_session_maker:
            return False

        async with db_manager.async_session_maker() as session:
            await session.execute(text("SELECT 1"))
            logger.debug(f"[DB_OP] Database health check completed in {time.time() - start_time:.4f}s - healthy: True")
            return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        logger.debug(f"[DB_OP] Database health check failed in {time.time() - start_time:.4f}s - healthy: False")
        return False


async def initialize_database():
    """Initialize database and create tables"""
    if "MGX_IGNORE_INIT_DB" in os.environ:
        logger.info("Ignore creating tables")
        return
    start_time = time.time()
    logger.debug("[DB_OP] Starting database initialization")

    # DATABASE_URL 디버그 로그 (비밀번호 마스킹)
    raw_db_url = os.environ.get("DATABASE_URL", "NOT_SET")
    if raw_db_url != "NOT_SET" and "@" in raw_db_url:
        try:
            scheme_end = raw_db_url.index("://") + 3
            at_pos = raw_db_url.rindex("@")
            masked = raw_db_url[:scheme_end] + "***:***@" + raw_db_url[at_pos+1:]
            logger.info(f"DATABASE_URL (masked): {masked}")
        except Exception:
            logger.info(f"DATABASE_URL scheme: {raw_db_url.split('://')[0]}")
    else:
        logger.warning(f"DATABASE_URL status: {raw_db_url}")

    try:
        logger.info("🔧 Starting database initialization...")
        await db_manager.init_db()
        logger.info("🔧 Database connection initialized, now creating tables if tables not exist...")
        await db_manager.create_tables()
        logger.info("🔧 Table creation completed")
        logger.info("Database initialized successfully")
        logger.debug(f"[DB_OP] Database initialization completed in {time.time() - start_time:.4f}s")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        logger.warning("⚠️ DB 초기화 실패 - 앱은 계속 기동됩니다. /health 엔드포인트는 DB 없이도 응답합니다.")
        # raise 제거: DB 연결 실패 시에도 앱이 기동되어 healthcheck 통과 가능하도록 함


async def close_database():
    """Close database connections"""
    start_time = time.time()
    logger.debug("[DB_OP] Starting database close")
    try:
        await db_manager.close_db()
        logger.info("Database connections closed")
        logger.debug(f"[DB_OP] Database close completed in {time.time() - start_time:.4f}s")
    except Exception as e:
        logger.error(f"Error closing database: {e}")
        logger.debug(f"[DB_OP] Database close failed in {time.time() - start_time:.4f}s")
