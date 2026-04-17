"""add_performance_indexes: 인력별 일정 화면 성능 개선용 인덱스 추가

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-17 12:00:00.000000

변경 내용:
- calendar_entries.staffing_id 인덱스 추가 (전체 기간 MD 카운트 쿼리 핵심)
- calendar_entries.(staffing_id, entry_date) 복합 인덱스 추가 (월별 조회)
- calendar_entries.(entry_date) 인덱스 추가 (날짜 범위 조회)
- staffing.project_id 인덱스 추가
- staffing.person_id 인덱스 추가
- staffing.phase_id 인덱스 추가
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'i9j0k1l2m3n4'
down_revision: Union[str, Sequence[str], None] = 'h8i9j0k1l2m3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # calendar_entries 인덱스
    op.create_index(
        'ix_calendar_entries_staffing_id',
        'calendar_entries',
        ['staffing_id'],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        'ix_calendar_entries_staffing_id_entry_date',
        'calendar_entries',
        ['staffing_id', 'entry_date'],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        'ix_calendar_entries_entry_date',
        'calendar_entries',
        ['entry_date'],
        unique=False,
        if_not_exists=True,
    )

    # staffing 인덱스
    op.create_index(
        'ix_staffing_project_id',
        'staffing',
        ['project_id'],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        'ix_staffing_person_id',
        'staffing',
        ['person_id'],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        'ix_staffing_phase_id',
        'staffing',
        ['phase_id'],
        unique=False,
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index('ix_staffing_phase_id', table_name='staffing')
    op.drop_index('ix_staffing_person_id', table_name='staffing')
    op.drop_index('ix_staffing_project_id', table_name='staffing')
    op.drop_index('ix_calendar_entries_entry_date', table_name='calendar_entries')
    op.drop_index('ix_calendar_entries_staffing_id_entry_date', table_name='calendar_entries')
    op.drop_index('ix_calendar_entries_staffing_id', table_name='calendar_entries')
