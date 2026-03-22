from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String


class Projects(Base):
    __tablename__ = "projects"
    __table_args__ = {"extend_existing": True}

    id           = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_name = Column(String,  nullable=False)
    organization = Column(String,  nullable=False)
    status       = Column(String,  nullable=False)
    deadline     = Column(DateTime(timezone=True), nullable=True)
    notes        = Column(String,  nullable=True)
    updated_at   = Column(DateTime(timezone=True), nullable=True)
    deleted_at   = Column(DateTime(timezone=True), nullable=True, index=True)  # soft-delete
    color_hue    = Column(Integer, nullable=True)  # 0~359, HSL 색상환 Hue값
