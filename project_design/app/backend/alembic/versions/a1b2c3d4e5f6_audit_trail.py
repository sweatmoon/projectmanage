"""audit trail system: audit_logs, soft-delete columns

Revision ID: a1b2c3d4e5f6
Revises: cf272388a28c
Create Date: 2026-03-02 00:00:00.000000

변경 내용:
1. audit_logs 테이블 생성 (감사 로그 메인)
2. audit_logs_archive 테이블 생성 (6개월+ 아카이브)
3. projects / phases / staffing / people 테이블에 deleted_at 컬럼 추가
4. users 테이블 role 컬럼에 audit_viewer 값 허용 (코멘트만)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'cf272388a28c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. audit_logs 메인 테이블 ────────────────────────────
    op.create_table(
        'audit_logs',
        sa.Column('id',               sa.Integer(),                    autoincrement=True, nullable=False),
        sa.Column('event_id',         sa.String(36),                   nullable=False),
        sa.Column('event_type',       sa.String(50),                   nullable=False),
        sa.Column('entity_type',      sa.String(50),                   nullable=False),
        sa.Column('entity_id',        sa.String(50),                   nullable=True),
        sa.Column('project_id',       sa.Integer(),                    nullable=True),
        sa.Column('user_id',          sa.String(255),                  nullable=True),
        sa.Column('user_name',        sa.String(255),                  nullable=True),
        sa.Column('user_role',        sa.String(50),                   nullable=True),
        sa.Column('timestamp',        sa.DateTime(timezone=True),      nullable=False,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('client_ip',        sa.String(100),                  nullable=True),
        sa.Column('user_agent',       sa.Text(),                       nullable=True),
        sa.Column('request_path',     sa.String(500),                  nullable=True),
        sa.Column('request_id',       sa.String(36),                   nullable=True),
        sa.Column('before_data',      sa.Text(),                       nullable=True),
        sa.Column('after_data',       sa.Text(),                       nullable=True),
        sa.Column('changed_fields',   sa.Text(),                       nullable=True),
        sa.Column('is_system_action', sa.Boolean(),                    nullable=False, default=False),
        sa.Column('description',      sa.Text(),                       nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_logs_event_id',    'audit_logs', ['event_id'],    unique=True)
    op.create_index('ix_audit_logs_event_type',  'audit_logs', ['event_type'],  unique=False)
    op.create_index('ix_audit_logs_entity_type', 'audit_logs', ['entity_type'], unique=False)
    op.create_index('ix_audit_logs_entity_id',   'audit_logs', ['entity_id'],   unique=False)
    op.create_index('ix_audit_logs_project_id',  'audit_logs', ['project_id'],  unique=False)
    op.create_index('ix_audit_logs_user_id',     'audit_logs', ['user_id'],     unique=False)
    op.create_index('ix_audit_logs_timestamp',   'audit_logs', ['timestamp'],   unique=False)
    op.create_index('ix_audit_logs_request_id',  'audit_logs', ['request_id'],  unique=False)
    op.create_index('ix_audit_project_time',     'audit_logs', ['project_id', 'timestamp'], unique=False)
    op.create_index('ix_audit_entity_time',      'audit_logs', ['entity_type', 'timestamp'], unique=False)
    op.create_index('ix_audit_user_time',        'audit_logs', ['user_id', 'timestamp'], unique=False)
    op.create_index('ix_audit_type_time',        'audit_logs', ['event_type', 'timestamp'], unique=False)

    # ── 2. audit_logs_archive 아카이브 테이블 ────────────────
    op.create_table(
        'audit_logs_archive',
        sa.Column('id',               sa.Integer(),               autoincrement=True, nullable=False),
        sa.Column('event_id',         sa.String(36),              nullable=False),
        sa.Column('event_type',       sa.String(50),              nullable=False),
        sa.Column('entity_type',      sa.String(50),              nullable=False),
        sa.Column('entity_id',        sa.String(50),              nullable=True),
        sa.Column('project_id',       sa.Integer(),               nullable=True),
        sa.Column('user_id',          sa.String(255),             nullable=True),
        sa.Column('user_name',        sa.String(255),             nullable=True),
        sa.Column('user_role',        sa.String(50),              nullable=True),
        sa.Column('timestamp',        sa.DateTime(timezone=True), nullable=False),
        sa.Column('client_ip',        sa.String(100),             nullable=True),
        sa.Column('user_agent',       sa.Text(),                  nullable=True),
        sa.Column('request_path',     sa.String(500),             nullable=True),
        sa.Column('request_id',       sa.String(36),              nullable=True),
        sa.Column('before_data',      sa.Text(),                  nullable=True),
        sa.Column('after_data',       sa.Text(),                  nullable=True),
        sa.Column('changed_fields',   sa.Text(),                  nullable=True),
        sa.Column('is_system_action', sa.Boolean(),               nullable=False, default=False),
        sa.Column('description',      sa.Text(),                  nullable=True),
        sa.Column('archived_at',      sa.DateTime(timezone=True), nullable=True,
                  server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_archive_event_id',  'audit_logs_archive', ['event_id'],  unique=True)
    op.create_index('ix_audit_archive_timestamp', 'audit_logs_archive', ['timestamp'], unique=False)

    # ── 3. 도메인 테이블에 deleted_at (soft-delete) 컬럼 추가 ─
    # projects
    with op.batch_alter_table('projects') as batch_op:
        batch_op.add_column(
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index('ix_projects_deleted_at', ['deleted_at'])

    # phases
    with op.batch_alter_table('phases') as batch_op:
        batch_op.add_column(
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index('ix_phases_deleted_at', ['deleted_at'])

    # staffing
    with op.batch_alter_table('staffing') as batch_op:
        batch_op.add_column(
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index('ix_staffing_deleted_at', ['deleted_at'])

    # people
    with op.batch_alter_table('people') as batch_op:
        batch_op.add_column(
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.create_index('ix_people_deleted_at', ['deleted_at'])


def downgrade() -> None:
    # people
    with op.batch_alter_table('people') as batch_op:
        batch_op.drop_index('ix_people_deleted_at')
        batch_op.drop_column('deleted_at')

    # staffing
    with op.batch_alter_table('staffing') as batch_op:
        batch_op.drop_index('ix_staffing_deleted_at')
        batch_op.drop_column('deleted_at')

    # phases
    with op.batch_alter_table('phases') as batch_op:
        batch_op.drop_index('ix_phases_deleted_at')
        batch_op.drop_column('deleted_at')

    # projects
    with op.batch_alter_table('projects') as batch_op:
        batch_op.drop_index('ix_projects_deleted_at')
        batch_op.drop_column('deleted_at')

    # audit tables
    op.drop_index('ix_audit_archive_timestamp',  table_name='audit_logs_archive')
    op.drop_index('ix_audit_archive_event_id',   table_name='audit_logs_archive')
    op.drop_table('audit_logs_archive')

    op.drop_index('ix_audit_type_time',        table_name='audit_logs')
    op.drop_index('ix_audit_user_time',        table_name='audit_logs')
    op.drop_index('ix_audit_entity_time',      table_name='audit_logs')
    op.drop_index('ix_audit_project_time',     table_name='audit_logs')
    op.drop_index('ix_audit_logs_request_id',  table_name='audit_logs')
    op.drop_index('ix_audit_logs_timestamp',   table_name='audit_logs')
    op.drop_index('ix_audit_logs_user_id',     table_name='audit_logs')
    op.drop_index('ix_audit_logs_project_id',  table_name='audit_logs')
    op.drop_index('ix_audit_logs_entity_id',   table_name='audit_logs')
    op.drop_index('ix_audit_logs_entity_type', table_name='audit_logs')
    op.drop_index('ix_audit_logs_event_type',  table_name='audit_logs')
    op.drop_index('ix_audit_logs_event_id',    table_name='audit_logs')
    op.drop_table('audit_logs')
