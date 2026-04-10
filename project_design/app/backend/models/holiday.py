from core.database import Base
from sqlalchemy import Column, Integer, String, Boolean, DateTime


class Holiday(Base):
    """
    공휴일 테이블
    - 공공데이터포털 한국천문연구원 특일 정보 API로 동기화
    - 기존 hardcoded holidays.py 의 폴백 역할 유지
    """
    __tablename__ = "holidays"
    __table_args__ = {"extend_existing": True}

    id          = Column(Integer, primary_key=True, index=True, autoincrement=True)
    date_str    = Column(String(10), nullable=False, unique=True, index=True)  # YYYY-MM-DD
    date_name   = Column(String(100), nullable=False)                          # 명칭 (e.g. 삼일절)
    is_holiday  = Column(Boolean, nullable=False, default=True)                # isHoliday=Y 만 저장
    source      = Column(String(20), nullable=False, default="api")            # "api" | "manual"
    created_at  = Column(DateTime(timezone=True), nullable=True)
    updated_at  = Column(DateTime(timezone=True), nullable=True)
