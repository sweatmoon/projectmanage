"""auth tables: users, allowed_users, oidc_states, access_logs

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-25 12:00:00.000000

변경 내용:
- users 테이블 생성
- allowed_users 테이블 생성
- oidc_states 테이블 생성
- access_logs 테이블 생성
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users 테이블
    op.create_table(
        'users',
        sa.Column('id', sa.String(255), primary_key=True, index=True),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('role', sa.String(50), nullable=False, server_default='user'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_login', sa.DateTime(timezone=True), nullable=True),
    )

    # allowed_users 테이블
    op.create_table(
        'allowed_users',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('display_name', sa.String(255), nullable=True),
        sa.Column('role', sa.String(50), nullable=False, server_default='user'),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('created_by', sa.String(255), nullable=True),
        sa.Column('note', sa.String(500), nullable=True),
    )

    # oidc_states 테이블
    op.create_table(
        'oidc_states',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('state', sa.String(255), unique=True, nullable=False, index=True),
        sa.Column('nonce', sa.String(255), nullable=False),
        sa.Column('code_verifier', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # access_logs 테이블
    op.create_table(
        'access_logs',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
        sa.Column('user_id', sa.String(255), nullable=True, index=True),
        sa.Column('user_email', sa.String(255), nullable=True),
        sa.Column('user_name', sa.String(255), nullable=True),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('method', sa.String(10), nullable=True),
        sa.Column('path', sa.String(500), nullable=True),
        sa.Column('status_code', sa.Integer, nullable=True),
        sa.Column('ip_address', sa.String(100), nullable=True),
        sa.Column('user_agent', sa.Text, nullable=True),
        sa.Column('duration_ms', sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_table('access_logs')
    op.drop_table('oidc_states')
    op.drop_table('allowed_users')
    op.drop_table('users')
