"""
공휴일 API 라우터
- GET  /api/v1/holidays          : 공휴일 목록 (프론트엔드용, 인증 불필요)
- GET  /api/v1/holidays/status   : 동기화 상태 (어드민용)
- POST /api/v1/holidays/sync     : 수동 동기화 트리거 (어드민 전용)
"""
import logging
from datetime import datetime, timezone

from core.database import db_manager
from fastapi import APIRouter, Depends
from services.holidays_sync import get_all_holidays_from_db, sync_holidays
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/holidays", tags=["holidays"])


async def get_db():
    async with db_manager.async_session_maker() as session:
        yield session


# ── 공휴일 목록 (공개) ───────────────────────────────────────────────────────
@router.get("")
async def list_holidays(db: AsyncSession = Depends(get_db)):
    """
    DB에 저장된 전체 공휴일 목록 반환.
    DB가 비어있으면 빈 배열 반환 (프론트엔드가 하드코딩 폴백 사용).
    """
    holidays = await get_all_holidays_from_db(db)
    return {"holidays": holidays, "count": len(holidays)}


# ── 동기화 상태 조회 (어드민) ───────────────────────────────────────────────
@router.get("/status")
async def holiday_sync_status(db: AsyncSession = Depends(get_db)):
    """마지막 동기화 정보 및 연도별 건수 반환"""
    try:
        total_result = await db.execute(text("SELECT COUNT(*) FROM holidays"))
        total = total_result.scalar() or 0

        last_sync_result = await db.execute(
            text("SELECT MAX(updated_at) FROM holidays")
        )
        last_sync = last_sync_result.scalar()

        year_result = await db.execute(
            text("SELECT SUBSTR(date_str, 1, 4) as yr, COUNT(*) as cnt FROM holidays GROUP BY yr ORDER BY yr")
        )
        by_year = {row[0]: row[1] for row in year_result.all()}

        return {
            "total": total,
            "last_sync": last_sync.isoformat() if last_sync else None,
            "by_year": by_year,
            "db_active": total > 0,
        }
    except Exception as e:
        logger.error(f"[HolidayStatus] 오류: {e}")
        return {"total": 0, "last_sync": None, "by_year": {}, "db_active": False, "error": str(e)}


# ── 수동 동기화 트리거 (어드민 전용) ────────────────────────────────────────
@router.post("/sync")
async def trigger_sync(db: AsyncSession = Depends(get_db)):
    """어드민이 수동으로 공공데이터포털 API 동기화 실행"""
    logger.info("[HolidaySync] 수동 동기화 트리거")
    try:
        result = await sync_holidays(db)
        return {"ok": True, **result}
    except Exception as e:
        logger.error(f"[HolidaySync] 수동 동기화 오류: {e}")
        return {"ok": False, "error": str(e)}
