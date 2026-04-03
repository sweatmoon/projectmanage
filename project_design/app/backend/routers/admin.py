"""
관리자 전용 API 라우터
접근 권한: role == 'admin' 만 허용
- /admin/stats                            : 시스템 통계
- /admin/logs                             : 접속 로그 (legacy)
- /admin/users                            : 사용자 목록
- /admin/users/{id}/role                  : 역할 변경 (audit log 기록)
- /admin/audit                            : 감사 로그 조회 (필터, 페이징)
- /admin/audit/export/csv                 : CSV 내보내기
- /admin/audit/archive                    : 오래된 로그 아카이빙
- /admin/audit/rollback/{id}              : 단건 레코드 롤백 (before_data 복원)
- /admin/audit/project-rollback/{id}      : 사업 단위 통째 롤백 (project+phases+staffing+calendar)
- /admin/audit/phase-rollback/{id}        : 단계 단위 통째 롤백 (phase+staffing+calendar)
"""
import csv
import io
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, func, or_, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.auth import AccessLog, User, AllowedUser, PendingUser
from models.audit import AuditLog, AuditLogArchive
from services.audit_service import write_audit_log, archive_old_logs, EventType, EntityType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 관리자 권한 확인 의존성 ────────────────────────────────
def _is_auth_configured() -> bool:
    """인증이 설정된 환경인지 확인 (Synology SSO 또는 Google OAuth 중 하나라도 설정되면 True)"""
    return bool(os.environ.get("OIDC_ISSUER_URL", "") or os.environ.get("GOOGLE_CLIENT_ID", ""))


def require_admin(request: Request):
    # 인증 미설정(개발 환경)이면 admin 스킵
    if not _is_auth_configured():
        return request
    role = getattr(request.state, "user_role", "user")
    if role not in ("admin", "audit_viewer"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 또는 감사자 권한이 필요합니다."
        )
    return request


def require_admin_only(request: Request):
    """쓰기 작업은 admin만 허용"""
    if not _is_auth_configured():
        return request
    role = getattr(request.state, "user_role", "user")
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다."
        )
    return request


# ── 응답 모델 ──────────────────────────────────────────────
class AccessLogItem(BaseModel):
    id: int
    timestamp: Optional[datetime]
    user_id: Optional[str]
    user_email: Optional[str]
    user_name: Optional[str]
    action: str
    method: Optional[str]
    path: Optional[str]
    status_code: Optional[int]
    ip_address: Optional[str]
    user_agent: Optional[str]
    duration_ms: Optional[int]

    class Config:
        from_attributes = True


class UserItem(BaseModel):
    id: str
    email: str
    name: Optional[str]
    role: str
    created_at: Optional[datetime]
    last_login: Optional[datetime]

    class Config:
        from_attributes = True


class AdminStats(BaseModel):
    total_users: int
    total_logins_today: int
    total_api_calls_today: int
    active_users_7days: int


class AuditLogItem(BaseModel):
    id: int
    event_id: str
    event_type: str
    entity_type: str
    entity_id: Optional[str]
    project_id: Optional[int]
    user_id: Optional[str]
    user_name: Optional[str]
    user_role: Optional[str]
    timestamp: datetime
    client_ip: Optional[str]
    user_agent: Optional[str]
    request_path: Optional[str]
    request_id: Optional[str]
    before_data: Optional[str]
    after_data: Optional[str]
    changed_fields: Optional[str]
    is_system_action: bool
    description: Optional[str]

    class Config:
        from_attributes = True


class AuditLogListResponse(BaseModel):
    items: List[AuditLogItem]
    total: int
    skip: int
    limit: int
    has_more: bool


# ── 1. 통계 대시보드 ───────────────────────────────────────
@router.get("/stats", response_model=AdminStats)
async def get_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    total_users_result = await db.execute(select(func.count(User.id)))
    total_users = total_users_result.scalar() or 0

    today_logins_result = await db.execute(
        select(func.count(AccessLog.id)).where(
            AccessLog.action == "login",
            AccessLog.timestamp >= today_start,
        )
    )
    total_logins_today = today_logins_result.scalar() or 0

    today_api_result = await db.execute(
        select(func.count(AccessLog.id)).where(
            AccessLog.action == "api",
            AccessLog.timestamp >= today_start,
        )
    )
    total_api_calls_today = today_api_result.scalar() or 0

    active_users_result = await db.execute(
        select(func.count(func.distinct(AccessLog.user_id))).where(
            AccessLog.timestamp >= week_ago,
            AccessLog.user_id.isnot(None),
        )
    )
    active_users_7days = active_users_result.scalar() or 0

    return AdminStats(
        total_users=total_users,
        total_logins_today=total_logins_today,
        total_api_calls_today=total_api_calls_today,
        active_users_7days=active_users_7days,
    )


# ── 2. 접속 로그 목록 (legacy) ─────────────────────────────
@router.get("/logs", response_model=List[AccessLogItem])
async def get_access_logs(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
    action: Optional[str] = Query(None, description="login / logout / api"),
    user_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    query = select(AccessLog).order_by(desc(AccessLog.timestamp))
    if action:
        query = query.where(AccessLog.action == action)
    if user_id:
        query = query.where(AccessLog.user_id == user_id)
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    logs = result.scalars().all()
    return logs


# ── 3. 사용자 목록 ─────────────────────────────────────────
@router.get("/users", response_model=List[UserItem])
async def get_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    result = await db.execute(select(User).order_by(desc(User.last_login)))
    users = result.scalars().all()
    return users


# ── 4. 사용자 역할 변경 (audit log 포함) ────────────────────
class RoleUpdateRequest(BaseModel):
    role: str  # "admin" or "user" or "viewer" or "audit_viewer"


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    if body.role not in ("admin", "leader", "user", "viewer", "audit_viewer"):
        raise HTTPException(status_code=400, detail="role은 'admin', 'leader', 'user', 'viewer', 'audit_viewer'만 가능합니다.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    admin_users = [u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()]
    if user_id in admin_users or user.email in admin_users:
        raise HTTPException(status_code=403, detail="환경변수로 지정된 admin은 변경할 수 없습니다.")

    old_role = user.role
    user.role = body.role

    await write_audit_log(
        db,
        event_type=EventType.USER_ROLE_CHANGE,
        entity_type=EntityType.USER,
        entity_id=user_id,
        before_obj={"role": old_role, "user_id": user_id, "email": user.email},
        after_obj={"role": body.role, "user_id": user_id, "email": user.email},
        request=request,
        description=f"사용자 {user.email} 역할 변경: {old_role} → {body.role}",
    )
    await db.commit()
    return {"message": f"사용자 {user_id} 역할이 {body.role}로 변경되었습니다."}


# ── 5. 감사 로그 조회 ─────────────────────────────────────
@router.get("/audit", response_model=AuditLogListResponse)
async def get_audit_logs(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
    # 필터 파라미터
    event_type: Optional[str] = Query(None, description="CREATE, UPDATE, DELETE, RESTORE, STATUS_CHANGE, BULK_IMPORT, BULK_OVERWRITE, SYNC, LOGIN, LOGOUT, USER_ROLE_CHANGE"),
    entity_type: Optional[str] = Query(None, description="project, phase, staffing, calendar_entry, people, user"),
    project_id: Optional[int] = Query(None),
    user_id: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    is_system_action: Optional[bool] = Query(None),
    # 날짜 범위
    date_from: Optional[datetime] = Query(None, description="ISO 8601 형식 (UTC)"),
    date_to: Optional[datetime] = Query(None, description="ISO 8601 형식 (UTC)"),
    # 전문 검색
    search: Optional[str] = Query(None, description="description / changed_fields 전문 검색"),
    # 페이징
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    # 아카이브 포함 여부
    include_archive: bool = Query(False),
):
    filters = []

    if event_type:
        filters.append(AuditLog.event_type == event_type.upper())
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type.lower())
    if project_id is not None:
        filters.append(AuditLog.project_id == project_id)
    if user_id:
        filters.append(AuditLog.user_id == user_id)
    if entity_id:
        filters.append(AuditLog.entity_id == entity_id)
    if is_system_action is not None:
        filters.append(AuditLog.is_system_action == is_system_action)
    if date_from:
        filters.append(AuditLog.timestamp >= date_from)
    if date_to:
        filters.append(AuditLog.timestamp <= date_to)
    if search:
        search_like = f"%{search}%"
        filters.append(
            or_(
                AuditLog.description.ilike(search_like),
                AuditLog.changed_fields.ilike(search_like),
                AuditLog.before_data.ilike(search_like),
                AuditLog.after_data.ilike(search_like),
                AuditLog.user_name.ilike(search_like),
            )
        )

    # 총 건수
    count_stmt = select(func.count(AuditLog.id))
    if filters:
        count_stmt = count_stmt.where(and_(*filters))
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    # 데이터 조회
    stmt = select(AuditLog).order_by(desc(AuditLog.timestamp))
    if filters:
        stmt = stmt.where(and_(*filters))
    stmt = stmt.offset(skip).limit(limit)
    result = await db.execute(stmt)
    logs = result.scalars().all()

    return AuditLogListResponse(
        items=logs,
        total=total,
        skip=skip,
        limit=limit,
        has_more=(skip + limit) < total,
    )


# ── 6. 감사 로그 단건 조회 ────────────────────────────────
@router.get("/audit/{event_id}", response_model=AuditLogItem)
async def get_audit_log_detail(
    event_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    result = await db.execute(
        select(AuditLog).where(AuditLog.event_id == event_id)
    )
    log = result.scalar_one_or_none()
    if not log:
        # 아카이브에서 검색
        archive_result = await db.execute(
            select(AuditLogArchive).where(AuditLogArchive.event_id == event_id)
        )
        archive_log = archive_result.scalar_one_or_none()
        if not archive_log:
            raise HTTPException(status_code=404, detail="감사 로그를 찾을 수 없습니다.")
        # AuditLogArchive를 AuditLogItem으로 변환
        return AuditLogItem(
            id=archive_log.id,
            event_id=archive_log.event_id,
            event_type=archive_log.event_type,
            entity_type=archive_log.entity_type,
            entity_id=archive_log.entity_id,
            project_id=archive_log.project_id,
            user_id=archive_log.user_id,
            user_name=archive_log.user_name,
            user_role=archive_log.user_role,
            timestamp=archive_log.timestamp,
            client_ip=archive_log.client_ip,
            user_agent=archive_log.user_agent,
            request_path=archive_log.request_path,
            request_id=archive_log.request_id,
            before_data=archive_log.before_data,
            after_data=archive_log.after_data,
            changed_fields=archive_log.changed_fields,
            is_system_action=archive_log.is_system_action,
            description=archive_log.description,
        )
    return log


# ── 7. 감사 로그 CSV 내보내기 ─────────────────────────────
@router.get("/audit/export/csv")
async def export_audit_logs_csv(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
    event_type: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    project_id: Optional[int] = Query(None),
    user_id: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(5000, le=10000),
):
    filters = []
    if event_type:
        filters.append(AuditLog.event_type == event_type.upper())
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type.lower())
    if project_id is not None:
        filters.append(AuditLog.project_id == project_id)
    if user_id:
        filters.append(AuditLog.user_id == user_id)
    if date_from:
        filters.append(AuditLog.timestamp >= date_from)
    if date_to:
        filters.append(AuditLog.timestamp <= date_to)
    if search:
        search_like = f"%{search}%"
        filters.append(
            or_(
                AuditLog.description.ilike(search_like),
                AuditLog.changed_fields.ilike(search_like),
                AuditLog.user_name.ilike(search_like),
            )
        )

    stmt = select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(limit)
    if filters:
        stmt = stmt.where(and_(*filters))

    result = await db.execute(stmt)
    logs = result.scalars().all()

    # CSV 생성
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "event_id", "timestamp", "event_type", "entity_type", "entity_id",
        "project_id", "user_id", "user_name", "user_role",
        "client_ip", "request_path", "is_system_action", "description",
        "changed_fields",
    ])
    for log in logs:
        # KST 변환 (UTC+9)
        ts_kst = log.timestamp
        if ts_kst and ts_kst.tzinfo:
            ts_kst = ts_kst.astimezone(timezone(timedelta(hours=9)))
        writer.writerow([
            log.event_id,
            ts_kst.isoformat() if ts_kst else "",
            log.event_type,
            log.entity_type,
            log.entity_id or "",
            log.project_id or "",
            log.user_id or "",
            log.user_name or "",
            log.user_role or "",
            log.client_ip or "",
            log.request_path or "",
            "Y" if log.is_system_action else "N",
            log.description or "",
            log.changed_fields or "",
        ])

    output.seek(0)
    filename = f"audit_log_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── 8. 아카이빙 트리거 ────────────────────────────────────
@router.post("/audit/archive")
async def trigger_archive(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
    months: int = Query(12, ge=1, le=24, description="몇 개월 이상 된 로그를 아카이브할지"),
):
    count = await archive_old_logs(db, months=months)
    return {
        "message": f"{months}개월 이상 로그 {count}건을 아카이브 테이블로 이관했습니다.",
        "archived_count": count,
    }


# ── 9. 엔티티 히스토리 타임라인 ──────────────────────────
@router.get("/audit/timeline/{entity_type}/{entity_id}", response_model=List[AuditLogItem])
async def get_entity_timeline(
    entity_type: str,
    entity_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
    limit: int = Query(100, le=500),
):
    """특정 엔티티의 전체 변경 이력을 시간순으로 반환"""
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.entity_type == entity_type.lower(),
            AuditLog.entity_id == str(entity_id),
        )
        .order_by(AuditLog.timestamp)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


# ══════════════════════════════════════════════════════════════
# ── 8. 접속 허용 사용자 관리 ──────────────────────────────────
# ══════════════════════════════════════════════════════════════

class AllowedUserItem(BaseModel):
    id: int
    user_id: str
    display_name: Optional[str]
    role: str
    is_active: bool
    created_at: Optional[datetime]
    created_by: Optional[str]
    note: Optional[str]

    class Config:
        from_attributes = True


class AllowedUserCreate(BaseModel):
    user_id: str
    display_name: Optional[str] = None
    role: str = "user"          # user / leader / admin / viewer
    note: Optional[str] = None


class AllowedUserUpdate(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    note: Optional[str] = None


@router.get("/allowed-users", response_model=List[AllowedUserItem])
async def list_allowed_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    """허용 사용자 목록 조회"""
    result = await db.execute(
        select(AllowedUser).order_by(AllowedUser.created_at.desc())
    )
    return result.scalars().all()


@router.post("/allowed-users", response_model=AllowedUserItem)
async def create_allowed_user(
    body: AllowedUserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """허용 사용자 추가"""
    # 중복 체크
    existing = await db.execute(
        select(AllowedUser).where(AllowedUser.user_id == body.user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"이미 등록된 사용자입니다: {body.user_id}")

    if body.role not in ("user", "leader", "admin", "viewer"):
        raise HTTPException(status_code=400, detail="role은 user, leader, admin, viewer 만 허용됩니다.")

    admin_id = getattr(request.state, "user_id", "system")
    new_entry = AllowedUser(
        user_id=body.user_id,
        display_name=body.display_name,
        role=body.role,
        is_active=True,
        created_by=admin_id,
        note=body.note,
    )
    db.add(new_entry)
    await db.flush()
    await db.refresh(new_entry)
    await db.commit()
    logger.info(f"AllowedUser added: {body.user_id} role={body.role} by {admin_id}")
    return new_entry


@router.put("/allowed-users/{user_id}", response_model=AllowedUserItem)
async def update_allowed_user(
    user_id: str,
    body: AllowedUserUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """허용 사용자 수정 (역할/활성화/메모)"""
    result = await db.execute(
        select(AllowedUser).where(AllowedUser.user_id == user_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    if body.role is not None:
        if body.role not in ("user", "leader", "admin", "viewer"):
            raise HTTPException(status_code=400, detail="role은 user, leader, admin, viewer 만 허용됩니다.")
        entry.role = body.role
    if body.display_name is not None:
        entry.display_name = body.display_name
    if body.is_active is not None:
        entry.is_active = body.is_active
    if body.note is not None:
        entry.note = body.note

    await db.commit()
    await db.refresh(entry)
    admin_id = getattr(request.state, "user_id", "system")
    logger.info(f"AllowedUser updated: {user_id} by {admin_id}")
    return entry


@router.delete("/allowed-users/{user_id}")
async def delete_allowed_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """허용 사용자 삭제"""
    result = await db.execute(
        select(AllowedUser).where(AllowedUser.user_id == user_id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    await db.delete(entry)
    await db.commit()
    admin_id = getattr(request.state, "user_id", "system")
    logger.info(f"AllowedUser deleted: {user_id} by {admin_id}")
    return {"ok": True, "deleted": user_id}


# ══════════════════════════════════════════════════════════════
# ── 단건 레코드 롤백 API ─────────────────────────────────────
# ══════════════════════════════════════════════════════════════

# 롤백 가능한 엔티티 → (테이블 모델, 제외 필드)
_ROLLBACK_SKIP_FIELDS = {
    "id", "deleted_at",   # id·삭제상태는 복원하지 않음
}

# 엔티티별 복원 제외 필드 (자동 관리 필드)
_ENTITY_SKIP = {
    "project":       {"id", "deleted_at", "color_hue"},
    "phase":         {"id", "deleted_at"},
    "staffing":      {"id", "deleted_at"},
    "people":        {"id", "deleted_at"},
    "calendar_entry": {"id", "deleted_at"},
}


async def _get_model_class(entity_type: str):
    """entity_type 문자열 → SQLAlchemy 모델 클래스"""
    mapping = {
        "project":        ("models.projects",        "Projects"),
        "phase":          ("models.phases",           "Phases"),
        "staffing":       ("models.staffing",         "Staffing"),
        "people":         ("models.people",           "People"),
        "calendar_entry": ("models.calendar_entries", "CalendarEntries"),
    }
    if entity_type not in mapping:
        return None
    module_name, class_name = mapping[entity_type]
    import importlib
    mod = importlib.import_module(module_name)
    return getattr(mod, class_name, None)


class RollbackResponse(BaseModel):
    ok: bool
    event_id: str
    entity_type: str
    entity_id: str
    rolled_back_fields: List[str]
    rollback_audit_event_id: str


@router.post("/audit/rollback/{event_id}", response_model=RollbackResponse)
async def rollback_audit_log(
    event_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """
    감사 로그 단건 롤백.
    해당 이벤트의 before_data를 사용하여 레코드를 이전 상태로 복원.

    - DELETE 이벤트: soft-delete 해제 (deleted_at = None) + before_data 복원
    - CREATE 이벤트: soft-delete (삭제 처리)
    - UPDATE / STATUS_CHANGE 이벤트: before_data 필드들을 현재 레코드에 덮어씀
    """
    # 1) 감사 로그 조회
    log_result = await db.execute(
        select(AuditLog).where(AuditLog.event_id == event_id)
    )
    audit_log = log_result.scalar_one_or_none()
    if not audit_log:
        raise HTTPException(status_code=404, detail="감사 로그를 찾을 수 없습니다.")

    entity_type = audit_log.entity_type
    entity_id = audit_log.entity_id
    event_type_val = audit_log.event_type

    if not entity_id:
        # calendar_entry 일괄 토글은 여러 셀을 한 번에 변경하므로 단건 롤백 불가
        if entity_type == "calendar_entry":
            raise HTTPException(
                status_code=400,
                detail=(
                    "일정 셀은 한 번에 여러 개를 일괄 변경하므로 자동 롤백이 불가합니다.\n"
                    "before_data의 셀 목록을 확인하여 수동으로 되돌려 주세요."
                )
            )
        raise HTTPException(status_code=400, detail="entity_id가 없어 롤백할 수 없습니다.")

    # 2) 모델 클래스 조회
    ModelClass = await _get_model_class(entity_type)
    if ModelClass is None:
        raise HTTPException(
            status_code=400,
            detail=f"'{entity_type}' 엔티티는 롤백을 지원하지 않습니다."
        )

    # 3) 현재 레코드 조회
    try:
        entity_id_int = int(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="entity_id가 정수가 아닙니다.")

    obj_result = await db.execute(
        select(ModelClass).where(ModelClass.id == entity_id_int)
    )
    obj = obj_result.scalar_one_or_none()

    rolled_back_fields: List[str] = []

    if event_type_val == "CREATE":
        # CREATE 롤백 = 레코드 soft-delete
        if obj is None:
            raise HTTPException(status_code=404, detail="대상 레코드를 찾을 수 없습니다.")
        if not hasattr(obj, "deleted_at"):
            raise HTTPException(status_code=400, detail="이 엔티티는 soft-delete를 지원하지 않습니다.")
        obj.deleted_at = datetime.now(timezone.utc)
        rolled_back_fields = ["deleted_at"]

    else:
        # UPDATE / STATUS_CHANGE / DELETE 롤백 = before_data 복원
        if not audit_log.before_data:
            raise HTTPException(
                status_code=400,
                detail="before_data가 없습니다. 이 이벤트는 롤백할 수 없습니다."
            )

        before_dict: dict = json.loads(audit_log.before_data)
        skip_fields = _ENTITY_SKIP.get(entity_type, _ROLLBACK_SKIP_FIELDS)

        if obj is None:
            raise HTTPException(status_code=404, detail="대상 레코드를 찾을 수 없습니다.")

        # DELETE 롤백: soft-delete 해제
        if event_type_val == "DELETE" and hasattr(obj, "deleted_at"):
            obj.deleted_at = None
            rolled_back_fields.append("deleted_at(복원)")

        # before_data 필드 적용
        for field, val in before_dict.items():
            if field in skip_fields:
                continue
            if not hasattr(obj, field):
                continue
            # date/datetime 문자열 파싱
            col = ModelClass.__table__.columns.get(field)
            if col is not None and val is not None:
                import sqlalchemy
                if isinstance(col.type, (sqlalchemy.DateTime,)):
                    try:
                        from datetime import datetime as dt
                        val = dt.fromisoformat(str(val))
                    except Exception:
                        pass
                elif isinstance(col.type, sqlalchemy.Date):
                    try:
                        from datetime import date as d
                        val = d.fromisoformat(str(val))
                    except Exception:
                        pass
            setattr(obj, field, val)
            rolled_back_fields.append(field)

    # 4) 롤백 자체도 감사 로그에 기록
    new_event_id = str(__import__("uuid").uuid4())
    rollback_log = AuditLog(
        event_id         = new_event_id,
        event_type       = "ROLLBACK",
        entity_type      = entity_type,
        entity_id        = entity_id,
        project_id       = audit_log.project_id,
        user_id          = getattr(request.state, "user_id", None),
        user_name        = getattr(request.state, "user_name", None),
        user_role        = getattr(request.state, "user_role", None),
        timestamp        = datetime.now(timezone.utc),
        client_ip        = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                           or (request.client.host if request.client else ""),
        user_agent       = request.headers.get("User-Agent", ""),
        request_path     = str(request.url.path),
        request_id       = str(__import__("uuid").uuid4()),
        before_data      = audit_log.after_data,   # 롤백 전 = 이전 이벤트의 after
        after_data       = audit_log.before_data,  # 롤백 후 = 이전 이벤트의 before
        changed_fields   = json.dumps({"rolled_back_from_event": event_id}, ensure_ascii=False),
        is_system_action = False,
        description      = (
            f"롤백: event_id={event_id} ({event_type_val} → 복원), "
            f"필드: {', '.join(rolled_back_fields)}"
        ),
    )
    db.add(rollback_log)
    await db.commit()

    logger.info(
        f"[ROLLBACK] entity={entity_type}/{entity_id} "
        f"event={event_id} fields={rolled_back_fields}"
    )

    return RollbackResponse(
        ok=True,
        event_id=event_id,
        entity_type=entity_type,
        entity_id=entity_id,
        rolled_back_fields=rolled_back_fields,
        rollback_audit_event_id=new_event_id,
    )


# ══════════════════════════════════════════════════════════════
# ── 사업 단위 통째 롤백 API ──────────────────────────────────
# ══════════════════════════════════════════════════════════════

class ProjectRollbackResponse(BaseModel):
    ok: bool
    project_id: int
    restored: dict       # { "project": bool, "phases": int, "staffing": int, "calendar": int }
    rollback_audit_event_id: str


async def _restore_calendar_for_staffing_ids(db: AsyncSession, staffing_ids: List[int]) -> int:
    """
    복원된 staffing의 캘린더 항목을 phase 날짜 범위 기반으로 재생성한다.
    calendar_entries에 deleted_at 컬럼이 없으므로 hard-delete 후 재생성 방식 사용.
    """
    from models.calendar_entries import Calendar_entries
    from models.staffing import Staffing
    from models.phases import Phases
    from utils.holidays import get_consecutive_business_days
    import sqlalchemy

    restored_count = 0
    for sid in staffing_ids:
        # 기존 항목 삭제
        await db.execute(
            sqlalchemy.delete(Calendar_entries).where(
                Calendar_entries.staffing_id == sid
            )
        )
        # staffing 정보 조회
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.id == sid, Staffing.deleted_at.is_(None))
        )
        staffing = staffing_result.scalar_one_or_none()
        if not staffing or not staffing.md or staffing.md <= 0:
            continue

        # phase 날짜 범위 조회
        phase_result = await db.execute(
            select(Phases).where(Phases.id == staffing.phase_id, Phases.deleted_at.is_(None))
        )
        phase = phase_result.scalar_one_or_none()
        if not phase or not phase.start_date or not phase.end_date:
            continue

        # 영업일 MD 수만큼 캘린더 재생성
        biz_days = get_consecutive_business_days(phase.start_date, phase.end_date, staffing.md)
        new_entries = [
            Calendar_entries(staffing_id=sid, entry_date=d, status="")
            for d in biz_days
        ]
        if new_entries:
            db.add_all(new_entries)
            restored_count += len(new_entries)

    return restored_count


@router.post("/audit/project-rollback/{project_id}", response_model=ProjectRollbackResponse)
async def project_rollback(
    project_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """
    사업 단위 통째 롤백.

    project_id에 해당하는 사업과 그 하위 모든 데이터를 복원/삭제한다.

    - 사업이 soft-delete 상태 (deleted_at 있음)  → 복원 (project + phases + staffing + calendar 재생성)
    - 사업이 활성 상태 (deleted_at 없음)          → 전체 soft-delete (project + phases + staffing + calendar 삭제)
    """
    from models.projects import Projects
    from models.phases import Phases
    from models.staffing import Staffing
    from models.calendar_entries import Calendar_entries
    import sqlalchemy

    # 1) 사업 조회 (soft-delete 포함해서)
    proj_result = await db.execute(select(Projects).where(Projects.id == project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"사업 ID {project_id}를 찾을 수 없습니다.")

    is_deleted = project.deleted_at is not None
    action = "RESTORE" if is_deleted else "DELETE"
    now = datetime.now(timezone.utc)

    restored = {"project": False, "phases": 0, "staffing": 0, "calendar": 0}

    # 2) 사업 복원 or 삭제
    project.deleted_at = None if is_deleted else now
    restored["project"] = True

    # 3) 하위 단계 모두 복원 or 삭제 (soft-delete 포함 전체)
    phases_result = await db.execute(
        select(Phases).where(Phases.project_id == project_id)
    )
    phases = phases_result.scalars().all()
    phase_ids = [p.id for p in phases]

    for phase in phases:
        phase.deleted_at = None if is_deleted else now
        restored["phases"] += 1

    # 4) 하위 투입공수 모두 복원 or 삭제
    staffing_ids: List[int] = []
    if phase_ids:
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.phase_id.in_(phase_ids))
        )
        staffings = staffing_result.scalars().all()
        for s in staffings:
            s.deleted_at = None if is_deleted else now
            staffing_ids.append(s.id)
            restored["staffing"] += 1

    # 5) 캘린더 처리
    if staffing_ids:
        if is_deleted:
            # 복원 시: 캘린더 재생성
            cal_count = await _restore_calendar_for_staffing_ids(db, staffing_ids)
            restored["calendar"] = cal_count
        else:
            # 삭제 시: calendar_entries는 hard-delete (deleted_at 없음)
            del_result = await db.execute(
                sqlalchemy.delete(Calendar_entries).where(
                    Calendar_entries.staffing_id.in_(staffing_ids)
                )
            )
            restored["calendar"] = del_result.rowcount

    # 6) 감사 로그 기록
    new_event_id = str(__import__("uuid").uuid4())
    rollback_log = AuditLog(
        event_id         = new_event_id,
        event_type       = "ROLLBACK",
        entity_type      = "project",
        entity_id        = str(project_id),
        project_id       = project_id,
        user_id          = getattr(request.state, "user_id", None),
        user_name        = getattr(request.state, "user_name", None),
        user_role        = getattr(request.state, "user_role", None),
        timestamp        = now,
        client_ip        = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                           or (request.client.host if request.client else ""),
        user_agent       = request.headers.get("User-Agent", ""),
        request_path     = str(request.url.path),
        request_id       = str(__import__("uuid").uuid4()),
        changed_fields   = json.dumps({"action": action, "restored": restored}, ensure_ascii=False),
        is_system_action = False,
        description      = (
            f"[사업 전체 {'복원' if is_deleted else '삭제'}] {project.project_name} — "
            f"단계 {restored['phases']}개, 투입공수 {restored['staffing']}개, "
            f"일정 {restored['calendar']}개"
        ),
    )
    db.add(rollback_log)
    await db.commit()

    logger.info(
        f"[PROJECT ROLLBACK] project_id={project_id} action={action} restored={restored}"
    )

    return ProjectRollbackResponse(
        ok=True,
        project_id=project_id,
        restored=restored,
        rollback_audit_event_id=new_event_id,
    )


# ══════════════════════════════════════════════════════════════
# ── 단계 단위 통째 롤백 API ──────────────────────────────────
# ══════════════════════════════════════════════════════════════

class PhaseRollbackResponse(BaseModel):
    ok: bool
    phase_id: int
    restored: dict       # { "phase": bool, "staffing": int, "calendar": int }
    rollback_audit_event_id: str


@router.post("/audit/phase-rollback/{phase_id}", response_model=PhaseRollbackResponse)
async def phase_rollback(
    phase_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """
    단계 단위 통째 롤백.

    phase_id에 해당하는 단계와 그 하위 투입공수/캘린더를 복원/삭제한다.

    - 단계가 soft-delete 상태 (deleted_at 있음)  → 복원
    - 단계가 활성 상태 (deleted_at 없음)          → 전체 soft-delete
    """
    from models.phases import Phases
    from models.staffing import Staffing
    from models.calendar_entries import Calendar_entries
    import sqlalchemy

    # 1) 단계 조회 (soft-delete 포함)
    phase_result = await db.execute(select(Phases).where(Phases.id == phase_id))
    phase = phase_result.scalar_one_or_none()
    if not phase:
        raise HTTPException(status_code=404, detail=f"단계 ID {phase_id}를 찾을 수 없습니다.")

    is_deleted = phase.deleted_at is not None
    action = "RESTORE" if is_deleted else "DELETE"
    now = datetime.now(timezone.utc)

    restored = {"phase": False, "staffing": 0, "calendar": 0}

    # 2) 단계 복원 or 삭제
    phase.deleted_at = None if is_deleted else now
    restored["phase"] = True

    # 3) 하위 투입공수 모두 복원 or 삭제
    staffing_result = await db.execute(
        select(Staffing).where(Staffing.phase_id == phase_id)
    )
    staffings = staffing_result.scalars().all()
    staffing_ids: List[int] = []
    for s in staffings:
        s.deleted_at = None if is_deleted else now
        staffing_ids.append(s.id)
        restored["staffing"] += 1

    # 4) 캘린더 처리
    if staffing_ids:
        if is_deleted:
            cal_count = await _restore_calendar_for_staffing_ids(db, staffing_ids)
            restored["calendar"] = cal_count
        else:
            del_result = await db.execute(
                sqlalchemy.delete(Calendar_entries).where(
                    Calendar_entries.staffing_id.in_(staffing_ids)
                )
            )
            restored["calendar"] = del_result.rowcount

    # 5) 감사 로그 기록
    new_event_id = str(__import__("uuid").uuid4())
    rollback_log = AuditLog(
        event_id         = new_event_id,
        event_type       = "ROLLBACK",
        entity_type      = "phase",
        entity_id        = str(phase_id),
        project_id       = phase.project_id,
        user_id          = getattr(request.state, "user_id", None),
        user_name        = getattr(request.state, "user_name", None),
        user_role        = getattr(request.state, "user_role", None),
        timestamp        = now,
        client_ip        = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
                           or (request.client.host if request.client else ""),
        user_agent       = request.headers.get("User-Agent", ""),
        request_path     = str(request.url.path),
        request_id       = str(__import__("uuid").uuid4()),
        changed_fields   = json.dumps({"action": action, "restored": restored}, ensure_ascii=False),
        is_system_action = False,
        description      = (
            f"[단계 전체 {'복원' if is_deleted else '삭제'}] {phase.phase_name} — "
            f"투입공수 {restored['staffing']}개, 일정 {restored['calendar']}개"
        ),
    )
    db.add(rollback_log)
    await db.commit()

    logger.info(
        f"[PHASE ROLLBACK] phase_id={phase_id} action={action} restored={restored}"
    )

    return PhaseRollbackResponse(
        ok=True,
        phase_id=phase_id,
        restored=restored,
        rollback_audit_event_id=new_event_id,
    )


# ══════════════════════════════════════════════════════════════
# ── 일괄 롤백 API ─────────────────────────────────────────────
# ══════════════════════════════════════════════════════════════

class BulkRollbackRequest(BaseModel):
    event_ids: List[str]   # 선택된 감사 로그 event_id 목록


class BulkRollbackItemResult(BaseModel):
    event_id: str
    entity_type: str
    entity_id: Optional[str]
    ok: bool
    message: str


class BulkRollbackResponse(BaseModel):
    total: int
    success: int
    failed: int
    results: List[BulkRollbackItemResult]


@router.post("/audit/bulk-rollback", response_model=BulkRollbackResponse)
async def bulk_rollback_audit_logs(
    body: BulkRollbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """
    감사 로그 일괄 롤백.

    선택한 event_id 목록을 순서대로 롤백한다.
    - entity_type=project  → project_rollback (하위 전체)
    - entity_type=phase    → phase_rollback   (하위 전체)
    - 그 외                → 단건 롤백 (before_data 복원)

    중복 제거:
    - 같은 project_id의 project 이벤트는 최초 1번만 실행
    - 같은 phase_id의 phase 이벤트는 최초 1번만 실행
    """
    from models.projects import Projects
    from models.phases import Phases
    from models.staffing import Staffing
    from models.calendar_entries import Calendar_entries
    import sqlalchemy as sa

    results: List[BulkRollbackItemResult] = []
    seen_project_ids: set = set()
    seen_phase_ids: set = set()

    now = datetime.now(timezone.utc)
    user_id   = getattr(request.state, "user_id", None)
    user_name = getattr(request.state, "user_name", None)
    user_role = getattr(request.state, "user_role", None)
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )
    user_agent = request.headers.get("User-Agent", "")

    for event_id in body.event_ids:
        # 1) 감사 로그 조회
        log_result = await db.execute(select(AuditLog).where(AuditLog.event_id == event_id))
        audit_log = log_result.scalar_one_or_none()
        if not audit_log:
            results.append(BulkRollbackItemResult(
                event_id=event_id, entity_type="?", entity_id=None,
                ok=False, message="감사 로그를 찾을 수 없습니다."
            ))
            continue

        entity_type   = audit_log.entity_type
        entity_id_str = audit_log.entity_id
        event_type_val = audit_log.event_type

        # 롤백 불가 이벤트 타입 건너뜀
        if event_type_val not in ("CREATE", "UPDATE", "DELETE", "STATUS_CHANGE"):
            results.append(BulkRollbackItemResult(
                event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                ok=False, message=f"'{event_type_val}' 이벤트는 롤백할 수 없습니다."
            ))
            continue

        try:
            # ── project: 통째 롤백 ─────────────────────────────
            if entity_type == "project" and entity_id_str:
                pid = int(entity_id_str)
                if pid in seen_project_ids:
                    results.append(BulkRollbackItemResult(
                        event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                        ok=True, message=f"project #{pid} 이미 처리됨 (중복 건너뜀)"
                    ))
                    continue
                seen_project_ids.add(pid)

                proj_result = await db.execute(select(Projects).where(Projects.id == pid))
                project = proj_result.scalar_one_or_none()
                if not project:
                    results.append(BulkRollbackItemResult(
                        event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                        ok=False, message=f"project #{pid} 없음"
                    ))
                    continue

                is_deleted = project.deleted_at is not None
                action = "RESTORE" if is_deleted else "DELETE"
                project.deleted_at = None if is_deleted else now

                phases_result = await db.execute(select(Phases).where(Phases.project_id == pid))
                phases = phases_result.scalars().all()
                phase_ids_list = [p.id for p in phases]
                for p in phases:
                    p.deleted_at = None if is_deleted else now
                    seen_phase_ids.add(p.id)  # 하위 phase는 중복 처리 필요 없음

                staffing_ids: List[int] = []
                if phase_ids_list:
                    stf_result = await db.execute(
                        select(Staffing).where(Staffing.phase_id.in_(phase_ids_list))
                    )
                    for s in stf_result.scalars().all():
                        s.deleted_at = None if is_deleted else now
                        staffing_ids.append(s.id)

                cal_count = 0
                if staffing_ids:
                    if is_deleted:
                        cal_count = await _restore_calendar_for_staffing_ids(db, staffing_ids)
                    else:
                        dr = await db.execute(
                            sa.delete(Calendar_entries).where(
                                Calendar_entries.staffing_id.in_(staffing_ids)
                            )
                        )
                        cal_count = dr.rowcount

                # 감사 로그
                db.add(AuditLog(
                    event_id=str(__import__("uuid").uuid4()),
                    event_type="ROLLBACK", entity_type="project", entity_id=str(pid),
                    project_id=pid, user_id=user_id, user_name=user_name, user_role=user_role,
                    timestamp=now, client_ip=client_ip, user_agent=user_agent,
                    request_path=str(request.url.path),
                    request_id=str(__import__("uuid").uuid4()),
                    changed_fields=json.dumps({"action": action, "bulk": True,
                        "phases": len(phase_ids_list), "staffing": len(staffing_ids), "calendar": cal_count},
                        ensure_ascii=False),
                    is_system_action=False,
                    description=(
                        f"[일괄 롤백 - 사업 {'복원' if is_deleted else '삭제'}] {project.project_name} "
                        f"— 단계 {len(phase_ids_list)}개, 투입공수 {len(staffing_ids)}개, 일정 {cal_count}개"
                    ),
                ))

                results.append(BulkRollbackItemResult(
                    event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                    ok=True,
                    message=f"사업 {action}: 단계 {len(phase_ids_list)}, 투입공수 {len(staffing_ids)}, 일정 {cal_count}"
                ))

            # ── phase: 통째 롤백 ──────────────────────────────
            elif entity_type == "phase" and entity_id_str:
                phid = int(entity_id_str)
                if phid in seen_phase_ids:
                    results.append(BulkRollbackItemResult(
                        event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                        ok=True, message=f"phase #{phid} 이미 처리됨 (중복 건너뜀)"
                    ))
                    continue
                seen_phase_ids.add(phid)

                phase_result = await db.execute(select(Phases).where(Phases.id == phid))
                phase = phase_result.scalar_one_or_none()
                if not phase:
                    results.append(BulkRollbackItemResult(
                        event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                        ok=False, message=f"phase #{phid} 없음"
                    ))
                    continue

                is_deleted = phase.deleted_at is not None
                action = "RESTORE" if is_deleted else "DELETE"
                phase.deleted_at = None if is_deleted else now

                stf_result = await db.execute(
                    select(Staffing).where(Staffing.phase_id == phid)
                )
                stf_ids: List[int] = []
                for s in stf_result.scalars().all():
                    s.deleted_at = None if is_deleted else now
                    stf_ids.append(s.id)

                cal_count = 0
                if stf_ids:
                    if is_deleted:
                        cal_count = await _restore_calendar_for_staffing_ids(db, stf_ids)
                    else:
                        dr = await db.execute(
                            sa.delete(Calendar_entries).where(
                                Calendar_entries.staffing_id.in_(stf_ids)
                            )
                        )
                        cal_count = dr.rowcount

                db.add(AuditLog(
                    event_id=str(__import__("uuid").uuid4()),
                    event_type="ROLLBACK", entity_type="phase", entity_id=str(phid),
                    project_id=phase.project_id, user_id=user_id, user_name=user_name,
                    user_role=user_role, timestamp=now, client_ip=client_ip,
                    user_agent=user_agent, request_path=str(request.url.path),
                    request_id=str(__import__("uuid").uuid4()),
                    changed_fields=json.dumps({"action": action, "bulk": True,
                        "staffing": len(stf_ids), "calendar": cal_count}, ensure_ascii=False),
                    is_system_action=False,
                    description=(
                        f"[일괄 롤백 - 단계 {'복원' if is_deleted else '삭제'}] {phase.phase_name} "
                        f"— 투입공수 {len(stf_ids)}개, 일정 {cal_count}개"
                    ),
                ))

                results.append(BulkRollbackItemResult(
                    event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                    ok=True,
                    message=f"단계 {action}: 투입공수 {len(stf_ids)}, 일정 {cal_count}"
                ))

            # ── 단건 롤백 (staffing / people 등) ─────────────
            elif entity_id_str:
                ModelClass = await _get_model_class(entity_type)
                if ModelClass is None:
                    results.append(BulkRollbackItemResult(
                        event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                        ok=False, message=f"'{entity_type}'은 롤백 미지원"
                    ))
                    continue

                entity_id_int = int(entity_id_str)
                obj_result = await db.execute(select(ModelClass).where(ModelClass.id == entity_id_int))
                obj = obj_result.scalar_one_or_none()

                rolled_fields: List[str] = []

                if event_type_val == "CREATE":
                    if obj is None or not hasattr(obj, "deleted_at"):
                        results.append(BulkRollbackItemResult(
                            event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                            ok=False, message="레코드 없음 또는 soft-delete 미지원"
                        ))
                        continue
                    obj.deleted_at = now
                    rolled_fields = ["deleted_at"]
                else:
                    if not audit_log.before_data or obj is None:
                        results.append(BulkRollbackItemResult(
                            event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                            ok=False, message="before_data 없음 또는 레코드 없음"
                        ))
                        continue

                    before_dict: dict = json.loads(audit_log.before_data)
                    skip_fields = _ENTITY_SKIP.get(entity_type, _ROLLBACK_SKIP_FIELDS)

                    if event_type_val == "DELETE" and hasattr(obj, "deleted_at"):
                        obj.deleted_at = None
                        rolled_fields.append("deleted_at(복원)")

                    for field, val in before_dict.items():
                        if field in skip_fields or not hasattr(obj, field):
                            continue
                        col = ModelClass.__table__.columns.get(field)
                        if col is not None and val is not None:
                            import sqlalchemy as _sa
                            if isinstance(col.type, _sa.DateTime):
                                try:
                                    from datetime import datetime as _dt
                                    val = _dt.fromisoformat(str(val))
                                except Exception:
                                    pass
                            elif isinstance(col.type, _sa.Date):
                                try:
                                    from datetime import date as _d
                                    val = _d.fromisoformat(str(val))
                                except Exception:
                                    pass
                        setattr(obj, field, val)
                        rolled_fields.append(field)

                db.add(AuditLog(
                    event_id=str(__import__("uuid").uuid4()),
                    event_type="ROLLBACK", entity_type=entity_type,
                    entity_id=entity_id_str,
                    project_id=audit_log.project_id,
                    user_id=user_id, user_name=user_name, user_role=user_role,
                    timestamp=now, client_ip=client_ip, user_agent=user_agent,
                    request_path=str(request.url.path),
                    request_id=str(__import__("uuid").uuid4()),
                    before_data=audit_log.after_data, after_data=audit_log.before_data,
                    changed_fields=json.dumps(
                        {"rolled_back_from_event": event_id, "bulk": True}, ensure_ascii=False
                    ),
                    is_system_action=False,
                    description=f"[일괄 롤백] {entity_type}/{entity_id_str} 복원, 필드: {', '.join(rolled_fields)}",
                ))

                results.append(BulkRollbackItemResult(
                    event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                    ok=True, message=f"복원 필드: {', '.join(rolled_fields)}"
                ))

            else:
                results.append(BulkRollbackItemResult(
                    event_id=event_id, entity_type=entity_type, entity_id=entity_id_str,
                    ok=False, message="entity_id 없음 (일괄 토글 등은 수동 처리 필요)"
                ))

        except Exception as e:
            logger.error(f"[BULK ROLLBACK] event_id={event_id} error: {e}", exc_info=True)
            results.append(BulkRollbackItemResult(
                event_id=event_id, entity_type=entity_type if 'entity_type' in dir() else "?",
                entity_id=entity_id_str if 'entity_id_str' in dir() else None,
                ok=False, message=str(e)
            ))

    await db.commit()

    success = sum(1 for r in results if r.ok)
    logger.info(f"[BULK ROLLBACK] total={len(results)} success={success} failed={len(results)-success}")

    return BulkRollbackResponse(
        total=len(results),
        success=success,
        failed=len(results) - success,
        results=results,
    )


# ══════════════════════════════════════════════════════════════
# ── 권한 신청 대기 사용자 관리 API ────────────────────────────
# ══════════════════════════════════════════════════════════════

class PendingUserItem(BaseModel):
    id: int
    user_id: str
    email: str
    name: Optional[str]
    status: str
    requested_at: Optional[datetime]
    reviewed_at: Optional[datetime]
    reviewed_by: Optional[str]
    note: Optional[str]
    reject_reason: Optional[str]

    class Config:
        from_attributes = True


class PendingUserReviewRequest(BaseModel):
    action: str          # "approve" or "reject"
    role: str = "user"   # approve 시 부여할 role
    reject_reason: Optional[str] = None


@router.get("/pending-users", response_model=List[PendingUserItem])
async def list_pending_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
    status: Optional[str] = Query(None, description="pending / approved / rejected"),
):
    """권한 신청 대기 사용자 목록"""
    stmt = select(PendingUser).order_by(desc(PendingUser.requested_at))
    if status:
        stmt = stmt.where(PendingUser.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/pending-users/count")
async def count_pending_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    """대기 중인 권한 신청 건수"""
    result = await db.execute(
        select(func.count(PendingUser.id)).where(PendingUser.status == "pending")
    )
    count = result.scalar() or 0
    return {"pending_count": count}


@router.post("/pending-users/{user_id}/review")
async def review_pending_user(
    user_id: str,
    body: PendingUserReviewRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """권한 신청 승인 또는 거부"""
    if body.action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail="action은 'approve' 또는 'reject'만 허용됩니다.")
    if body.action == "approve" and body.role not in ("user", "leader", "admin", "viewer"):
        raise HTTPException(status_code=400, detail="role은 user, leader, admin, viewer 만 허용됩니다.")

    # pending_users 조회
    result = await db.execute(select(PendingUser).where(PendingUser.user_id == user_id))
    pending = result.scalar_one_or_none()
    if not pending:
        raise HTTPException(status_code=404, detail="신청 사용자를 찾을 수 없습니다.")

    admin_id = getattr(request.state, "user_id", "system")
    now = datetime.now(timezone.utc)

    if body.action == "approve":
        # users 테이블에 추가 (없으면 INSERT, 있으면 role 업데이트)
        # auth.py 콜백은 users 테이블 존재 여부로 접근 허용을 판단하므로 반드시 추가해야 함
        existing_user_result = await db.execute(
            select(User).where(User.id == user_id)
        )
        existing_user = existing_user_result.scalar_one_or_none()
        if existing_user is None:
            new_user = User(
                id=user_id,
                email=pending.email,
                name=pending.name,
                role=body.role,
            )
            db.add(new_user)
            logger.info(f"Approved pending user: added to users table {user_id} role={body.role} by {admin_id}")
        else:
            existing_user.role = body.role
            logger.info(f"Approved pending user: updated role in users table {user_id} role={body.role} by {admin_id}")

        # pending 상태 업데이트
        pending.status = "approved"
        pending.reviewed_at = now
        pending.reviewed_by = admin_id
        await db.commit()

        return {"ok": True, "action": "approve", "user_id": user_id, "role": body.role}

    else:  # reject
        pending.status = "rejected"
        pending.reviewed_at = now
        pending.reviewed_by = admin_id
        pending.reject_reason = body.reject_reason or "관리자에 의해 거부되었습니다."
        await db.commit()

        logger.info(f"Rejected pending user: {user_id} by {admin_id}, reason: {pending.reject_reason}")
        return {"ok": True, "action": "reject", "user_id": user_id}


@router.delete("/pending-users/{user_id}")
async def delete_pending_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    """권한 신청 기록 삭제"""
    result = await db.execute(select(PendingUser).where(PendingUser.user_id == user_id))
    pending = result.scalar_one_or_none()
    if not pending:
        raise HTTPException(status_code=404, detail="신청 사용자를 찾을 수 없습니다.")
    await db.delete(pending)
    await db.commit()
    return {"ok": True, "deleted": user_id}
