"""staffing_change table: 공식 인력 변경 이력

Revision ID: d4e5f6a7b8c9
Revises: b2c3d4e5f6a7
Create Date: 2026-03-23 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
    op.create_index('ix_staffing_change_id',         'staffing_change', ['id'],         unique=False)
    op.create_index('ix_staffing_change_staffing_id','staffing_change', ['staffing_id'],unique=False)
    op.create_index('ix_staffing_change_project_id', 'staffing_change', ['project_id'], unique=False)
    op.create_index('ix_staffing_change_phase_id',   'staffing_change', ['phase_id'],   unique=False)
    op.create_index('ix_staffing_change_changed_at', 'staffing_change', ['changed_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_staffing_change_changed_at', table_name='staffing_change')
    op.drop_index('ix_staffing_change_phase_id',   table_name='staffing_change')
    op.drop_index('ix_staffing_change_project_id', table_name='staffing_change')
    op.drop_index('ix_staffing_change_staffing_id',table_name='staffing_change')
    op.drop_index('ix_staffing_change_id',         table_name='staffing_change')
    op.drop_table('staffing_change')
