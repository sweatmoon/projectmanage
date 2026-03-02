"""
Phases 라우터 — Audit Log 통합
단계 생성/수정/삭제/복원 이벤트 기록
"""
import json
import logging
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.phases import PhasesService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType

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
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = PhasesService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=PhasesListResponse)
async def query_phasess_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
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
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.PHASE,
        entity_id=result.id, project_id=result.project_id, after_obj=result, request=request,
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
            await write_audit_log(
                db, event_type=EventType.CREATE, entity_type=EntityType.PHASE,
                entity_id=r.id, project_id=r.project_id, after_obj=r, request=request,
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
            await write_audit_log(
                db, event_type=EventType.UPDATE, entity_type=EntityType.PHASE,
                entity_id=r.id, project_id=r.project_id,
                before_obj=before, after_obj=r, request=request,
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
    await write_audit_log(
        db, event_type=EventType.UPDATE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=result.project_id,
        before_obj=before, after_obj=result, request=request,
    )
    await db.commit()
    return result


@router.delete("/batch")
async def delete_phasess_batch(
    req: PhasesBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PhasesService(db)
    deleted_count = 0
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            soft_delete(obj)
            deleted_count += 1
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.PHASE,
                entity_id=item_id, project_id=obj.project_id, before_obj=obj, request=request,
            )
    await db.commit()
    return {"message": f"Deleted {deleted_count} phases", "deleted_count": deleted_count}


@router.delete("/{id}")
async def delete_phases(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    service = PhasesService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="Phases not found")
    soft_delete(obj)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=obj.project_id, before_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Phases deleted", "id": id}


@router.post("/{id}/restore")
async def restore_phases(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    from models.phases import Phases
    from sqlalchemy import select
    result = await db.execute(select(Phases).where(Phases.id == id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Phase not found")
    if obj.deleted_at is None:
        raise HTTPException(status_code=400, detail="이미 활성 상태입니다.")
    obj.deleted_at = None
    await write_audit_log(
        db, event_type=EventType.RESTORE, entity_type=EntityType.PHASE,
        entity_id=id, project_id=obj.project_id, after_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Phase restored", "id": id}
