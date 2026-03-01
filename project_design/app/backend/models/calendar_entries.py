from core.database import Base
from sqlalchemy import Column, Date, Integer, String


class Calendar_entries(Base):
    __tablename__ = "calendar_entries"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    staffing_id = Column(Integer, nullable=False)
    entry_date = Column(Date, nullable=False)
    status = Column(String, nullable=True)