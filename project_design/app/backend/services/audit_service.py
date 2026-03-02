"""
감사 로그 서비스 (Audit Service)
- 모든 CRUD 이벤트를 audit_logs 테이블에 기록
- diff 추출: 변경 전후 JSON 비교 → changed_fields
- soft-delete 유틸: deleted_at 필드 처리
- 아카이빙: 6개월 이상 로그 → audit_logs_archive 이관
"""
import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import Request
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.audit import AuditLog, AuditLogArchive

logger = logging.getLogger(__name__)

# ── 이벤트 타입 상수 ──────────────────────────────────────────
class EventType:
    CREATE         = "CREATE"
    UPDATE         = "UPDATE"
    DELETE         = "DELETE"         # soft-delete
    RESTORE        = "RESTORE"        # 삭제 복원
    STATUS_CHANGE  = "STATUS_CHANGE"
    BULK_IMPORT    = "BULK_IMPORT"    # TSV 붙여넣기
    BULK_OVERWRITE = "BULK_OVERWRITE" # 덮어쓰기 모드
    SYNC           = "SYNC"           # 자동 동기화
    LOGIN          = "LOGIN"
    LOGOUT         = "LOGOUT"
    USER_ROLE_CHANGE = "USER_ROLE_CHANGE"

# ── 엔티티 타입 상수 ─────────────────────────────────────────
class EntityType:
    PROJECT        = "project"
    PHASE          = "phase"
    STAFFING       = "staffing"
    CALENDAR_ENTRY = "calendar_entry"
    PEOPLE         = "people"
    USER           = "user"


def _model_to_dict(obj: Any) -> Dict:
    """SQLAlchemy 모델 인스턴스 → JSON 직렬화 가능 dict"""
    if obj is None:
        return {}
    result = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        elif hasattr(val, 'isoformat'):  # date
            val = val.isoformat()
        result[col.name] = val
    return result


def _extract_diff(before: Dict, after: Dict) -> Dict:
    """
    변경 전/후 dict 비교 → 변경된 필드만 추출
    반환 형식: { "field": {"before": old_val, "after": new_val} }
    """
    diff = {}
    all_keys = set(list(before.keys()) + list(after.keys()))
    skip_keys = {"updated_at", "last_login"}  # 자동 갱신 필드 제외

    for key in all_keys:
        if key in skip_keys:
            continue
        b_val = before.get(key)
        a_val = after.get(key)
        if b_val != a_val:
            diff[key] = {"before": b_val, "after": a_val}
    return diff


def _get_request_context(request: Optional[Request]) -> Dict:
    """Request 객체에서 사용자/IP/경로 추출"""
    if request is None:
        return {"user_id": None, "user_name": None, "user_role": None,
                "client_ip": None, "user_agent": None, "request_path": None}

    def _get_ip():
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    return {
        "user_id":      getattr(request.state, "user_id", None),
        "user_name":    getattr(request.state, "user_name", None),
        "user_role":    getattr(request.state, "user_role", None),
        "client_ip":    _get_ip(),
        "user_agent":   request.headers.get("User-Agent", ""),
        "request_path": str(request.url.path),
    }


async def write_audit_log(
    db: AsyncSession,
    *,
    event_type: str,
    entity_type: str,
    entity_id: Optional[Any] = None,
    project_id: Optional[int] = None,
    before_obj: Optional[Any] = None,   # SQLAlchemy 모델 or dict
    after_obj: Optional[Any] = None,
    request: Optional[Request] = None,
    is_system_action: bool = False,
    description: Optional[str] = None,
    request_id: Optional[str] = None,
    # 직접 지정 (request 없는 경우)
    user_id: Optional[str] = None,
    user_name: Optional[str] = None,
    user_role: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    request_path: Optional[str] = None,
) -> None:
    """
    감사 로그 1건 기록.
    모든 라우터/서비스에서 이 함수 하나로 기록.
    실패해도 원본 트랜잭션에 영향 없도록 try/except 처리.
    """
    try:
        # before/after를 dict로 변환
        before_dict = {}
        after_dict  = {}

        if before_obj is not None:
            before_dict = before_obj if isinstance(before_obj, dict) else _model_to_dict(before_obj)
        if after_obj is not None:
            after_dict = after_obj if isinstance(after_obj, dict) else _model_to_dict(after_obj)

        # diff 추출
        changed_fields = {}
        if before_dict and after_dict:
            changed_fields = _extract_diff(before_dict, after_dict)
        elif not before_dict and after_dict:
            # CREATE: after 전체를 changed_fields로
            changed_fields = {k: {"before": None, "after": v} for k, v in after_dict.items()}
        elif before_dict and not after_dict:
            # DELETE: before 전체를 changed_fields로
            changed_fields = {k: {"before": v, "after": None} for k, v in before_dict.items()}

        # 컨텍스트 결합 (request 우선, 직접 지정 fallback)
        ctx = _get_request_context(request)
        final_user_id   = ctx["user_id"]   or user_id
        final_user_name = ctx["user_name"] or user_name
        final_user_role = ctx["user_role"] or user_role
        final_ip        = ctx["client_ip"] or client_ip
        final_ua        = ctx["user_agent"] or user_agent
        final_path      = ctx["request_path"] or request_path

        # 자동 요약문 생성
        if description is None:
            description = _build_description(
                event_type, entity_type, entity_id, changed_fields
            )

        log = AuditLog(
            event_id         = str(uuid.uuid4()),
            event_type       = event_type,
            entity_type      = entity_type,
            entity_id        = str(entity_id) if entity_id is not None else None,
            project_id       = project_id,
            user_id          = final_user_id,
            user_name        = final_user_name,
            user_role        = final_user_role,
            timestamp        = datetime.now(timezone.utc),
            client_ip        = final_ip,
            user_agent       = final_ua,
            request_path     = final_path,
            request_id       = request_id or str(uuid.uuid4()),
            before_data      = json.dumps(before_dict, ensure_ascii=False, default=str) if before_dict else None,
            after_data       = json.dumps(after_dict,  ensure_ascii=False, default=str) if after_dict else None,
            changed_fields   = json.dumps(changed_fields, ensure_ascii=False, default=str) if changed_fields else None,
            is_system_action = is_system_action,
            description      = description,
        )

        db.add(log)
        # flush만 (커밋은 호출자가 담당)
        await db.flush()

    except Exception as e:
        logger.warning(f"[AUDIT] 로그 기록 실패 (원본 트랜잭션에 영향 없음): {e}")


def _build_description(
    event_type: str,
    entity_type: str,
    entity_id: Any,
    changed_fields: Dict,
) -> str:
    """사람이 읽기 좋은 요약문 자동 생성"""
    etype_kr = {
        "project": "프로젝트", "phase": "단계", "staffing": "투입공수",
        "calendar_entry": "일정셀", "people": "인력", "user": "사용자",
    }.get(entity_type, entity_type)

    action_kr = {
        EventType.CREATE:          "생성",
        EventType.UPDATE:          "수정",
        EventType.DELETE:          "삭제",
        EventType.RESTORE:         "복원",
        EventType.STATUS_CHANGE:   "상태 변경",
        EventType.BULK_IMPORT:     "일괄 가져오기",
        EventType.BULK_OVERWRITE:  "일괄 덮어쓰기",
        EventType.SYNC:            "자동 동기화",
        EventType.LOGIN:           "로그인",
        EventType.LOGOUT:          "로그아웃",
        EventType.USER_ROLE_CHANGE:"권한 변경",
    }.get(event_type, event_type)

    base = f"{etype_kr}({entity_id}) {action_kr}"

    # 특별 케이스: MD 변경
    if "md" in changed_fields:
        md_diff = changed_fields["md"]
        base += f" — MD {md_diff['before']}→{md_diff['after']}"

    # 특별 케이스: 상태 변경
    if "status" in changed_fields:
        st_diff = changed_fields["status"]
        base += f" — {st_diff['before']}→{st_diff['after']}"

    # 특별 케이스: 날짜 변경
    if "start_date" in changed_fields or "end_date" in changed_fields:
        parts = []
        if "start_date" in changed_fields:
            d = changed_fields["start_date"]
            parts.append(f"시작일 {d['before']}→{d['after']}")
        if "end_date" in changed_fields:
            d = changed_fields["end_date"]
            parts.append(f"종료일 {d['before']}→{d['after']}")
        base += " — " + ", ".join(parts)

    return base


# ── soft-delete 헬퍼 ─────────────────────────────────────────
def soft_delete(obj: Any) -> None:
    """모델 객체에 deleted_at을 현재 시각으로 설정 (soft delete)"""
    if hasattr(obj, "deleted_at"):
        obj.deleted_at = datetime.now(timezone.utc)


def is_deleted(obj: Any) -> bool:
    """소프트 삭제 여부 확인"""
    return hasattr(obj, "deleted_at") and obj.deleted_at is not None


# ── 아카이빙 ─────────────────────────────────────────────────
async def archive_old_logs(db: AsyncSession, months: int = 6) -> int:
    """
    months 개월 이상 된 로그를 audit_logs_archive로 이관.
    반환값: 이관된 건수
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=30 * months)
    try:
        result = await db.execute(
            select(AuditLog).where(AuditLog.timestamp < cutoff)
        )
        old_logs = result.scalars().all()
        count = 0
        for log in old_logs:
            archive = AuditLogArchive(
                event_id         = log.event_id,
                event_type       = log.event_type,
                entity_type      = log.entity_type,
                entity_id        = log.entity_id,
                project_id       = log.project_id,
                user_id          = log.user_id,
                user_name        = log.user_name,
                user_role        = log.user_role,
                timestamp        = log.timestamp,
                client_ip        = log.client_ip,
                user_agent       = log.user_agent,
                request_path     = log.request_path,
                request_id       = log.request_id,
                before_data      = log.before_data,
                after_data       = log.after_data,
                changed_fields   = log.changed_fields,
                is_system_action = log.is_system_action,
                description      = log.description,
            )
            db.add(archive)
            await db.delete(log)
            count += 1
        await db.commit()
        logger.info(f"[AUDIT] 아카이빙 완료: {count}건")
        return count
    except Exception as e:
        await db.rollback()
        logger.error(f"[AUDIT] 아카이빙 실패: {e}")
        return 0
