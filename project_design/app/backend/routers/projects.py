"""
Projects 라우터 — Audit Log 통합
CREATE/UPDATE/DELETE(soft) 이벤트 자동 기록
"""
import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.projects import ProjectsService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/entities/projects", tags=["projects"])


# ── Pydantic Schemas ──────────────────────────────────────────
class ProjectsData(BaseModel):
    project_name: str
    organization: str
    status: str
    deadline: Optional[datetime] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None

class ProjectsUpdateData(BaseModel):
    project_name: Optional[str] = None
    organization: Optional[str] = None
    status: Optional[str] = None
    deadline: Optional[datetime] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None

class ProjectsResponse(BaseModel):
    id: int
    project_name: str
    organization: str
    status: str
    deadline: Optional[datetime] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class ProjectsListResponse(BaseModel):
    items: List[ProjectsResponse]
    total: int; skip: int; limit: int

class ProjectsBatchCreateRequest(BaseModel):
    items: List[ProjectsData]

class ProjectsBatchUpdateItem(BaseModel):
    id: int; updates: ProjectsUpdateData

class ProjectsBatchUpdateRequest(BaseModel):
    items: List[ProjectsBatchUpdateItem]

class ProjectsBatchDeleteRequest(BaseModel):
    ids: List[int]


# ── Routes ────────────────────────────────────────────────────
@router.get("", response_model=ProjectsListResponse)
async def query_projectss(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = ProjectsService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=ProjectsListResponse)
async def query_projectss_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = ProjectsService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/{id}", response_model=ProjectsResponse)
async def get_projects(id: int, db: AsyncSession = Depends(get_db)):
    service = ProjectsService(db)
    result = await service.get_by_id(id)
    if not result:
        raise HTTPException(status_code=404, detail="Projects not found")
    return result


@router.post("", response_model=ProjectsResponse, status_code=201)
async def create_projects(
    data: ProjectsData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    result = await service.create(data.model_dump())
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create projects")
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.PROJECT,
        entity_id=result.id, after_obj=result, request=request,
    )
    await db.commit()
    logger.info(f"[AUDIT] Project {result.id} created")
    return result


@router.post("/batch", response_model=List[ProjectsResponse], status_code=201)
async def create_projectss_batch(
    req: ProjectsBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    results = []
    for item_data in req.items:
        r = await service.create(item_data.model_dump())
        if r:
            results.append(r)
            await write_audit_log(
                db, event_type=EventType.CREATE, entity_type=EntityType.PROJECT,
                entity_id=r.id, after_obj=r, request=request,
            )
    await db.commit()
    return results


@router.put("/batch", response_model=List[ProjectsResponse])
async def update_projectss_batch(
    req: ProjectsBatchUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    results = []
    for item in req.items:
        before = await service.get_by_id(item.id)
        update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
        r = await service.update(item.id, update_dict)
        if r:
            results.append(r)
            et = EventType.STATUS_CHANGE if "status" in update_dict else EventType.UPDATE
            await write_audit_log(
                db, event_type=et, entity_type=EntityType.PROJECT,
                entity_id=r.id, before_obj=before, after_obj=r, request=request,
            )
    await db.commit()
    return results


@router.put("/{id}", response_model=ProjectsResponse)
async def update_projects(
    id: int, data: ProjectsUpdateData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    before = await service.get_by_id(id)
    if not before:
        raise HTTPException(status_code=404, detail="Projects not found")
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    result = await service.update(id, update_dict)
    event_type = EventType.STATUS_CHANGE if "status" in update_dict else EventType.UPDATE
    await write_audit_log(
        db, event_type=event_type, entity_type=EntityType.PROJECT,
        entity_id=id, before_obj=before, after_obj=result, request=request,
    )
    await db.commit()
    return result


@router.delete("/batch")
async def delete_projectss_batch(
    req: ProjectsBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    deleted_count = 0
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            soft_delete(obj)
            deleted_count += 1
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.PROJECT,
                entity_id=item_id, before_obj=obj, request=request,
            )
    await db.commit()
    return {"message": f"Deleted {deleted_count} projects", "deleted_count": deleted_count}


@router.delete("/{id}")
async def delete_projects(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    service = ProjectsService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="Projects not found")
    soft_delete(obj)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.PROJECT,
        entity_id=id, before_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Projects deleted", "id": id}


# ── Restore (soft-delete 복원) ────────────────────────────────
@router.post("/{id}/restore")
async def restore_projects(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    from models.projects import Projects
    from sqlalchemy import select
    result = await db.execute(select(Projects).where(Projects.id == id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Projects not found")
    if obj.deleted_at is None:
        raise HTTPException(status_code=400, detail="이미 활성 상태입니다.")
    obj.deleted_at = None
    await write_audit_log(
        db, event_type=EventType.RESTORE, entity_type=EntityType.PROJECT,
        entity_id=id, after_obj=obj, request=request,
    )
    await db.commit()
    return {"message": "Projects restored", "id": id}
