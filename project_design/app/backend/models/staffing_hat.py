from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, ForeignKey


class StaffingHat(Base):
    """
    모자(대체인력) 테이블
    - staffing_id: 공식 인력의 staffing row (원본 불변)
    - actual_person_id: 실제 투입자 ID (시스템 등록 인력, nullable)
    - actual_person_name: 실제 투입자 이름 (직접 입력 또는 DB 이름)
    """
    __tablename__ = "staffing_hat"
    __table_args__ = {"extend_existing": True}

    id                  = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    staffing_id         = Column(Integer, nullable=False, index=True)   # staffing.id (FK 논리적)
    actual_person_id    = Column(Integer, nullable=True)                # people.id (시스템 등록 인력)
    actual_person_name  = Column(String,  nullable=False)               # 실제 투입자 이름
    created_at          = Column(DateTime(timezone=True), nullable=True)
    updated_at          = Column(DateTime(timezone=True), nullable=True)
    deleted_at          = Column(DateTime(timezone=True), nullable=True, index=True)  # soft-delete
