from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from services.database import check_database_health
from core.database import get_db

router = APIRouter(prefix="/database", tags=["database"])


@router.get("/health")
async def database_health_check():
    """Check database connection health"""
    is_healthy = await check_database_health()
    return {"status": "healthy" if is_healthy else "unhealthy", "service": "database"}


@router.get("/migration-status")
async def migration_status(db: AsyncSession = Depends(get_db)):
    """현재 alembic_version 및 access_logs 테이블 존재 여부 진단 (인증 불필요)"""
    result = {}
    try:
        # alembic_version 현재 HEAD
        ver = await db.execute(text("SELECT version_num FROM alembic_version"))
        rows = ver.fetchall()
        result["alembic_version"] = [r[0] for r in rows]
    except Exception as e:
        result["alembic_version"] = f"ERROR: {e}"

    try:
        # access_logs 테이블 존재 여부
        cnt = await db.execute(text("SELECT COUNT(*) FROM access_logs"))
        result["access_logs_count"] = cnt.scalar()
        result["access_logs_exists"] = True
    except Exception as e:
        result["access_logs_exists"] = False
        result["access_logs_error"] = str(e)

    try:
        # 최신 access_log 타임스탬프
        latest = await db.execute(text(
            "SELECT timestamp, action, user_name FROM access_logs ORDER BY timestamp DESC LIMIT 1"
        ))
        row = latest.fetchone()
        result["latest_log"] = {
            "timestamp": str(row[0]) if row else None,
            "action": row[1] if row else None,
            "user_name": row[2] if row else None,
        }
    except Exception as e:
        result["latest_log"] = f"ERROR: {e}"

    return result
