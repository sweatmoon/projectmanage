"""
StaffingHat 라우터 — 모자(대체인력) 관리
공식 staffing 원본은 건드리지 않고 hat 테이블만 관리
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.staffing_hat import StaffingHat
from models.staffing import Staffing

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/staffing-hat", tags=["staffing-hat"])


# ── Pydantic Schemas ──────────────────────────────────────────

class HatCreate(BaseModel):
    staffing_id: int
    actual_person_id: Optional[int] = None
    actual_person_name: str


class HatUpdate(BaseModel):
    actual_person_id: Optional[int] = None
    actual_person_name: str


class HatResponse(BaseModel):
    id: int
    staffing_id: int
    actual_person_id: Optional[int] = None
    actual_person_name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────

async def _get_active_hat(db: AsyncSession, staffing_id: int) -> Optional[StaffingHat]:
    """해당 staffing_id 의 활성 hat 1건 반환 (soft-delete 제외)"""
    result = await db.execute(
        select(StaffingHat).where(
            and_(
                StaffingHat.staffing_id == staffing_id,
                StaffingHat.deleted_at.is_(None),
            )
        )
    )
    return result.scalars().first()


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/by-project/{project_id}", response_model=List[HatResponse])
async def get_hats_by_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    프로젝트 전체 hat 목록 반환
    staffing 테이블과 조인해서 project_id 로 필터
    """
    # 해당 프로젝트의 staffing id 목록 조회
    staffing_result = await db.execute(
        select(Staffing.id).where(
            and_(
                Staffing.project_id == project_id,
                Staffing.deleted_at.is_(None),
            )
        )
    )
    staffing_ids = [row[0] for row in staffing_result.fetchall()]

    if not staffing_ids:
        return []

    hat_result = await db.execute(
        select(StaffingHat).where(
            and_(
                StaffingHat.staffing_id.in_(staffing_ids),
                StaffingHat.deleted_at.is_(None),
            )
        )
    )
    return hat_result.scalars().all()


@router.get("/by-staffing/{staffing_id}", response_model=Optional[HatResponse])
async def get_hat_by_staffing(
    staffing_id: int,
    db: AsyncSession = Depends(get_db),
):
    """staffing_id 에 대한 활성 hat 1건 반환 (없으면 null)"""
    hat = await _get_active_hat(db, staffing_id)
    return hat


@router.post("", response_model=HatResponse, status_code=201)
async def create_hat(
    body: HatCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    모자 씌우기
    - 이미 hat 이 있으면 업데이트 (upsert)
    - staffing 원본은 절대 변경 안 함
    """
    now = datetime.now(timezone.utc)

    existing = await _get_active_hat(db, body.staffing_id)
    if existing:
        # 이미 있으면 업데이트
        existing.actual_person_id   = body.actual_person_id
        existing.actual_person_name = body.actual_person_name
        existing.updated_at         = now
        await db.commit()
        await db.refresh(existing)
        return existing

    hat = StaffingHat(
        staffing_id        = body.staffing_id,
        actual_person_id   = body.actual_person_id,
        actual_person_name = body.actual_person_name,
        created_at         = now,
        updated_at         = now,
    )
    db.add(hat)
    await db.commit()
    await db.refresh(hat)
    return hat


@router.put("/{hat_id}", response_model=HatResponse)
async def update_hat(
    hat_id: int,
    body: HatUpdate,
    db: AsyncSession = Depends(get_db),
):
    """모자 정보 수정"""
    result = await db.execute(
        select(StaffingHat).where(
            and_(StaffingHat.id == hat_id, StaffingHat.deleted_at.is_(None))
        )
    )
    hat = result.scalars().first()
    if not hat:
        raise HTTPException(status_code=404, detail="hat not found")

    hat.actual_person_id   = body.actual_person_id
    hat.actual_person_name = body.actual_person_name
    hat.updated_at         = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(hat)
    return hat


@router.delete("/by-staffing/{staffing_id}", status_code=204)
async def delete_hat_by_staffing(
    staffing_id: int,
    db: AsyncSession = Depends(get_db),
):
    """모자 해제 (soft-delete)"""
    hat = await _get_active_hat(db, staffing_id)
    if not hat:
        return  # 이미 없으면 무시

    hat.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/batch", response_model=List[HatResponse])
async def upsert_hats_batch(
    body: List[HatCreate],
    db: AsyncSession = Depends(get_db),
):
    """
    여러 hat 한번에 upsert
    투입공수 원장 모달 / 단계 수정 모달에서 저장 시 사용
    """
    now = datetime.now(timezone.utc)
    results = []

    for item in body:
        existing = await _get_active_hat(db, item.staffing_id)
        if existing:
            existing.actual_person_id   = item.actual_person_id
            existing.actual_person_name = item.actual_person_name
            existing.updated_at         = now
            await db.flush()
            await db.refresh(existing)
            results.append(existing)
        else:
            hat = StaffingHat(
                staffing_id        = item.staffing_id,
                actual_person_id   = item.actual_person_id,
                actual_person_name = item.actual_person_name,
                created_at         = now,
                updated_at         = now,
            )
            db.add(hat)
            await db.flush()
            await db.refresh(hat)
            results.append(hat)

    await db.commit()
    return results


@router.delete("/batch", status_code=204)
async def delete_hats_batch(
    staffing_ids: List[int],
    db: AsyncSession = Depends(get_db),
):
    """여러 hat 한번에 soft-delete (모자 일괄 해제)"""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(StaffingHat).where(
            and_(
                StaffingHat.staffing_id.in_(staffing_ids),
                StaffingHat.deleted_at.is_(None),
            )
        )
    )
    hats = result.scalars().all()
    for hat in hats:
        hat.deleted_at = now
    await db.commit()
