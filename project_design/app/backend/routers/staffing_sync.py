"""
Staffing MD sync: When MD is changed in the staffing table,
regenerate calendar entries as consecutive business days from the phase start_date.
"""
import logging
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.phases import Phases
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries
from models.projects import Projects
from utils.holidays import count_business_days, get_consecutive_business_days

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/staffing_sync", tags=["staffing_sync"])


class MdSyncRequest(BaseModel):
    staffing_id: int
    new_md: int  # new MD value (0 means clear all entries)


class MdSyncResponse(BaseModel):
    staffing_id: int
    old_md: int
    new_md: int
    entries_deleted: int
    entries_created: int
    message: str


@router.post("/sync_md", response_model=MdSyncResponse)
async def sync_md_calendar(
    request: MdSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    When MD is updated for a staffing record, regenerate calendar entries
    as consecutive business days from the phase start_date.
    """
    try:
        # Get staffing
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.id == request.staffing_id)
        )
        staffing = staffing_result.scalar_one_or_none()
        if not staffing:
            raise HTTPException(status_code=404, detail="Staffing not found")

        old_md = staffing.md or 0

        # Get phase for date range
        phase_result = await db.execute(
            select(Phases).where(Phases.id == staffing.phase_id)
        )
        phase = phase_result.scalar_one_or_none()
        if not phase:
            raise HTTPException(status_code=404, detail="Phase not found")

        if not phase.start_date or not phase.end_date:
            raise HTTPException(
                status_code=400,
                detail="단계의 시작일/종료일이 설정되지 않았습니다."
            )

        biz_days = count_business_days(phase.start_date, phase.end_date)
        if request.new_md > biz_days:
            raise HTTPException(
                status_code=400,
                detail=f"투입공수({request.new_md}일)가 해당 단계의 영업일({biz_days}일)을 초과합니다."
            )

        # Update staffing MD
        staffing.md = request.new_md
        await db.flush()

        # Delete all existing calendar entries for this staffing
        existing_result = await db.execute(
            select(Calendar_entries).where(Calendar_entries.staffing_id == staffing.id)
        )
        existing_entries = existing_result.scalars().all()
        entries_deleted = len(existing_entries)
        for entry in existing_entries:
            await db.delete(entry)
        await db.flush()

        # Determine calendar status from project
        proj_result = await db.execute(
            select(Projects).where(Projects.id == phase.project_id)
        )
        proj = proj_result.scalar_one_or_none()
        calendar_status = "P" if (proj and proj.status == "제안") else "A"

        # Create new consecutive calendar entries from start_date
        entries_created = 0
        if request.new_md > 0:
            business_days = get_consecutive_business_days(
                phase.start_date, phase.end_date, request.new_md
            )
            for bd in business_days:
                new_entry = Calendar_entries(
                    staffing_id=staffing.id,
                    entry_date=bd,
                    status=calendar_status,
                )
                db.add(new_entry)
            entries_created = len(business_days)

        await db.commit()

        return MdSyncResponse(
            staffing_id=staffing.id,
            old_md=old_md,
            new_md=request.new_md,
            entries_deleted=entries_deleted,
            entries_created=entries_created,
            message=f"투입공수가 {old_md}일에서 {request.new_md}일로 변경되고, {entries_created}개의 일정이 재생성되었습니다.",
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error syncing MD calendar: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"MD sync failed: {str(e)}")