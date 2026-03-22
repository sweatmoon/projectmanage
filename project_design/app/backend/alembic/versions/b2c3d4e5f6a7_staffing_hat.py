"""staffing_hat table: 모자(대체인력) 관리

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-22 00:00:00.000000

변경 내용:
1. staffing_hat 테이블 생성
   - staffing_id: 공식 인력 staffing row 참조
   - actual_person_id: 실제 투입자 people.id (nullable, 외부인력 대응)
   - actual_person_name: 실제 투입자 이름
   - created_at / updated_at / deleted_at (soft-delete)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'staffing_hat',
        sa.Column('id',                 sa.Integer(),                    autoincrement=True, nullable=False),
        sa.Column('staffing_id',        sa.Integer(),                    nullable=False),
        sa.Column('actual_person_id',   sa.Integer(),                    nullable=True),
        sa.Column('actual_person_name', sa.String(),                     nullable=False),
        sa.Column('created_at',         sa.DateTime(timezone=True),      nullable=True),
        sa.Column('updated_at',         sa.DateTime(timezone=True),      nullable=True),
        sa.Column('deleted_at',         sa.DateTime(timezone=True),      nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_staffing_hat_id'),          'staffing_hat', ['id'],          unique=False)
    op.create_index(op.f('ix_staffing_hat_staffing_id'), 'staffing_hat', ['staffing_id'], unique=False)
    op.create_index(op.f('ix_staffing_hat_deleted_at'),  'staffing_hat', ['deleted_at'],  unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_staffing_hat_deleted_at'),  table_name='staffing_hat')
    op.drop_index(op.f('ix_staffing_hat_staffing_id'), table_name='staffing_hat')
    op.drop_index(op.f('ix_staffing_hat_id'),          table_name='staffing_hat')
    op.drop_table('staffing_hat')
