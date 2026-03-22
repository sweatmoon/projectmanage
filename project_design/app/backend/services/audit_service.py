"""
감사 로그 서비스 (Audit Service)
- 모든 CRUD 이벤트를 audit_logs 테이블에 기록
- diff 추출: 변경 전후 JSON 비교 → changed_fields
- soft-delete 유틸: deleted_at 필드 처리
- 아카이빙: 12개월 이상 로그 → audit_logs_archive 이관 (매일 새벽 자동 실행)
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


# ── 컨텍스트 이름 조회 헬퍼 ──────────────────────────────────
async def get_audit_context(
    db: AsyncSession,
    *,
    project_id: Optional[int] = None,
    phase_id: Optional[int] = None,
    staffing_id: Optional[int] = None,
    person_id: Optional[int] = None,
) -> Dict[str, Optional[str]]:
    """
    감사 로그에 사용할 사업명/단계명/인원명을 DB에서 조회.
    없으면 None 반환 (오류 무시).
    """
    result: Dict[str, Optional[str]] = {
        "project_name": None,
        "phase_name": None,
        "person_name": None,
        "field_name": None,
    }
    try:
        from models.projects import Projects
        from models.phases import Phases
        from models.staffing import Staffing
        from models.people import People
        from sqlalchemy import select

        if project_id:
            r = await db.execute(select(Projects.project_name).where(Projects.id == project_id))
            row = r.scalar_one_or_none()
            if row:
                result["project_name"] = row

        if phase_id:
            r = await db.execute(select(Phases.phase_name).where(Phases.id == phase_id))
            row = r.scalar_one_or_none()
            if row:
                result["phase_name"] = row

        if staffing_id:
            r = await db.execute(
                select(Staffing.person_name_text, Staffing.field, Staffing.person_id)
                .where(Staffing.id == staffing_id)
            )
            row = r.one_or_none()
            if row:
                result["person_name"] = row[0]
                result["field_name"] = row[1]
                if not result["person_name"] and row[2]:
                    person_id = row[2]

        if person_id and not result["person_name"]:
            r = await db.execute(select(People.person_name).where(People.id == person_id))
            row = r.scalar_one_or_none()
            if row:
                result["person_name"] = row

    except Exception as e:
        logger.debug(f"[AUDIT] 컨텍스트 조회 실패 (무시): {e}")

    return result

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
    # 사람이 읽기 좋은 컨텍스트 이름 (선택)
    project_name: Optional[str] = None,   # 사업명
    phase_name: Optional[str] = None,     # 단계명
    person_name: Optional[str] = None,    # 인원명
    field_name: Optional[str] = None,     # 분야명
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
                event_type, entity_type, entity_id, changed_fields,
                project_name=project_name,
                phase_name=phase_name,
                person_name=person_name,
                field_name=field_name,
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
    *,
    project_name: Optional[str] = None,
    phase_name: Optional[str] = None,
    person_name: Optional[str] = None,
    field_name: Optional[str] = None,
) -> str:
    """사람이 읽기 좋은 요약문 자동 생성 (사업명/단계명/인원명 포함)"""

    action_kr = {
        EventType.CREATE:           "생성",
        EventType.UPDATE:           "수정",
        EventType.DELETE:           "삭제",
        EventType.RESTORE:          "복원",
        EventType.STATUS_CHANGE:    "상태 변경",
        EventType.BULK_IMPORT:      "일괄 가져오기",
        EventType.BULK_OVERWRITE:   "일괄 덮어쓰기",
        EventType.SYNC:             "자동 동기화",
        EventType.LOGIN:            "로그인",
        EventType.LOGOUT:           "로그아웃",
        EventType.USER_ROLE_CHANGE: "권한 변경",
    }.get(event_type, event_type)

    # ── 컨텍스트 경로 구성 ──────────────────────────────────
    # 예: [한국도로공사] > 2단계 > 이현우(사업관리)
    context_parts = []
    if project_name:
        context_parts.append(f"[{project_name}]")
    if phase_name:
        context_parts.append(phase_name)
    if person_name:
        if field_name:
            context_parts.append(f"{person_name}({field_name})")
        else:
            context_parts.append(person_name)
    context = " > ".join(context_parts) if context_parts else None

    # ── 엔티티별 변경 내용 요약 ────────────────────────────
    detail_parts = []

    if entity_type == "project":
        if "project_name" in changed_fields:
            d = changed_fields["project_name"]
            detail_parts.append(f"사업명 {d['before']}→{d['after']}")
        if "status" in changed_fields:
            d = changed_fields["status"]
            detail_parts.append(f"유형 {d['before']}→{d['after']}")
        if "organization" in changed_fields:
            d = changed_fields["organization"]
            detail_parts.append(f"기관 {d['before']}→{d['after']}")
        if "deadline" in changed_fields:
            d = changed_fields["deadline"]
            detail_parts.append(f"마감일 {d['before']}→{d['after']}")

    elif entity_type == "phase":
        if "phase_name" in changed_fields:
            d = changed_fields["phase_name"]
            detail_parts.append(f"단계명 {d['before']}→{d['after']}")
        if "start_date" in changed_fields:
            d = changed_fields["start_date"]
            detail_parts.append(f"시작일 {d['before']}→{d['after']}")
        if "end_date" in changed_fields:
            d = changed_fields["end_date"]
            detail_parts.append(f"종료일 {d['before']}→{d['after']}")

    elif entity_type == "staffing":
        if "md" in changed_fields:
            d = changed_fields["md"]
            detail_parts.append(f"MD {d['before']}→{d['after']}")
        if "person_id" in changed_fields or "person_name_text" in changed_fields:
            key = "person_name_text" if "person_name_text" in changed_fields else "person_id"
            d = changed_fields[key]
            detail_parts.append(f"배정인력 {d['before']}→{d['after']}")
        if "field" in changed_fields:
            d = changed_fields["field"]
            detail_parts.append(f"분야 {d['before']}→{d['after']}")

    elif entity_type == "calendar_entry":
        if "status" in changed_fields:
            d = changed_fields["status"]
            status_map = {"A": "실제", "P": "계획", None: "미입력"}
            b = status_map.get(d["before"], d["before"])
            a = status_map.get(d["after"], d["after"])
            detail_parts.append(f"일정 {b}→{a}")
        if "entry_date" in changed_fields:
            d = changed_fields["entry_date"]
            detail_parts.append(f"날짜 {d.get('after') or d.get('before')}")

    elif entity_type == "people":
        if "person_name" in changed_fields:
            d = changed_fields["person_name"]
            detail_parts.append(f"이름 {d['before']}→{d['after']}")
        if "grade" in changed_fields:
            d = changed_fields["grade"]
            detail_parts.append(f"등급 {d['before']}→{d['after']}")
        if "employment_status" in changed_fields:
            d = changed_fields["employment_status"]
            detail_parts.append(f"상태 {d['before']}→{d['after']}")

    elif entity_type == "user":
        if "role" in changed_fields:
            d = changed_fields["role"]
            detail_parts.append(f"권한 {d['before']}→{d['after']}")

    detail = ", ".join(detail_parts) if detail_parts else None

    # ── 최종 조합 ──────────────────────────────────────────
    # 예: [한국도로공사] > 2단계 > 이현우(사업관리) — MD 3→5 수정
    if context and detail:
        return f"{context} — {detail} {action_kr}"
    elif context:
        return f"{context} — {action_kr}"
    elif detail:
        return f"{detail} {action_kr}"
    else:
        etype_kr = {
            "project": "사업", "phase": "단계", "staffing": "인력배정",
            "calendar_entry": "일정셀", "people": "인력", "user": "사용자",
        }.get(entity_type, entity_type)
        return f"{etype_kr}({entity_id}) {action_kr}"


# ── soft-delete 헬퍼 ─────────────────────────────────────────
def soft_delete(obj: Any) -> None:
    """모델 객체에 deleted_at을 현재 시각으로 설정 (soft delete)"""
    if hasattr(obj, "deleted_at"):
        obj.deleted_at = datetime.now(timezone.utc)


def is_deleted(obj: Any) -> bool:
    """소프트 삭제 여부 확인"""
    return hasattr(obj, "deleted_at") and obj.deleted_at is not None


# ── 아카이빙 ─────────────────────────────────────────────────
async def archive_old_logs(db: AsyncSession, months: int = 12) -> int:
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
