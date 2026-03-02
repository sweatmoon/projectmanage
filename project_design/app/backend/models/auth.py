from models.base import Base
from sqlalchemy import Column, DateTime, Integer, String, Text, Boolean
from sqlalchemy.sql import func


class User(Base):
    __tablename__ = "users"

    id = Column(String(255), primary_key=True, index=True)  # Use platform sub as primary key
    email = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    role = Column(String(50), default="user", nullable=False)  # user/admin
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login = Column(DateTime(timezone=True), nullable=True)


class AllowedUser(Base):
    """접속 허용 사용자 목록 - 여기 등록된 사용자만 앱에 접근 가능"""
    __tablename__ = "allowed_users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(String(255), unique=True, index=True, nullable=False)  # Synology 계정 ID
    display_name = Column(String(255), nullable=True)   # 표시 이름 (메모용)
    role = Column(String(50), default="user", nullable=False)  # user / admin
    is_active = Column(Boolean, default=True, nullable=False)   # 활성/비활성
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(String(255), nullable=True)     # 등록한 관리자 ID
    note = Column(String(500), nullable=True)           # 메모


class OIDCState(Base):
    __tablename__ = "oidc_states"

    id = Column(Integer, primary_key=True, index=True)
    state = Column(String(255), unique=True, index=True, nullable=False)
    nonce = Column(String(255), nullable=False)
    code_verifier = Column(String(255), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AccessLog(Base):
    __tablename__ = "access_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id = Column(String(255), nullable=True, index=True)
    user_email = Column(String(255), nullable=True)
    user_name = Column(String(255), nullable=True)
    action = Column(String(50), nullable=False)          # login / logout / api
    method = Column(String(10), nullable=True)           # GET / POST / PUT / DELETE
    path = Column(String(500), nullable=True)
    status_code = Column(Integer, nullable=True)
    ip_address = Column(String(100), nullable=True)
    user_agent = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)         # 응답 시간 (ms)
