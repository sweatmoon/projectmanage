"""
Projects 라우터 — Audit Log 통합
CREATE/UPDATE/DELETE(soft) 이벤트 자동 기록
프로젝트 삭제 시 하위 단계(phases) · 스태핑(staffing) cascade soft-delete 포함
"""
import json
import logging
import math
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, delete, text
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.database import get_db
from models.projects import Projects
from models.phases import Phases
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries
from services.projects import ProjectsService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType, get_audit_context
from utils.sanitize import sanitize_project_data

limiter = Limiter(key_func=get_remote_address)


async def _cascade_soft_delete_project(db: AsyncSession, project_id: int, now: datetime) -> dict:
    """프로젝트 삭제 시 하위 단계 · 스태핑을 함께 soft-delete.

    Returns:
        {"phases": int, "staffing": int}  — 처리된 건수
    """
    # 활성 단계 조회
    phase_result = await db.execute(
        select(Phases).where(
            Phases.project_id == project_id,
            Phases.deleted_at.is_(None),
        )
    )
    phases = phase_result.scalars().all()

    phase_ids = [ph.id for ph in phases]
    for ph in phases:
        ph.deleted_at = now

    # 활성 스태핑 조회 (project_id 기준 — phase가 이미 삭제됐어도 포함)
    staffing_result = await db.execute(
        select(Staffing).where(
            Staffing.project_id == project_id,
            Staffing.deleted_at.is_(None),
        )
    )
    staffings = staffing_result.scalars().all()
    staffing_ids = [st.id for st in staffings]
    for st in staffings:
        st.deleted_at = now

    # calendar_entries hard-delete (deleted_at 컬럼 없음)
    cal_deleted = 0
    if staffing_ids:
        cal_result = await db.execute(
            delete(Calendar_entries).where(Calendar_entries.staffing_id.in_(staffing_ids))
        )
        cal_deleted = cal_result.rowcount

    logger.info(
        f"[CASCADE] project_id={project_id} → "
        f"phases {len(phases)}개, staffing {len(staffings)}개 cascade soft-delete, "
        f"calendar {cal_deleted}건 hard-delete"
    )
    return {"phases": len(phases), "staffing": len(staffings), "calendar": cal_deleted}

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
    is_won: bool = False

class ProjectsUpdateData(BaseModel):
    project_name: Optional[str] = None
    organization: Optional[str] = None
    status: Optional[str] = None
    deadline: Optional[datetime] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None
    is_won: Optional[bool] = None

class ProjectsResponse(BaseModel):
    id: int
    project_name: str
    organization: str
    status: str
    deadline: Optional[datetime] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None
    color_hue: Optional[int] = None
    is_won: bool = False
    class Config:
        from_attributes = True


async def assign_color_hue(db: AsyncSession) -> int:
    """기존 프로젝트들의 Hue와 가장 멀리 떨어진 Hue 자동 배정"""
    result = await db.execute(
        select(Projects.color_hue).where(
            Projects.deleted_at.is_(None),
            Projects.color_hue.isnot(None)
        )
    )
    existing_hues = sorted([r[0] for r in result.fetchall()])

    if not existing_hues:
        return 0

    # 현재 Hue들 사이에서 가장 넓은 간격의 중간점 탐색
    best_hue = 0
    best_gap = 0
    n = len(existing_hues)
    for i in range(n):
        h1 = existing_hues[i]
        h2 = existing_hues[(i + 1) % n]
        gap = (h2 - h1) % 360
        if gap > best_gap:
            best_gap = gap
            best_hue = (h1 + gap // 2) % 360

    return best_hue

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
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = ProjectsService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=ProjectsListResponse)
async def query_projectss_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100000),
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
@limiter.limit("60/minute")  # 생성 엔드포인트 Rate Limit: 60회/분
async def create_projects(
    data: ProjectsData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    project_data = sanitize_project_data(data.model_dump())  # XSS 방어 sanitize
    project_data['color_hue'] = await assign_color_hue(db)
    result = await service.create(project_data)
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create projects")
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.PROJECT,
        entity_id=result.id, after_obj=result, request=request,
        project_name=result.project_name,
    )
    await db.commit()
    logger.info(f"[AUDIT] Project {result.id} created with color_hue={result.color_hue}")
    return result


@router.post("/batch", response_model=List[ProjectsResponse], status_code=201)
@limiter.limit("20/minute")  # 맹대 생성 Rate Limit: 20회/분
async def create_projectss_batch(
    req: ProjectsBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    results = []
    for item_data in req.items:
        project_data = sanitize_project_data(item_data.model_dump())  # XSS 방어 sanitize
        project_data['color_hue'] = await assign_color_hue(db)
        r = await service.create(project_data)
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
        # is_won은 False도 유효한 값이므로 별도 처리
        if item.updates.is_won is not None:
            update_dict['is_won'] = item.updates.is_won
        update_dict = sanitize_project_data(update_dict)  # XSS 방어 sanitize
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
    # is_won은 False도 유효한 값이므로 별도 처리
    if data.is_won is not None:
        update_dict['is_won'] = data.is_won
    update_dict = sanitize_project_data(update_dict)  # XSS 방어 sanitize
    result = await service.update(id, update_dict)
    event_type = EventType.STATUS_CHANGE if "status" in update_dict else EventType.UPDATE
    await write_audit_log(
        db, event_type=event_type, entity_type=EntityType.PROJECT,
        entity_id=id, before_obj=before, after_obj=result, request=request,
        project_name=result.project_name,
    )
    await db.commit()
    return result


@router.delete("/batch")
async def delete_projectss_batch(
    req: ProjectsBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = ProjectsService(db)
    deleted_count = 0
    now = datetime.now(timezone.utc)
    cascade_summary = {"phases": 0, "staffing": 0}
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            soft_delete(obj)
            deleted_count += 1
            # ── cascade: 하위 단계·스태핑 soft-delete ──────────
            result = await _cascade_soft_delete_project(db, item_id, now)
            cascade_summary["phases"]   += result["phases"]
            cascade_summary["staffing"] += result["staffing"]
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.PROJECT,
                entity_id=item_id, before_obj=obj, request=request,
            )
    await db.commit()
    return {
        "message": f"Deleted {deleted_count} projects",
        "deleted_count": deleted_count,
        "cascade": cascade_summary,
    }


@router.delete("/{id}")
async def delete_projects(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    service = ProjectsService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="Projects not found")
    now = datetime.now(timezone.utc)
    soft_delete(obj)
    # ── cascade: 하위 단계·스태핑 soft-delete ──────────────────
    cascade = await _cascade_soft_delete_project(db, id, now)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.PROJECT,
        entity_id=id, before_obj=obj, request=request,
        project_name=obj.project_name,
    )
    await db.commit()
    logger.info(f"[DELETE] project_id={id} cascade → {cascade}")
    return {"message": "Projects deleted", "id": id, "cascade": cascade}


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
