from core.database import Base
from sqlalchemy import Column, Date, Index, Integer, String


class Calendar_entries(Base):
    __tablename__ = "calendar_entries"
    __table_args__ = (
        Index('ix_calendar_entries_staffing_id', 'staffing_id'),
        Index('ix_calendar_entries_staffing_id_entry_date', 'staffing_id', 'entry_date'),
        Index('ix_calendar_entries_entry_date', 'entry_date'),
        {"extend_existing": True},
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    staffing_id = Column(Integer, nullable=False)
    entry_date = Column(Date, nullable=False)
    status = Column(String, nullable=True)