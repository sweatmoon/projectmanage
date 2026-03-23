from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text

class StaffingChange(Base):
    """
    공식 인력 변경 이력 테이블
    - staffing_id     : 대상 staffing row
    - project_id      : 프로젝트 ID (빠른 조회용 비정규화)
    - phase_id        : 단계 ID
    - original_person_id   : 기존 인력 people.id (nullable: 외부인력)
    - original_person_name : 기존 인력 이름
    - new_person_id        : 신규 인력 people.id (nullable: 외부인력)
    - new_person_name      : 신규 인력 이름
    - reason          : 변경 사유 (선택)
    - changed_by      : 변경자 (이름)
    - changed_at      : 변경 일시
    """
    __tablename__ = "staffing_change"
    __table_args__ = {"extend_existing": True}

    id                   = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    staffing_id          = Column(Integer, nullable=False, index=True)
    project_id           = Column(Integer, nullable=False, index=True)
    phase_id             = Column(Integer, nullable=False, index=True)
    original_person_id   = Column(Integer, nullable=True)
    original_person_name = Column(String,  nullable=False)
    new_person_id        = Column(Integer, nullable=True)
    new_person_name      = Column(String,  nullable=False)
    reason               = Column(Text,    nullable=True)
    changed_by           = Column(String,  nullable=True)
    changed_at           = Column(DateTime(timezone=True), nullable=False, index=True)
