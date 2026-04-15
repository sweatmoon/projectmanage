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


@router.post("/fix-sequence")
async def fix_access_logs_sequence(db: AsyncSession = Depends(get_db)):
    """
    access_logs_id_seq 를 MAX(id) 에 맞게 리셋.
    시퀀스 desync 로 INSERT 실패하는 문제 수정 (인증 불필요).
    """
    result = {}

    # ── 1. 현재 MAX(id) 와 시퀀스 현재값 확인 ───────────────
    try:
        max_id = (await db.execute(text("SELECT MAX(id) FROM access_logs"))).scalar() or 0
        result["max_id"] = max_id
    except Exception as e:
        result["error"] = f"MAX(id) 조회 실패: {e}"
        return result

    try:
        seq_val = (await db.execute(text("SELECT last_value FROM access_logs_id_seq"))).scalar()
        result["seq_before"] = seq_val
    except Exception as e:
        result["seq_before"] = f"조회 실패: {e}"

    # ── 2. 시퀀스를 MAX(id) 로 리셋 ─────────────────────────
    try:
        await db.execute(text(f"SELECT setval('access_logs_id_seq', {max_id}, true)"))
        await db.commit()
        result["fix"] = f"setval('access_logs_id_seq', {max_id}) 완료"
    except Exception as e:
        result["fix"] = f"FAILED: {type(e).__name__}: {e}"
        await db.rollback()
        return result

    # ── 3. 리셋 후 시퀀스 값 확인 ───────────────────────────
    try:
        seq_after = (await db.execute(text("SELECT last_value FROM access_logs_id_seq"))).scalar()
        result["seq_after"] = seq_after
    except Exception as e:
        result["seq_after"] = f"조회 실패: {e}"

    # ── 4. 실제 INSERT 테스트 ────────────────────────────────
    try:
        await db.execute(text("""
            INSERT INTO access_logs (timestamp, user_id, user_email, user_name, action, method, path, status_code)
            VALUES (NOW(), 'seq-fix-test', 'seq@fix.com', '시퀀스수정확인', 'api', 'GET', '/database/fix-sequence', 200)
        """))
        await db.commit()
        result["test_insert_after_fix"] = "SUCCESS ✅"
    except Exception as e:
        result["test_insert_after_fix"] = f"FAILED: {type(e).__name__}: {e}"
        await db.rollback()

    # ── 5. 최종 카운트 확인 ──────────────────────────────────
    try:
        cnt = (await db.execute(text("SELECT COUNT(*) FROM access_logs"))).scalar()
        result["total_count_after"] = cnt
    except Exception as e:
        result["total_count_after"] = f"ERROR: {e}"

    return result
