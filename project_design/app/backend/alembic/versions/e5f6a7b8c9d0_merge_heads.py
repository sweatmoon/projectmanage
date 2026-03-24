"""merge heads: c3d4e5f6a7b8 + d4e5f6a7b8c9

Revision ID: e5f6a7b8c9d0
Revises: c3d4e5f6a7b8, d4e5f6a7b8c9
Create Date: 2026-03-24 00:00:00.000000

변경 내용:
- c3d4e5f6a7b8 (project color_hue) 와 d4e5f6a7b8c9 (staffing_change) 브랜치를 단일 HEAD로 병합
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = ('c3d4e5f6a7b8', 'd4e5f6a7b8c9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
