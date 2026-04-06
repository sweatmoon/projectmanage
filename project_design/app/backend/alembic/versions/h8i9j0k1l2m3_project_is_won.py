"""project_is_won: 수주여부 컬럼 추가

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-04-06 13:30:00.000000

변경 내용:
- projects 테이블에 is_won (Boolean, NOT NULL, default False) 컬럼 추가
  - 제안(제안) 사업의 수주 여부를 저장
  - 수주 완료 시 인력별 일정 화면에서 P👑 아이콘 표시
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, Sequence[str], None] = 'g7h8i9j0k1l2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # is_won 컬럼 추가 (이미 존재할 경우 무시)
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [col['name'] for col in inspector.get_columns('projects')]
    if 'is_won' not in existing_columns:
        # PostgreSQL: server_default='false', SQLite: server_default='0'
        dialect = conn.dialect.name
        default_val = sa.text('false') if dialect == 'postgresql' else sa.text('0')
        op.add_column(
            'projects',
            sa.Column('is_won', sa.Boolean(), nullable=False, server_default=default_val)
        )


def downgrade() -> None:
    op.drop_column('projects', 'is_won')
