from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Staffing(Base):
    __tablename__ = "staffing"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id = Column(Integer, nullable=False)
    phase_id = Column(Integer, nullable=False)
    category = Column(String, nullable=False)
    field = Column(String, nullable=False)
    sub_field = Column(String, nullable=False)
    person_id = Column(Integer, nullable=True)
    person_name_text = Column(String, nullable=True)
    md = Column(Integer, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)