"""
관리자 전용 API 라우터
접근 권한: role == 'admin' 만 허용
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.auth import AccessLog, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ── 관리자 권한 확인 의존성 ────────────────────────────────
def require_admin(request: Request):
    # OIDC 미설정(개발 환경)이면 admin 스킵
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

    # 전체 사용자 수
    total_users_result = await db.execute(select(func.count(User.id)))
    total_users = total_users_result.scalar() or 0

    # 오늘 로그인 수
    today_logins_result = await db.execute(
        select(func.count(AccessLog.id)).where(
            AccessLog.action == "login",
            AccessLog.timestamp >= today_start,
        )
    )
    total_logins_today = today_logins_result.scalar() or 0

    # 오늘 API 호출 수
    today_api_result = await db.execute(
        select(func.count(AccessLog.id)).where(
            AccessLog.action == "api",
            AccessLog.timestamp >= today_start,
        )
    )
    total_api_calls_today = today_api_result.scalar() or 0

    # 최근 7일 활성 사용자
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


# ── 2. 접속 로그 목록 ──────────────────────────────────────
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


# ── 4. 사용자 역할 변경 ────────────────────────────────────
class RoleUpdateRequest(BaseModel):
    role: str  # "admin" or "user"


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    body: RoleUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: Request = Depends(require_admin),
):
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role은 'admin' 또는 'user'만 가능합니다.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    # 환경변수 admin은 강제 변경 불가
    admin_users = [u.strip() for u in os.environ.get("ADMIN_USERS", "").split(",") if u.strip()]
    if user_id in admin_users or user.email in admin_users:
        raise HTTPException(status_code=403, detail="환경변수로 지정된 admin은 변경할 수 없습니다.")

    user.role = body.role
    await db.commit()
    return {"message": f"사용자 {user_id} 역할이 {body.role}로 변경되었습니다."}
