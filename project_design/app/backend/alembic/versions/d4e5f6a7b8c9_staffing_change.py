"""staffing_change table: 공식 인력 변경 이력

Revision ID: d4e5f6a7b8c9
Revises: b2c3d4e5f6a7
Create Date: 2026-03-23 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 테이블이 이미 존재하면 스킵 (Railway 재배포 시 중복 생성 방지)
    bind = op.get_bind()
    inspector = inspect(bind)
    if 'staffing_change' not in inspector.get_table_names():
        op.create_table(
            'staffing_change',
            sa.Column('id',                   sa.Integer(),               autoincrement=True, nullable=False),
            sa.Column('staffing_id',          sa.Integer(),               nullable=False),
            sa.Column('project_id',           sa.Integer(),               nullable=False),
            sa.Column('phase_id',             sa.Integer(),               nullable=False),
            sa.Column('original_person_id',   sa.Integer(),               nullable=True),
            sa.Column('original_person_name', sa.String(),                nullable=False),
            sa.Column('new_person_id',        sa.Integer(),               nullable=True),
            sa.Column('new_person_name',      sa.String(),                nullable=False),
            sa.Column('reason',               sa.Text(),                  nullable=True),
            sa.Column('changed_by',           sa.String(),                nullable=True),
            sa.Column('changed_at',           sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
    # 인덱스도 존재 여부 확인 후 생성
    existing_indexes = [idx['name'] for idx in inspector.get_indexes('staffing_change')]
    for idx_name, col in [
        ('ix_staffing_change_id',          'id'),
        ('ix_staffing_change_staffing_id', 'staffing_id'),
        ('ix_staffing_change_project_id',  'project_id'),
        ('ix_staffing_change_phase_id',    'phase_id'),
        ('ix_staffing_change_changed_at',  'changed_at'),
    ]:
        if idx_name not in existing_indexes:
            op.create_index(idx_name, 'staffing_change', [col], unique=False)


def downgrade() -> None:
    op.drop_index('ix_staffing_change_changed_at', table_name='staffing_change')
    op.drop_index('ix_staffing_change_phase_id',   table_name='staffing_change')
    op.drop_index('ix_staffing_change_project_id', table_name='staffing_change')
    op.drop_index('ix_staffing_change_staffing_id',table_name='staffing_change')
    op.drop_index('ix_staffing_change_id',         table_name='staffing_change')
    op.drop_table('staffing_change')
