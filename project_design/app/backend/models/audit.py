"""
감사 로그(Audit Log) 모델
- audit_logs: 메인 감사 로그 테이블 (6개월 미만)
- audit_logs_archive: 아카이브 테이블 (6개월 이상)
- 삭제 불가, 수정 불가 (보안 강화)
"""
import uuid
from sqlalchemy import (
    Column, DateTime, Integer, String, Text,
    Boolean, Index
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.dialects.sqlite import TEXT as SQLITE_TEXT
from sqlalchemy.sql import func
from core.database import Base


def _uuid_default():
    return str(uuid.uuid4())


class AuditLog(Base):
    """
    감사 로그 메인 테이블.
    모든 데이터 변경 이벤트를 기록한다.
    INSERT/UPDATE/DELETE 금지 (서비스 레이어에서만 insert 허용, 수정·삭제 API 없음).
    """
    __tablename__ = "audit_logs"

    # ── 기본 식별자 ────────────────────────────────────────
    id          = Column(Integer, primary_key=True, autoincrement=True)
    event_id    = Column(String(36), nullable=False, default=_uuid_default, unique=True, index=True)

    # ── 이벤트 분류 ────────────────────────────────────────
    event_type  = Column(String(50),  nullable=False, index=True)
    # CREATE / UPDATE / DELETE / STATUS_CHANGE / LOGIN / LOGOUT
    # BULK_IMPORT / BULK_OVERWRITE / SYNC / USER_ROLE_CHANGE / RESTORE

    entity_type = Column(String(50),  nullable=False, index=True)
    # project / phase / staffing / calendar_entry / people / user

    entity_id   = Column(String(50),  nullable=True,  index=True)
    # 대상 레코드 ID (삭제된 경우에도 보존)

    project_id  = Column(Integer,     nullable=True,  index=True)
    # 관련 프로젝트 ID (있으면 포함)

    # ── 행위자 정보 ────────────────────────────────────────
    user_id     = Column(String(255), nullable=True,  index=True)
    user_name   = Column(String(255), nullable=True)
    user_role   = Column(String(50),  nullable=True)

    # ── 요청 컨텍스트 ──────────────────────────────────────
    timestamp       = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    client_ip       = Column(String(100), nullable=True)
    user_agent      = Column(Text,        nullable=True)
    request_path    = Column(String(500), nullable=True)
    request_id      = Column(String(36),  nullable=True, index=True)
    # API 단위 추적 (하나의 요청에서 여러 레코드 변경 시 동일 request_id)

    # ── 데이터 스냅샷 ──────────────────────────────────────
    before_data     = Column(Text, nullable=True)   # JSON: 변경 전 전체 레코드
    after_data      = Column(Text, nullable=True)   # JSON: 변경 후 전체 레코드
    changed_fields  = Column(Text, nullable=True)   # JSON: 변경된 필드 목록만 (diff)

    # ── 자동 실행 여부 ─────────────────────────────────────
    is_system_action = Column(Boolean, default=False, nullable=False)
    # True: Watchtower·sync 등 시스템 자동 실행, False: 사용자 직접 실행

    # ── 추가 메타 ──────────────────────────────────────────
    description = Column(Text, nullable=True)
    # 사람이 읽기 좋은 요약 (예: "MD 3→5 변경", "상태 작성중→확정")

    # ── 복합 인덱스 ────────────────────────────────────────
    __table_args__ = (
        Index("ix_audit_project_time",   "project_id",  "timestamp"),
        Index("ix_audit_entity_time",    "entity_type", "timestamp"),
        Index("ix_audit_user_time",      "user_id",     "timestamp"),
        Index("ix_audit_type_time",      "event_type",  "timestamp"),
    )


class AuditLogArchive(Base):
    """
    감사 로그 아카이브 테이블 (6개월 이상 된 로그 이관).
    동일 스키마 사용 - 단순 파티셔닝 대안.
    """
    __tablename__ = "audit_logs_archive"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    event_id         = Column(String(36),  nullable=False, unique=True, index=True)
    event_type       = Column(String(50),  nullable=False)
    entity_type      = Column(String(50),  nullable=False)
    entity_id        = Column(String(50),  nullable=True)
    project_id       = Column(Integer,     nullable=True)
    user_id          = Column(String(255), nullable=True)
    user_name        = Column(String(255), nullable=True)
    user_role        = Column(String(50),  nullable=True)
    timestamp        = Column(DateTime(timezone=True), nullable=False, index=True)
    client_ip        = Column(String(100), nullable=True)
    user_agent       = Column(Text,        nullable=True)
    request_path     = Column(String(500), nullable=True)
    request_id       = Column(String(36),  nullable=True)
    before_data      = Column(Text,        nullable=True)
    after_data       = Column(Text,        nullable=True)
    changed_fields   = Column(Text,        nullable=True)
    is_system_action = Column(Boolean,     default=False)
    description      = Column(Text,        nullable=True)
    archived_at      = Column(DateTime(timezone=True), server_default=func.now())
