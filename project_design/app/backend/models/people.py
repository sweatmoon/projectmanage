from core.database import Base
from sqlalchemy import Column, Integer, String


class People(Base):
    __tablename__ = "people"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    person_name = Column(String, nullable=False)
    team = Column(String, nullable=True)
    grade = Column(String, nullable=True)
    employment_status = Column(String, nullable=True)