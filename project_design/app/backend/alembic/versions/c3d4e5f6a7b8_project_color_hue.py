"""project color_hue: 프로젝트별 고유 색상 Hue 저장

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-22 12:00:00.000000

변경 내용:
1. projects 테이블에 color_hue 컬럼 추가 (Integer, nullable, 0~359)
2. 기존 프로젝트 전체를 id 순으로 정렬 후 360/N 간격으로 Hue 균등 배분
   → 기존 색상 겹침 해소, 이후 신규 프로젝트는 빈 공간에 자동 배정
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. color_hue 컬럼 추가
    op.add_column('projects', sa.Column('color_hue', sa.Integer(), nullable=True))

    # 2. 기존 프로젝트에 균등 Hue 배분
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY id ASC")
    ).fetchall()

    n = len(rows)
    if n > 0:
        for i, row in enumerate(rows):
            hue = round((360 * i) / n) % 360
            conn.execute(
                text("UPDATE projects SET color_hue = :hue WHERE id = :pid"),
                {"hue": hue, "pid": row[0]}
            )


def downgrade() -> None:
    op.drop_column('projects', 'color_hue')
