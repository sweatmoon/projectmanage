"""
공휴일 API 라우터
- GET    /api/v1/holidays               : 공휴일 목록 (프론트엔드용, 인증 불필요)
- GET    /api/v1/holidays/admin/list    : 관리용 전체 목록 (id 포함)
- GET    /api/v1/holidays/status        : 동기화 상태 (어드민용)
- POST   /api/v1/holidays/sync          : 수동 동기화 트리거 (어드민 전용)
- POST   /api/v1/holidays               : 공휴일 수동 추가 (어드민 전용)
- PUT    /api/v1/holidays/{id}          : 공휴일 수정 (어드민 전용)
- DELETE /api/v1/holidays/{id}          : 공휴일 삭제 (어드민 전용)
"""
import logging
import re
from datetime import datetime, timezone

from core.database import db_manager
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from services.holidays_sync import get_all_holidays_from_db, sync_holidays
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/holidays", tags=["holidays"])


async def get_db():
    async with db_manager.async_session_maker() as session:
        yield session


# ── Pydantic 스키마 ──────────────────────────────────────────────────────────
class HolidayCreate(BaseModel):
    date_str: str   # YYYY-MM-DD
    date_name: str  # 공휴일 명칭


class HolidayUpdate(BaseModel):
    date_str: str | None = None
    date_name: str | None = None


# ── 공휴일 목록 (공개) ───────────────────────────────────────────────────────
@router.get("")
async def list_holidays(db: AsyncSession = Depends(get_db)):
    """
    DB에 저장된 전체 공휴일 목록 반환.
    DB가 비어있으면 빈 배열 반환 (프론트엔드가 하드코딩 폴백 사용).
    """
    holidays = await get_all_holidays_from_db(db)
    return {"holidays": holidays, "count": len(holidays)}


# ── 공휴일 전체 목록 (id 포함, 어드민 관리용) ────────────────────────────────
# NOTE: 고정 경로는 반드시 /{id} 경로보다 앞에 정의해야 FastAPI가 올바르게 라우팅함
@router.get("/admin/list")
async def list_holidays_admin(db: AsyncSession = Depends(get_db)):
    """어드민 관리용: id, date_str, date_name, source 포함 전체 목록"""
    from models.holiday import Holiday
    try:
        result = await db.execute(
            select(Holiday).where(Holiday.is_holiday == True).order_by(Holiday.date_str)
        )
        rows = result.scalars().all()
        return {"holidays": [
            {
                "id": r.id,
                "date": r.date_str,
                "name": r.date_name,
                "source": r.source,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in rows
        ]}
    except Exception as e:
        logger.error(f"[HolidayAdmin] 목록 조회 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── 동기화 상태 조회 (어드민) ────────────────────────────────────────────────
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


# ── 공휴일 수동 추가 (어드민 전용) ──────────────────────────────────────────
@router.post("")
async def create_holiday(body: HolidayCreate, db: AsyncSession = Depends(get_db)):
    """공휴일 수동 추가. date_str 중복 시 오류 반환."""
    from models.holiday import Holiday
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", body.date_str):
        raise HTTPException(status_code=400, detail="date_str 형식이 올바르지 않습니다 (YYYY-MM-DD)")
    if not body.date_name.strip():
        raise HTTPException(status_code=400, detail="date_name을 입력해주세요")

    existing = await db.execute(select(Holiday).where(Holiday.date_str == body.date_str))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"{body.date_str} 날짜가 이미 등록되어 있습니다")

    now = datetime.now(timezone.utc)
    holiday = Holiday(
        date_str=body.date_str,
        date_name=body.date_name.strip(),
        is_holiday=True,
        source="manual",
        created_at=now,
        updated_at=now,
    )
    db.add(holiday)
    await db.commit()
    await db.refresh(holiday)
    logger.info(f"[HolidayAdmin] 수동 추가: {body.date_str} ({body.date_name})")
    return {
        "ok": True,
        "id": holiday.id,
        "date": holiday.date_str,
        "name": holiday.date_name,
        "source": holiday.source,
    }


# ── 공휴일 수정 (어드민 전용) ────────────────────────────────────────────────
@router.put("/{holiday_id}")
async def update_holiday(holiday_id: int, body: HolidayUpdate, db: AsyncSession = Depends(get_db)):
    """공휴일 날짜 또는 명칭 수정"""
    from models.holiday import Holiday
    result = await db.execute(select(Holiday).where(Holiday.id == holiday_id))
    holiday = result.scalar_one_or_none()
    if not holiday:
        raise HTTPException(status_code=404, detail="공휴일을 찾을 수 없습니다")

    if body.date_str is not None:
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", body.date_str):
            raise HTTPException(status_code=400, detail="date_str 형식이 올바르지 않습니다 (YYYY-MM-DD)")
        dup = await db.execute(
            select(Holiday).where(Holiday.date_str == body.date_str, Holiday.id != holiday_id)
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"{body.date_str} 날짜가 이미 등록되어 있습니다")
        holiday.date_str = body.date_str

    if body.date_name is not None:
        if not body.date_name.strip():
            raise HTTPException(status_code=400, detail="date_name을 입력해주세요")
        holiday.date_name = body.date_name.strip()

    holiday.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(holiday)
    logger.info(f"[HolidayAdmin] 수정: id={holiday_id} → {holiday.date_str} ({holiday.date_name})")
    return {
        "ok": True,
        "id": holiday.id,
        "date": holiday.date_str,
        "name": holiday.date_name,
        "source": holiday.source,
    }


# ── 공휴일 삭제 (어드민 전용) ────────────────────────────────────────────────
@router.delete("/{holiday_id}")
async def delete_holiday(holiday_id: int, db: AsyncSession = Depends(get_db)):
    """공휴일 삭제"""
    from models.holiday import Holiday
    result = await db.execute(select(Holiday).where(Holiday.id == holiday_id))
    holiday = result.scalar_one_or_none()
    if not holiday:
        raise HTTPException(status_code=404, detail="공휴일을 찾을 수 없습니다")
    date_str = holiday.date_str
    await db.delete(holiday)
    await db.commit()
    logger.info(f"[HolidayAdmin] 삭제: id={holiday_id} ({date_str})")
    return {"ok": True, "deleted_id": holiday_id, "date": date_str}
