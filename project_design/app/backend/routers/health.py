from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from services.database import check_database_health
from core.database import get_db
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/database", tags=["database"])


@router.get("/health")
async def database_health_check():
    """Check database connection health"""
    is_healthy = await check_database_health()
    return {"status": "healthy" if is_healthy else "unhealthy", "service": "database"}


@router.get("/migration-status")
async def migration_status(db: AsyncSession = Depends(get_db)):
    """alembic_version / access_logs 테이블 진단 + 날짜별 로그 집계 (인증 불필요)"""
    result = {
        "server_utc_now": datetime.now(timezone.utc).isoformat(),
    }

    # ── 1. alembic_version ──────────────────────────────────
    try:
        ver = await db.execute(text("SELECT version_num FROM alembic_version"))
        result["alembic_version"] = [r[0] for r in ver.fetchall()]
    except Exception as e:
        result["alembic_version"] = f"ERROR: {e}"

    # ── 2. access_logs 존재 여부 + 총 건수 ──────────────────
    try:
        cnt = await db.execute(text("SELECT COUNT(*) FROM access_logs"))
        result["access_logs_count"] = cnt.scalar()
        result["access_logs_exists"] = True
    except Exception as e:
        result["access_logs_exists"] = False
        result["access_logs_error"] = str(e)
        return result

    # ── 3. 최신 레코드 ───────────────────────────────────────
    try:
        row = (await db.execute(text(
            "SELECT timestamp, action, user_name FROM access_logs ORDER BY timestamp DESC LIMIT 1"
        ))).fetchone()
        result["latest_log"] = {
            "timestamp": str(row[0]) if row else None,
            "action":    row[1] if row else None,
            "user_name": row[2] if row else None,
        }
    except Exception as e:
        result["latest_log"] = f"ERROR: {e}"

    # ── 4. 날짜별 건수 (최근 14일) ──────────────────────────
    try:
        rows = (await db.execute(text("""
            SELECT DATE(timestamp AT TIME ZONE 'UTC') AS day,
                   COUNT(*) AS cnt
            FROM access_logs
            WHERE timestamp >= NOW() - INTERVAL '14 days'
            GROUP BY day
            ORDER BY day DESC
        """))).fetchall()
        result["daily_counts_last14"] = [
            {"date": str(r[0]), "count": r[1]} for r in rows
        ]
    except Exception as e:
        result["daily_counts_last14"] = f"ERROR: {e}"

    # ── 5. action별 건수 ────────────────────────────────────
    try:
        rows = (await db.execute(text(
            "SELECT action, COUNT(*) FROM access_logs GROUP BY action ORDER BY COUNT(*) DESC"
        ))).fetchall()
        result["action_breakdown"] = {r[0]: r[1] for r in rows}
    except Exception as e:
        result["action_breakdown"] = f"ERROR: {e}"

    # ── 6. 4/8 이후 카운트 ──────────────────────────────────
    try:
        cnt_after = (await db.execute(text(
            "SELECT COUNT(*) FROM access_logs WHERE timestamp > '2026-04-07 11:00:00+00'"
        ))).scalar()
        result["count_after_apr8"] = cnt_after
    except Exception as e:
        result["count_after_apr8"] = f"ERROR: {e}"

    return result


@router.post("/insert-test-log")
async def insert_test_log(db: AsyncSession = Depends(get_db)):
    """
    access_logs에 테스트 레코드를 직접 INSERT해서 DB 쓰기 가능 여부 확인.
    미들웨어 우회 후 순수 DB 레벨에서 실패하는지 확인용.
    """
    result = {}

    # ── A. get_db 세션으로 직접 INSERT ──────────────────────
    try:
        await db.execute(text("""
            INSERT INTO access_logs (timestamp, user_id, user_email, user_name, action, method, path, status_code)
            VALUES (NOW(), 'test-diag', 'test@diag.com', '진단테스트', 'api', 'GET', '/database/insert-test-log', 200)
        """))
        await db.commit()
        result["direct_insert"] = "SUCCESS"
    except Exception as e:
        result["direct_insert"] = f"FAILED: {type(e).__name__}: {e}"
        await db.rollback()

    # ── B. db_manager.async_session_maker로 새 세션 INSERT ──
    try:
        from core.database import db_manager
        if db_manager.async_session_maker is None:
            result["db_manager_session"] = "FAILED: async_session_maker is None"
        else:
            async with db_manager.async_session_maker() as session:
                await session.execute(text("""
                    INSERT INTO access_logs (timestamp, user_id, user_email, user_name, action, method, path, status_code)
                    VALUES (NOW(), 'test-diag-mgr', 'test@diag.com', '진단테스트(mgr)', 'api', 'GET', '/database/insert-test-log', 200)
                """))
                await session.commit()
            result["db_manager_session"] = "SUCCESS"
    except Exception as e:
        result["db_manager_session"] = f"FAILED: {type(e).__name__}: {e}"

    # ── C. INSERT 후 즉시 조회 ───────────────────────────────
    try:
        cnt = (await db.execute(text(
            "SELECT COUNT(*) FROM access_logs WHERE user_id LIKE 'test-diag%'"
        ))).scalar()
        result["test_rows_inserted"] = cnt
    except Exception as e:
        result["test_rows_inserted"] = f"ERROR: {e}"

    # ── D. _write_access_log 직접 호출 테스트 ───────────────
    try:
        from middlewares.auth_middleware import _write_access_log
        await _write_access_log(
            user_id="test-diag-mw",
            user_email="test@diag.com",
            user_name="진단테스트(middleware)",
            action="api",
            method="GET",
            path="/database/insert-test-log",
            status_code=200,
            ip_address="127.0.0.1",
            user_agent="diag-test",
            duration_ms=0,
        )
        result["middleware_write_access_log"] = "SUCCESS (no exception)"
    except Exception as e:
        result["middleware_write_access_log"] = f"FAILED: {type(e).__name__}: {e}"

    return result
