"""
입력 데이터 sanitize 유틸리티
- HTML 태그 제거 (XSS 방어 1차 레이어)
- React JSX {} 출력이 자동 이스케이프하므로 2차 보호
- notes, description 등 자유 텍스트 필드에 적용

사용 예:
    from utils.sanitize import strip_tags, sanitize_text
    clean = strip_tags(user_input)
"""
import re
import html
import logging

logger = logging.getLogger(__name__)

# 허용 태그 없음 — 모든 HTML 태그 제거
_TAG_RE = re.compile(r"<[^>]+>")

# 위험한 프로토콜 패턴 (javascript:, data: 등)
_DANGEROUS_PROTO_RE = re.compile(
    r"(?i)(javascript|vbscript|data|blob)\s*:",
)

# 이벤트 핸들러 패턴 (onclick=, onerror= 등)
_EVENT_HANDLER_RE = re.compile(
    r"(?i)\bon\w+\s*=",
)


def strip_tags(value: str | None) -> str | None:
    """HTML 태그를 모두 제거합니다."""
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    # 태그 제거 → HTML 엔티티 디코딩(정규화) → 다시 태그 제거(더블 인코딩 방어)
    cleaned = _TAG_RE.sub("", value)
    cleaned = html.unescape(cleaned)
    cleaned = _TAG_RE.sub("", cleaned)
    return cleaned


def sanitize_text(value: str | None, *, max_length: int | None = None) -> str | None:
    """
    텍스트 필드 일반 sanitize:
    1. HTML 태그 제거
    2. 위험 프로토콜 제거
    3. 이벤트 핸들러 패턴 제거
    4. 최대 길이 절삭 (옵션)
    """
    if value is None:
        return None
    if not isinstance(value, str):
        return value

    cleaned = strip_tags(value)
    cleaned = _DANGEROUS_PROTO_RE.sub("", cleaned)
    cleaned = _EVENT_HANDLER_RE.sub("", cleaned)
    cleaned = cleaned.strip()

    if max_length and len(cleaned) > max_length:
        logger.debug(f"[SANITIZE] 입력 길이 절삭: {len(value)} → {max_length}")
        cleaned = cleaned[:max_length]

    return cleaned


def sanitize_project_data(data: dict) -> dict:
    """프로젝트 생성/수정 데이터 sanitize"""
    TEXT_FIELDS = ("project_name", "organization", "notes")
    MAX_LENGTHS = {
        "project_name": 200,
        "organization": 200,
        "notes": 2000,
    }
    result = dict(data)
    for field in TEXT_FIELDS:
        if field in result and result[field] is not None:
            result[field] = sanitize_text(
                result[field],
                max_length=MAX_LENGTHS.get(field),
            )
    return result


def sanitize_person_data(data: dict) -> dict:
    """인력 생성/수정 데이터 sanitize"""
    TEXT_FIELDS = ("person_name", "position", "team", "grade")
    result = dict(data)
    for field in TEXT_FIELDS:
        if field in result and result[field] is not None:
            result[field] = sanitize_text(result[field], max_length=100)
    return result
