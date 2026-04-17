from core.database import Base
from sqlalchemy import Column, DateTime, Index, Integer, String


class Staffing(Base):
    __tablename__ = "staffing"
    __table_args__ = (
        Index('ix_staffing_project_id', 'project_id'),
        Index('ix_staffing_person_id', 'person_id'),
        Index('ix_staffing_phase_id', 'phase_id'),
        {"extend_existing": True},
    )

    id               = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id       = Column(Integer, nullable=False)
    phase_id         = Column(Integer, nullable=False)
    category         = Column(String,  nullable=False)
    field            = Column(String,  nullable=False)
    sub_field        = Column(String,  nullable=False)
    person_id        = Column(Integer, nullable=True)
    person_name_text = Column(String,  nullable=True)
    md               = Column(Integer, nullable=True)
    updated_at       = Column(DateTime(timezone=True), nullable=True)
    deleted_at       = Column(DateTime(timezone=True), nullable=True, index=True)  # soft-delete
