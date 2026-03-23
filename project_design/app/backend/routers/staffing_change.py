"""
StaffingChange 라우터 — 공식 인력 변경 이력 관리
🔁 아이콘으로 표시되는 공식 인력 교체 이력
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.staffing_change import StaffingChange
from models.staffing import Staffing

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/staffing-change", tags=["staffing-change"])


# ── Pydantic Schemas ──────────────────────────────────────────

class StaffingChangeCreate(BaseModel):
    staffing_id:          int
    project_id:           int
    phase_id:             int
    original_person_id:   Optional[int]   = None
    original_person_name: str
    new_person_id:        Optional[int]   = None
    new_person_name:      str
    reason:               Optional[str]   = None


class StaffingChangeResponse(BaseModel):
    id:                   int
    staffing_id:          int
    project_id:           int
    phase_id:             int
    original_person_id:   Optional[int]   = None
    original_person_name: str
    new_person_id:        Optional[int]   = None
    new_person_name:      str
    reason:               Optional[str]   = None
    changed_by:           Optional[str]   = None
    changed_at:           datetime

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────

@router.post("", response_model=StaffingChangeResponse, status_code=201)
async def create_staffing_change(
    body: StaffingChangeCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    공식 인력 변경 이력 등록
    - staffing.person_id / person_name_text 를 새 인력으로 업데이트
    - staffing_change 에 이력 저장
    """
    now = datetime.now(timezone.utc)
    changed_by = getattr(request.state, "user_name", None)

    # staffing 업데이트
    result = await db.execute(
        select(Staffing).where(
            and_(Staffing.id == body.staffing_id, Staffing.deleted_at.is_(None))
        )
    )
    staffing = result.scalars().first()
    if not staffing:
        raise HTTPException(status_code=404, detail="staffing not found")

    staffing.person_id        = body.new_person_id
    staffing.person_name_text = body.new_person_name if body.new_person_id is None else None
    staffing.updated_at       = now

    # 변경 이력 저장
    change = StaffingChange(
        staffing_id          = body.staffing_id,
        project_id           = body.project_id,
        phase_id             = body.phase_id,
        original_person_id   = body.original_person_id,
        original_person_name = body.original_person_name,
        new_person_id        = body.new_person_id,
        new_person_name      = body.new_person_name,
        reason               = body.reason,
        changed_by           = changed_by,
        changed_at           = now,
    )
    db.add(change)
    await db.commit()
    await db.refresh(change)
    return change


@router.get("/by-project/{project_id}", response_model=List[StaffingChangeResponse])
async def get_changes_by_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """프로젝트 전체 공식 변경 이력 (최신순)"""
    result = await db.execute(
        select(StaffingChange)
        .where(StaffingChange.project_id == project_id)
        .order_by(StaffingChange.changed_at.desc())
    )
    return result.scalars().all()


@router.get("/by-staffing/{staffing_id}", response_model=List[StaffingChangeResponse])
async def get_changes_by_staffing(
    staffing_id: int,
    db: AsyncSession = Depends(get_db),
):
    """특정 staffing row의 공식 변경 이력 (최신순) — 달력 셀 툴팁용"""
    result = await db.execute(
        select(StaffingChange)
        .where(StaffingChange.staffing_id == staffing_id)
        .order_by(StaffingChange.changed_at.desc())
    )
    return result.scalars().all()


@router.get("/by-phase/{phase_id}", response_model=List[StaffingChangeResponse])
async def get_changes_by_phase(
    phase_id: int,
    db: AsyncSession = Depends(get_db),
):
    """단계별 공식 변경 이력 (최신순)"""
    result = await db.execute(
        select(StaffingChange)
        .where(StaffingChange.phase_id == phase_id)
        .order_by(StaffingChange.changed_at.desc())
    )
    return result.scalars().all()
