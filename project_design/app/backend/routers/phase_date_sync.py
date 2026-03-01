"""
Phase date sync: When phase dates change, recalculate calendar entries for all staffing in that phase.
- If staffing MD > new business days → flag as "exceeding" (frontend shows warning)
- On confirm: truncate MD to new business days for exceeding staffing, then regenerate calendar entries
- Calendar entries are regenerated as consecutive business days from phase start_date
"""
import logging
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.phases import Phases
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries
from models.projects import Projects
from utils.holidays import count_business_days, get_consecutive_business_days

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/phase_date_sync", tags=["phase_date_sync"])


class PhaseDateChangePreviewRequest(BaseModel):
    phase_id: int
    new_start_date: str  # YYYY-MM-DD
    new_end_date: str    # YYYY-MM-DD


class StaffingImpact(BaseModel):
    staffing_id: int
    person_name: str
    field: str
    current_md: int
    new_business_days: int
    exceeds: bool  # True if current_md > new_business_days


class PhaseDateChangePreviewResponse(BaseModel):
    phase_id: int
    phase_name: str
    old_start_date: Optional[str] = None
    old_end_date: Optional[str] = None
    new_start_date: str
    new_end_date: str
    old_business_days: int
    new_business_days: int
    total_staffing: int
    exceeding_staffing: List[StaffingImpact]
    safe_staffing: List[StaffingImpact]


@router.post("/preview", response_model=PhaseDateChangePreviewResponse)
async def preview_phase_date_change(
    request: PhaseDateChangePreviewRequest,
    db: AsyncSession = Depends(get_db),
):
    """Preview the impact of changing phase dates on staffing and calendar entries."""
    try:
        # Get phase
        phase_result = await db.execute(select(Phases).where(Phases.id == request.phase_id))
        phase = phase_result.scalar_one_or_none()
        if not phase:
            raise HTTPException(status_code=404, detail="Phase not found")

        new_start = date.fromisoformat(request.new_start_date)
        new_end = date.fromisoformat(request.new_end_date)
        new_biz_days = count_business_days(new_start, new_end)

        old_start = phase.start_date
        old_end = phase.end_date
        old_biz_days = count_business_days(old_start, old_end) if old_start and old_end else 0

        # Get all staffing for this phase
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.phase_id == request.phase_id)
        )
        staffing_list = staffing_result.scalars().all()

        # Get people names
        people_map = {}
        if staffing_list:
            person_ids = [s.person_id for s in staffing_list if s.person_id]
            if person_ids:
                from models.people import People
                people_result = await db.execute(select(People).where(People.id.in_(person_ids)))
                for p in people_result.scalars().all():
                    people_map[p.id] = p.person_name

        exceeding = []
        safe = []
        for s in staffing_list:
            person_name = people_map.get(s.person_id, s.person_name_text or "?") if s.person_id else (s.person_name_text or "?")
            current_md = s.md or 0
            is_exceeding = current_md > new_biz_days

            impact = StaffingImpact(
                staffing_id=s.id,
                person_name=person_name,
                field=s.field or "",
                current_md=current_md,
                new_business_days=new_biz_days,
                exceeds=is_exceeding,
            )
            if is_exceeding:
                exceeding.append(impact)
            else:
                safe.append(impact)

        return PhaseDateChangePreviewResponse(
            phase_id=phase.id,
            phase_name=phase.phase_name,
            old_start_date=str(old_start) if old_start else None,
            old_end_date=str(old_end) if old_end else None,
            new_start_date=request.new_start_date,
            new_end_date=request.new_end_date,
            old_business_days=old_biz_days,
            new_business_days=new_biz_days,
            total_staffing=len(staffing_list),
            exceeding_staffing=exceeding,
            safe_staffing=safe,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error previewing phase date change: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(e)}")


class PhaseDateChangeApplyRequest(BaseModel):
    phase_id: int
    new_start_date: str  # YYYY-MM-DD
    new_end_date: str    # YYYY-MM-DD
    force: bool = False  # If True, truncate exceeding MD to new business days
    expand_md: bool = False  # If True, expand MD to new business days when period is extended


class ApplyResultStaffing(BaseModel):
    staffing_id: int
    person_name: str
    old_md: int
    new_md: int
    entries_created: int


class PhaseDateChangeApplyResponse(BaseModel):
    phase_id: int
    phase_name: str
    new_start_date: str
    new_end_date: str
    new_business_days: int
    staffing_results: List[ApplyResultStaffing]
    message: str


@router.post("/apply", response_model=PhaseDateChangeApplyResponse)
async def apply_phase_date_change(
    request: PhaseDateChangeApplyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Apply phase date change: update phase dates, recalculate MD if needed, regenerate calendar entries."""
    try:
        # Get phase
        phase_result = await db.execute(select(Phases).where(Phases.id == request.phase_id))
        phase = phase_result.scalar_one_or_none()
        if not phase:
            raise HTTPException(status_code=404, detail="Phase not found")

        new_start = date.fromisoformat(request.new_start_date)
        new_end = date.fromisoformat(request.new_end_date)
        new_biz_days = count_business_days(new_start, new_end)

        # Calculate old business days for expand_md comparison (before updating phase)
        old_biz_days = count_business_days(phase.start_date, phase.end_date) if phase.start_date and phase.end_date else 0

        # Get project for status
        proj_result = await db.execute(select(Projects).where(Projects.id == phase.project_id))
        proj = proj_result.scalar_one_or_none()
        proj_status = proj.status if proj else "감리"

        # Update phase dates
        phase.start_date = new_start
        phase.end_date = new_end
        await db.flush()

        # Get all staffing for this phase
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.phase_id == request.phase_id)
        )
        staffing_list = staffing_result.scalars().all()

        # Get people names
        people_map = {}
        if staffing_list:
            person_ids = [s.person_id for s in staffing_list if s.person_id]
            if person_ids:
                from models.people import People
                people_result = await db.execute(select(People).where(People.id.in_(person_ids)))
                for p in people_result.scalars().all():
                    people_map[p.id] = p.person_name

        results = []
        calendar_status = "P" if proj_status == "제안" else "A"

        for s in staffing_list:
            person_name = people_map.get(s.person_id, s.person_name_text or "?") if s.person_id else (s.person_name_text or "?")
            old_md = s.md or 0
            new_md = old_md

            # Case 1: MD exceeds new business days → truncate if force=True
            if old_md > new_biz_days:
                if not request.force:
                    raise HTTPException(
                        status_code=409,
                        detail=f"인력 '{person_name}'의 투입공수({old_md}일)가 새 영업일({new_biz_days}일)을 초과합니다. force=true로 재시도하세요."
                    )
                # Truncate MD
                new_md = new_biz_days
                s.md = new_md
                await db.flush()

            # Case 2: Period expanded and expand_md=True → expand MD proportionally
            elif request.expand_md and old_biz_days > 0 and new_biz_days > old_biz_days:
                # Expand MD to new business days (full expansion)
                new_md = new_biz_days
                s.md = new_md
                await db.flush()

            # Delete all existing calendar entries for this staffing
            existing_entries = await db.execute(
                select(Calendar_entries).where(Calendar_entries.staffing_id == s.id)
            )
            for entry in existing_entries.scalars().all():
                await db.delete(entry)
            await db.flush()

            # Create new consecutive calendar entries from start_date
            if new_md > 0:
                business_days = get_consecutive_business_days(new_start, new_end, new_md)
                for bd in business_days:
                    new_entry = Calendar_entries(
                        staffing_id=s.id,
                        entry_date=bd,
                        status=calendar_status,
                    )
                    db.add(new_entry)
                entries_created = len(business_days)
            else:
                entries_created = 0

            await db.flush()

            results.append(ApplyResultStaffing(
                staffing_id=s.id,
                person_name=person_name,
                old_md=old_md,
                new_md=new_md,
                entries_created=entries_created,
            ))

        await db.commit()

        return PhaseDateChangeApplyResponse(
            phase_id=phase.id,
            phase_name=phase.phase_name,
            new_start_date=request.new_start_date,
            new_end_date=request.new_end_date,
            new_business_days=new_biz_days,
            staffing_results=results,
            message=f"단계 날짜가 변경되고 {len(results)}명의 일정이 재생성되었습니다.",
        )
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error applying phase date change: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Apply failed: {str(e)}")