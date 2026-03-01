from core.database import Base
from sqlalchemy import Column, Date, Integer, String


class Phases(Base):
    __tablename__ = "phases"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id = Column(Integer, nullable=False)
    phase_name = Column(String, nullable=False)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    sort_order = Column(Integer, nullable=False)