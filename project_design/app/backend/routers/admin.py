"""
관리자 전용 API 라우터
접근 권한: role == 'admin' 만 허용
- /admin/stats          : 시스템 통계
- /admin/logs           : 접속 로그 (legacy)
- /admin/users          : 사용자 목록
- /admin/users/{id}/role: 역할 변경 (audit log 기록)
- /admin/audit          : 감사 로그 조회 (필터, 페이징)
- /admin/audit/export   : CSV/Excel 내보내기
- /admin/audit/archive  : 오래된 로그 아카이빙
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
from models.auth import AccessLog, User
from models.audit import AuditLog, AuditLogArchive
from services.audit_service import write_audit_log, archive_old_logs, EventType, EntityType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 관리자 권한 확인 의존성 ────────────────────────────────
def require_admin(request: Request):
    # OIDC 미설정(개발 환경)이면 admin 스킵
    if not os.environ.get("OIDC_ISSUER_URL", ""):
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
    if not os.environ.get("OIDC_ISSUER_URL", ""):
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
    role: str  # "admin" or "user" or "audit_viewer"


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin_only),
):
    if body.role not in ("admin", "user", "audit_viewer"):
        raise HTTPException(status_code=400, detail="role은 'admin', 'user', 'audit_viewer'만 가능합니다.")

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
    months: int = Query(6, ge=1, le=24, description="몇 개월 이상 된 로그를 아카이브할지"),
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
