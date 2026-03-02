from core.database import Base
from sqlalchemy import Column, DateTime, Integer, String, func


class PagePresence(Base):
    __tablename__ = "page_presence"
    __table_args__ = {"extend_existing": True}

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(String, nullable=False, index=True)
    user_name   = Column(String, nullable=False)
    page_type   = Column(String, nullable=False)   # 'project' | 'schedule'
    page_id     = Column(Integer, nullable=False, index=True)
    mode        = Column(String, nullable=False, default='viewing')  # 'viewing' | 'editing'
    last_seen   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
