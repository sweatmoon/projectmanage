from core.database import Base
from sqlalchemy import Boolean, Column, DateTime, Integer, String


class People(Base):
    __tablename__ = "people"
    __table_args__ = {"extend_existing": True}

    id                = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    person_name       = Column(String,  nullable=False)
    position          = Column(String,  nullable=True)   # 직급 (예: 수석, 책임, 선임, 주임, 사원)
    team              = Column(String,  nullable=True)   # 팀 (레거시, UI에서 숨김)
    grade             = Column(String,  nullable=True)   # 감리원 등급 (특급/고급/중급/초급)
    employment_status = Column(String,  nullable=True)   # 구분 (재직/외부/퇴사)
    company           = Column(String,  nullable=True)   # 소속 회사
    is_chief          = Column(Boolean, nullable=True, default=False)  # 총괄감리원 여부
    region            = Column(String,  nullable=True)   # 거주지역 (예: 서울, 경기, 부산 등)
    can_travel        = Column(Boolean, nullable=True, default=True)   # 지방 출장 가능 여부
    deleted_at        = Column(DateTime(timezone=True), nullable=True, index=True)  # soft-delete
