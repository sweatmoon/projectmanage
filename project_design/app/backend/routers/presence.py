import logging
from datetime import datetime, timezone, timedelta
from typing import List

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.page_presence import PagePresence

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/presence", tags=["presence"])

PRESENCE_TIMEOUT_SECONDS = 60  # 60초 무응답 시 만료


# ── Request / Response Models ──────────────────────────────

class HeartbeatRequest(BaseModel):
    page_type: str   # 'project' | 'schedule'
    page_id: int
    mode: str = 'viewing'   # 'viewing' | 'editing'


class PresenceUser(BaseModel):
    user_id: str
    user_name: str
    mode: str
    last_seen: str


class PresenceResponse(BaseModel):
    users: List[PresenceUser]


# ── Helpers ────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_expired(last_seen: datetime) -> bool:
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return (_now_utc() - last_seen).total_seconds() > PRESENCE_TIMEOUT_SECONDS


# ── Endpoints ──────────────────────────────────────────────

@router.post("/heartbeat", response_model=PresenceResponse)
async def heartbeat(
    request_body: HeartbeatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    페이지 진입/유지 heartbeat.
    - 호출 시 자신의 presence를 upsert하고
    - 같은 page의 현재 접속자 목록(자신 포함)을 반환한다.
    """
    # 현재 사용자 정보를 Request state에서 가져옴 (AuthMiddleware가 주입)
    # auth_middleware는 request.state.user_id / user_name / user_email 로 저장함
    user_id = str(getattr(http_request.state, "user_id", None) or "unknown")
    if user_id == "unknown":
        return PresenceResponse(users=[])
    user_name = str(
        getattr(http_request.state, "user_name", None)
        or getattr(http_request.state, "user_email", None)
        or user_id
    )

    now = _now_utc()

    # 1) 기존 레코드 조회 (same user + page)
    stmt = select(PagePresence).where(
        and_(
            PagePresence.user_id  == user_id,
            PagePresence.page_type == request_body.page_type,
            PagePresence.page_id  == request_body.page_id,
        )
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        existing.mode      = request_body.mode
        existing.last_seen = now
        existing.user_name = user_name
    else:
        db.add(PagePresence(
            user_id   = user_id,
            user_name = user_name,
            page_type = request_body.page_type,
            page_id   = request_body.page_id,
            mode      = request_body.mode,
            last_seen = now,
        ))

    # 2) 만료된 레코드 정리 (전체 테이블)
    cutoff = now - timedelta(seconds=PRESENCE_TIMEOUT_SECONDS)
    await db.execute(
        delete(PagePresence).where(PagePresence.last_seen < cutoff)
    )

    await db.commit()

    # 3) 현재 페이지의 활성 접속자 반환
    active_stmt = select(PagePresence).where(
        and_(
            PagePresence.page_type == request_body.page_type,
            PagePresence.page_id   == request_body.page_id,
            PagePresence.last_seen >= cutoff,
        )
    )
    active_result = await db.execute(active_stmt)
    active_users = active_result.scalars().all()

    return PresenceResponse(
        users=[
            PresenceUser(
                user_id   = u.user_id,
                user_name = u.user_name,
                mode      = u.mode,
                last_seen = u.last_seen.isoformat(),
            )
            for u in active_users
        ]
    )


@router.delete("/leave")
async def leave(
    request_body: HeartbeatRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """페이지 이탈 시 즉시 presence 제거."""
    user_id = str(getattr(http_request.state, "user_id", None) or "unknown")
    if user_id == "unknown":
        return {"ok": True}

    await db.execute(
        delete(PagePresence).where(
            and_(
                PagePresence.user_id   == user_id,
                PagePresence.page_type == request_body.page_type,
                PagePresence.page_id   == request_body.page_id,
            )
        )
    )
    await db.commit()
    return {"ok": True}


@router.get("/{page_type}/{page_id}", response_model=PresenceResponse)
async def get_presence(
    page_type: str,
    page_id: int,
    db: AsyncSession = Depends(get_db),
):
    """특정 페이지의 현재 접속자 목록 조회 (heartbeat 없이 읽기 전용)."""
    cutoff = _now_utc() - timedelta(seconds=PRESENCE_TIMEOUT_SECONDS)
    stmt = select(PagePresence).where(
        and_(
            PagePresence.page_type == page_type,
            PagePresence.page_id   == page_id,
            PagePresence.last_seen >= cutoff,
        )
    )
    result = await db.execute(stmt)
    users = result.scalars().all()
    return PresenceResponse(
        users=[
            PresenceUser(
                user_id   = u.user_id,
                user_name = u.user_name,
                mode      = u.mode,
                last_seen = u.last_seen.isoformat(),
            )
            for u in users
        ]
    )
