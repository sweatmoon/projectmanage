from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Projects(Base):
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_name = Column(String, nullable=False)
    organization = Column(String, nullable=False)
    status = Column(String, nullable=False)
    deadline = Column(DateTime(timezone=True), nullable=True)
    notes = Column(String, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)