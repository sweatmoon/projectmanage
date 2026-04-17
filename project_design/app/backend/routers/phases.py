"""
Phases 라우터 — Audit Log 통합
단계 생성/수정/삭제/복원 이벤트 기록 (project_name 컨텍스트 포함)
"""
import json
import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import timezone
from sqlalchemy import select, delete, and_
from core.database import get_db
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries
from services.phases import PhasesService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType, get_audit_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/entities/phases", tags=["phases"])


class PhasesData(BaseModel):
    project_id: int; phase_name: str
    start_date: Optional[date] = None; end_date: Optional[date] = None; sort_order: int

class PhasesUpdateData(BaseModel):
    project_id: Optional[int] = None; phase_name: Optional[str] = None
    start_date: Optional[date] = None; end_date: Optional[date] = None; sort_order: Optional[int] = None

class PhasesResponse(BaseModel):
    id: int; project_id: int; phase_name: str
    start_date: Optional[date] = None; end_date: Optional[date] = None; sort_order: int
    class Config:
        from_attributes = True

class PhasesListResponse(BaseModel):
    items: List[PhasesResponse]; total: int; skip: int; limit: int

class PhasesBatchCreateRequest(BaseModel):
    items: List[PhasesData]

class PhasesBatchUpdateItem(BaseModel):
    id: int; updates: PhasesUpdateData

class PhasesBatchUpdateRequest(BaseModel):
    items: List[PhasesBatchUpdateItem]

class PhasesBatchDeleteRequest(BaseModel):
    ids: List[int]


@router.get("", response_model=PhasesListResponse)
async def query_phasess(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = PhasesService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=PhasesListResponse)
async def query_phasess_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = PhasesService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/{id}", response_model=PhasesResponse)
async def get_phases(id: int, db: AsyncSession = Depends(get_db)):
    service = PhasesService(db)
    result = await service.get_by_id(id)
    if not result:
        raise HTTPException(status_code=404, detail="Phases not found")
    return result


@router.post("", response_model=PhasesResponse, status_code=201)
async def create_phases(
    data: PhasesData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    result = await service.create(data.model_dump())
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create phases")
    ctx = await get_audit_context(db, project_id=result.project_id)
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.PHASE,
        entity_id=result.id, project_id=result.project_id, after_obj=result, request=request,
        project_name=ctx["project_name"], phase_name=result.phase_name,
    )
    await db.commit()
    return result


@router.post("/batch", response_model=List[PhasesResponse], status_code=201)
async def create_phasess_batch(
    req: PhasesBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    results = []
    for item_data in req.items:
        r = await service.create(item_data.model_dump())
        if r:
            results.append(r)
            ctx = await get_audit_context(db, project_id=r.project_id)
            await write_audit_log(
                db, event_type=EventType.CREATE, entity_type=EntityType.PHASE,
                entity_id=r.id, project_id=r.project_id, after_obj=r, request=request,
                project_name=ctx["project_name"], phase_name=r.phase_name,
            )
    await db.commit()
    return results


@router.put("/batch", response_model=List[PhasesResponse])
async def update_phasess_batch(
    req: PhasesBatchUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    results = []
    for item in req.items:
        before = await service.get_by_id(item.id)
        update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
        r = await service.update(item.id, update_dict)
        if r:
            results.append(r)
            ctx = await get_audit_context(db, project_id=r.project_id)
            await write_audit_log(
                db, event_type=EventType.UPDATE, entity_type=EntityType.PHASE,
                entity_id=r.id, project_id=r.project_id,
                before_obj=before, after_obj=r, request=request,
                project_name=ctx["project_name"], phase_name=r.phase_name,
            )
    await db.commit()
    return results


@router.put("/{id}", response_model=PhasesResponse)
async def update_phases(
    id: int, data: PhasesUpdateData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    before = await service.get_by_id(id)
    if not before:
        raise HTTPException(status_code=404, detail="Phases not found")
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    result = await service.update(id, update_dict)
    ctx = await get_audit_context(db, project_id=result.project_id)
    await write_audit_log(
        db, event_type=EventType.UPDATE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=result.project_id,
        before_obj=before, after_obj=result, request=request,
        project_name=ctx["project_name"], phase_name=result.phase_name,
    )
    await db.commit()
    return result


async def _cascade_soft_delete_phase(db: AsyncSession, phase_id: int) -> dict:
    """phase 삭제 시 하위 staffing을 cascade soft-delete하고 calendar_entries를 hard-delete"""
    now = __import__('datetime').datetime.now(timezone.utc)
    result = await db.execute(
        select(Staffing).where(
            and_(Staffing.phase_id == phase_id, Staffing.deleted_at.is_(None))
        )
    )
    staffing_list = result.scalars().all()
    staffing_ids = [s.id for s in staffing_list]
    for s in staffing_list:
        s.deleted_at = now
    # calendar_entries hard-delete (deleted_at 컬럼 없음)
    cal_deleted = 0
    if staffing_ids:
        cal_result = await db.execute(
            delete(Calendar_entries).where(Calendar_entries.staffing_id.in_(staffing_ids))
        )
        cal_deleted = cal_result.rowcount
    return {"staffing": len(staffing_list), "calendar": cal_deleted}


@router.delete("/batch")
async def delete_phasess_batch(
    req: PhasesBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    deleted_count = 0
    total_cascade = {"staffing": 0, "calendar": 0}
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            cascade_stats = await _cascade_soft_delete_phase(db, item_id)
            total_cascade["staffing"] += cascade_stats["staffing"]
            total_cascade["calendar"] += cascade_stats["calendar"]
            soft_delete(obj)
            deleted_count += 1
            ctx = await get_audit_context(db, project_id=obj.project_id)
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.PHASE,
                entity_id=item_id, project_id=obj.project_id, before_obj=obj, request=request,
                project_name=ctx["project_name"], phase_name=obj.phase_name,
            )
            logger.info(f"[CASCADE] Phase {item_id} 삭제 → staffing {cascade_stats['staffing']}건 soft-delete, calendar {cascade_stats['calendar']}건 hard-delete")
    await db.commit()
    return {
        "message": f"Deleted {deleted_count} phases",
        "deleted_count": deleted_count,
        "cascade": total_cascade,
    }


@router.delete("/{id}")
async def delete_phases(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    service = PhasesService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="Phases not found")
    cascade_stats = await _cascade_soft_delete_phase(db, id)
    soft_delete(obj)
    ctx = await get_audit_context(db, project_id=obj.project_id)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=obj.project_id, before_obj=obj, request=request,
        project_name=ctx["project_name"], phase_name=obj.phase_name,
    )
    await db.commit()
    logger.info(f"[CASCADE] Phase {id} 삭제 → staffing {cascade_stats['staffing']}건 soft-delete, calendar {cascade_stats['calendar']}건 hard-delete")
    return {
        "message": "Phases deleted",
        "id": id,
        "cascade": cascade_stats,
    }


@router.post("/{id}/restore")
async def restore_phases(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    from models.phases import Phases
    result = await db.execute(select(Phases).where(Phases.id == id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Phase not found")
    if obj.deleted_at is None:
        raise HTTPException(status_code=400, detail="이미 활성 상태입니다.")
    obj.deleted_at = None
    ctx = await get_audit_context(db, project_id=obj.project_id)
    await write_audit_log(
        db, event_type=EventType.RESTORE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=obj.project_id, after_obj=obj, request=request,
        project_name=ctx["project_name"], phase_name=obj.phase_name,
    )
    await db.commit()
    return {"message": "Phase restored", "id": id}
