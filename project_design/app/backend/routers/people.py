"""
People 라우터 — Audit Log 통합
인력 생성/수정/삭제/복원 이벤트 기록, soft-delete 적용
person_name 컨텍스트 포함
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from slowapi import Limiter
from slowapi.util import get_remote_address

from core.database import get_db
from models.staffing import Staffing
from services.people import PeopleService
from services.audit_service import write_audit_log, soft_delete, EventType, EntityType
from utils.sanitize import sanitize_person_data

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/entities/people", tags=["people"])


# ── Pydantic Schemas ──────────────────────────────────────────
class PeopleData(BaseModel):
    person_name: str
    position: Optional[str] = None          # 직급
    team: Optional[str] = None              # 팀 (레거시)
    grade: Optional[str] = None             # 감리원 등급
    employment_status: Optional[str] = None  # 구분
    company: Optional[str] = None           # 소속 회사


class PeopleUpdateData(BaseModel):
    person_name: Optional[str] = None
    position: Optional[str] = None
    team: Optional[str] = None
    grade: Optional[str] = None
    employment_status: Optional[str] = None
    company: Optional[str] = None


class PeopleResponse(BaseModel):
    id: int
    person_name: str
    position: Optional[str] = None
    team: Optional[str] = None
    grade: Optional[str] = None
    employment_status: Optional[str] = None
    company: Optional[str] = None

    class Config:
        from_attributes = True


class PeopleListResponse(BaseModel):
    items: List[PeopleResponse]
    total: int
    skip: int
    limit: int


class PeopleBatchCreateRequest(BaseModel):
    items: List[PeopleData]


class PeopleBatchUpdateItem(BaseModel):
    id: int
    updates: PeopleUpdateData


class PeopleBatchUpdateRequest(BaseModel):
    items: List[PeopleBatchUpdateItem]


class PeopleBatchDeleteRequest(BaseModel):
    ids: List[int]


# ── Routes ────────────────────────────────────────────────────
@router.get("", response_model=PeopleListResponse)
async def query_peoples(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = PeopleService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/all", response_model=PeopleListResponse)
async def query_peoples_all(
    query: str = Query(None), sort: str = Query(None),
    skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=2000),
    fields: str = Query(None), db: AsyncSession = Depends(get_db),
):
    service = PeopleService(db)
    query_dict = json.loads(query) if query else None
    return await service.get_list(skip=skip, limit=limit, query_dict=query_dict, sort=sort)


@router.get("/{id}", response_model=PeopleResponse)
async def get_people(id: int, db: AsyncSession = Depends(get_db)):
    service = PeopleService(db)
    result = await service.get_by_id(id)
    if not result:
        raise HTTPException(status_code=404, detail="People not found")
    return result


async def _remap_staffing_by_names(db: AsyncSession, names: list[str]) -> int:
    """주어진 이름 목록과 일치하는 미매핑 staffing(person_id=None)에 person_id를 자동 연결"""
    if not names:
        return 0
    # 대상 staffing 조회: person_id 없고 person_name_text가 names 중 하나인 것
    stmt = select(Staffing).where(
        and_(
            Staffing.person_id.is_(None),
            Staffing.person_name_text.in_(names),
            Staffing.deleted_at.is_(None),
        )
    )
    result = await db.execute(stmt)
    unmapped = result.scalars().all()
    if not unmapped:
        return 0

    # People 테이블에서 해당 이름들 조회
    from models.people import People
    people_stmt = select(People).where(
        and_(People.person_name.in_(names), People.deleted_at.is_(None))
    )
    people_result = await db.execute(people_stmt)
    people_by_name = {p.person_name.strip(): p for p in people_result.scalars().all()}

    remapped = 0
    for s in unmapped:
        name = (s.person_name_text or '').strip()
        matched = people_by_name.get(name)
        if matched:
            s.person_id = matched.id
            remapped += 1
    logger.info(f"[REMAP] staffing auto-remap: {remapped}건 (names={names})")
    return remapped


@router.post("", response_model=PeopleResponse, status_code=201)
@limiter.limit("60/minute")  # 생성 엔드포인트 Rate Limit: 60회/분
async def create_people(
    data: PeopleData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    result = await service.create(sanitize_person_data(data.model_dump()))  # XSS 방어 sanitize
    if not result:
        raise HTTPException(status_code=400, detail="Failed to create people")
    await write_audit_log(
        db, event_type=EventType.CREATE, entity_type=EntityType.PEOPLE,
        entity_id=result.id, after_obj=result, request=request,
        person_name=result.person_name,
    )
    # 동일 이름의 미매핑 staffing 자동 연결
    await _remap_staffing_by_names(db, [result.person_name])
    await db.commit()
    logger.info(f"[AUDIT] People {result.id} created")
    return result


@router.post("/batch", response_model=List[PeopleResponse], status_code=201)
async def create_peoples_batch(
    req: PeopleBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    results = []
    for item_data in req.items:
        r = await service.create(item_data.model_dump())
        if r:
            results.append(r)
            await write_audit_log(
                db, event_type=EventType.CREATE, entity_type=EntityType.PEOPLE,
                entity_id=r.id, after_obj=r, request=request,
                person_name=r.person_name,
            )
    # 생성된 인력 이름으로 미매핑 staffing 자동 연결
    created_names = [r.person_name for r in results]
    await _remap_staffing_by_names(db, created_names)
    await db.commit()
    return results


class BatchUpsertResponse(BaseModel):
    created: List[PeopleResponse]
    updated: List[PeopleResponse]
    skipped: List[str]  # 처리 실패한 이름 목록


@router.post("/batch-upsert", response_model=BatchUpsertResponse, status_code=200)
async def upsert_peoples_batch(
    req: PeopleBatchCreateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    """이름 기준 upsert: 동일 이름 존재 시 UPDATE, 없으면 CREATE.
    프론트엔드 중복 체크에 의존하지 않고 서버 단에서 안전하게 처리."""
    from models.people import People
    service = PeopleService(db)

    # 1) 요청된 이름 목록으로 기존 인력 일괄 조회
    names = [item.person_name.strip() for item in req.items if item.person_name.strip()]
    existing_stmt = select(People).where(
        and_(People.person_name.in_(names), People.deleted_at.is_(None))
    )
    existing_result = await db.execute(existing_stmt)
    existing_by_name: dict[str, People] = {
        p.person_name.strip(): p for p in existing_result.scalars().all()
    }

    created_list: List[PeopleResponse] = []
    updated_list: List[PeopleResponse] = []
    skipped_list: List[str] = []

    for item_data in req.items:
        name = item_data.person_name.strip()
        if not name:
            continue
        data_dict = sanitize_person_data(item_data.model_dump())

        existing = existing_by_name.get(name)
        try:
            if existing:
                # UPDATE: 변경된 필드만 반영 (None이 아닌 값만)
                update_dict = {k: v for k, v in data_dict.items()
                               if k != 'person_name' and v is not None and v != ''}
                if update_dict:
                    r = await service.update(existing.id, update_dict)
                else:
                    r = existing
                if r:
                    updated_list.append(r)
                    await write_audit_log(
                        db, event_type=EventType.UPDATE, entity_type=EntityType.PEOPLE,
                        entity_id=r.id, before_obj=existing, after_obj=r, request=request,
                        person_name=r.person_name,
                    )
            else:
                # CREATE
                r = await service.create(data_dict)
                if r:
                    created_list.append(r)
                    await write_audit_log(
                        db, event_type=EventType.CREATE, entity_type=EntityType.PEOPLE,
                        entity_id=r.id, after_obj=r, request=request,
                        person_name=r.person_name,
                    )
        except Exception as e:
            logger.error(f"[UPSERT] failed for '{name}': {e}")
            skipped_list.append(name)

    # 신규 생성된 인력 이름으로 미매핑 staffing 자동 연결
    new_names = [r.person_name for r in created_list]
    if new_names:
        await _remap_staffing_by_names(db, new_names)
    await db.commit()

    logger.info(f"[UPSERT] created={len(created_list)}, updated={len(updated_list)}, skipped={len(skipped_list)}")
    return BatchUpsertResponse(
        created=created_list,
        updated=updated_list,
        skipped=skipped_list,
    )


@router.put("/batch", response_model=List[PeopleResponse])
async def update_peoples_batch(
    req: PeopleBatchUpdateRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    results = []
    for item in req.items:
        before = await service.get_by_id(item.id)
        update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
        update_dict = sanitize_person_data(update_dict)  # XSS 방어 sanitize
        r = await service.update(item.id, update_dict)
        if r:
            results.append(r)
            await write_audit_log(
                db, event_type=EventType.UPDATE, entity_type=EntityType.PEOPLE,
                entity_id=r.id, before_obj=before, after_obj=r, request=request,
                person_name=r.person_name,
            )
    await db.commit()
    return results


@router.put("/{id}", response_model=PeopleResponse)
async def update_people(
    id: int, data: PeopleUpdateData, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    before = await service.get_by_id(id)
    if not before:
        raise HTTPException(status_code=404, detail="People not found")
    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    update_dict = sanitize_person_data(update_dict)  # XSS 방어 sanitize
    result = await service.update(id, update_dict)
    await write_audit_log(
        db, event_type=EventType.UPDATE, entity_type=EntityType.PEOPLE,
        entity_id=id, before_obj=before, after_obj=result, request=request,
        person_name=result.person_name,
    )
    await db.commit()
    return result


@router.delete("/batch")
async def delete_peoples_batch(
    req: PeopleBatchDeleteRequest, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    deleted_count = 0
    for item_id in req.ids:
        obj = await service.get_by_id(item_id)
        if obj:
            soft_delete(obj)
            deleted_count += 1
            await write_audit_log(
                db, event_type=EventType.DELETE, entity_type=EntityType.PEOPLE,
                entity_id=item_id, before_obj=obj, request=request,
                person_name=obj.person_name,
            )
    await db.commit()
    return {"message": f"Deleted {deleted_count} people", "deleted_count": deleted_count}


@router.delete("/{id}")
async def delete_people(
    id: int, request: Request, db: AsyncSession = Depends(get_db)
):
    service = PeopleService(db)
    obj = await service.get_by_id(id)
    if not obj:
        raise HTTPException(status_code=404, detail="People not found")
    soft_delete(obj)
    await write_audit_log(
        db, event_type=EventType.DELETE, entity_type=EntityType.PEOPLE,
        entity_id=id, before_obj=obj, request=request,
        person_name=obj.person_name,
    )
    await db.commit()
    return {"message": "People deleted", "id": id}


@router.post("/{id}/restore")
async def restore_people(id: int, request: Request, db: AsyncSession = Depends(get_db)):
    from models.people import People
    result = await db.execute(select(People).where(People.id == id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="People not found")
    if obj.deleted_at is None:
        raise HTTPException(status_code=400, detail="이미 활성 상태입니다.")
    obj.deleted_at = None
    await write_audit_log(
        db, event_type=EventType.RESTORE, entity_type=EntityType.PEOPLE,
        entity_id=id, after_obj=obj, request=request,
        person_name=obj.person_name,
    )
    await db.commit()
    return {"message": "People restored", "id": id}
