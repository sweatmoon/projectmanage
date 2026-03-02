"""
Staffing 라우터 — Audit Log 통합
MD 변경/투입인력 추가·삭제 이벤트 기록, soft-delete 적용
"""
import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.staffing import StaffingService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/entities/staffing", tags=["staffing"])


# ── Pydantic Schemas ──────────────────────────────────────────
class StaffingData(BaseModel):
    project_id: int
    phase_id: int
    category: str
    field: str
    sub_field: str
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None


class StaffingUpdateData(BaseModel):
    project_id: Optional[int] = None
    phase_id: Optional[int] = None
    category: Optional[str] = None
    field: Optional[str] = None
    sub_field: Optional[str] = None
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None


class StaffingResponse(BaseModel):
    id: int
    project_id: int
    phase_id: int
    category: str
    field: str
    sub_field: str
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StaffingListResponse(BaseModel):
    items: List[StaffingResponse]
    total: int
    skip: int
    limit: int


class StaffingBatchCreateRequest(BaseModel):
    items: List[StaffingData]


class StaffingBatchUpdateItem(BaseModel):
    id: int
    updates: StaffingUpdateData


class StaffingBatchUpdateRequest(BaseModel):
    items: List[StaffingBatchUpdateItem]


class StaffingBatchDeleteRequest(BaseModel):
    ids: List[int]


# ── Routes ────────────────────────────────────────────────────
@router.get("", response_model=StaffingListResponse)
async def query_staffings(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = StaffingService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=StaffingListResponse)
async def query_staffings_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = StaffingService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/{id}", response_model=StaffingResponse)
async def get_staffing(id: int, db: AsyncSession = Depends(get_db)):
    service = StaffingService(db)
    result = await service.get_by_id(id)
    if not result:
        raise HTTPException(status_code=404, detail="Staffing not found")
    return result


@router.post("", response_model=StaffingResponse, status_code=201)
async def create_staffing(
    data: StaffingData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    result = await service.create(data.model_dump())
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create staffing")
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.STAFFING,
        entity_id=result.id, project_id=result.project_id,
        after_obj=result, request=request,
    )
    await db.commit()
    logger.info(f"[AUDIT] Staffing {result.id} created")
    return result


@router.post("/batch", response_model=List[StaffingResponse], status_code=201)
async def create_staffings_batch(
    req: StaffingBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    results = []
    for item_data in req.items:
        r = await service.create(item_data.model_dump())
        if r:
            results.append(r)
            await write_audit_log(
                db, event_type=EventType.CREATE, entity_type=EntityType.STAFFING,
                entity_id=r.id, project_id=r.project_id,
                after_obj=r, request=request,
            )
    await db.commit()
    return results


@router.put("/batch", response_model=List[StaffingResponse])
async def update_staffings_batch(
    req: StaffingBatchUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    results = []
    for item in req.items:
        before = await service.get_by_id(item.id)
        update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
        r = await service.update(item.id, update_dict)
        if r:
            results.append(r)
            await write_audit_log(
                db, event_type=EventType.UPDATE, entity_type=EntityType.STAFFING,
                entity_id=r.id, project_id=r.project_id,
                before_obj=before, after_obj=r, request=request,
            )
    await db.commit()
    return results


@router.put("/{id}", response_model=StaffingResponse)
async def update_staffing(
    id: int, data: StaffingUpdateData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    before = await service.get_by_id(id)
    if not before:
        raise HTTPException(status_code=404, detail="Staffing not found")
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    result = await service.update(id, update_dict)
    await write_audit_log(
        db, event_type=EventType.UPDATE, entity_type=EntityType.STAFFING,
        entity_id=id, project_id=result.project_id,
        before_obj=before, after_obj=result, request=request,
    )
    await db.commit()
    return result


@router.delete("/batch")
async def delete_staffings_batch(
    req: StaffingBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    deleted_count = 0
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            soft_delete(obj)
            deleted_count += 1
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.STAFFING,
                entity_id=item_id, project_id=obj.project_id,
                before_obj=obj, request=request,
            )
    await db.commit()
    return {"message": f"Deleted {deleted_count} staffings", "deleted_count": deleted_count}


@router.delete("/{id}")
async def delete_staffing(
    id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    service = StaffingService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="Staffing not found")
    soft_delete(obj)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.STAFFING,
        entity_id=id, project_id=obj.project_id,
        before_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Staffing deleted", "id": id}


@router.post("/{id}/restore")
async def restore_staffing(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    from models.staffing import Staffing
    from sqlalchemy import select
    result = await db.execute(select(Staffing).where(Staffing.id == id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Staffing not found")
    if obj.deleted_at is None:
        raise HTTPException(status_code=400, detail="이미 활성 상태입니다.")
    obj.deleted_at = None
    await write_audit_log(
        db, event_type=EventType.RESTORE, entity_type=EntityType.STAFFING,
        entity_id=id, project_id=obj.project_id,
        after_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Staffing restored", "id": id}
