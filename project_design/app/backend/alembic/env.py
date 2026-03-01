#!/usr/bin/env python
# -*- coding: utf-8 -*-
# @Desc   :

import asyncio
import importlib
import os
import pkgutil
from logging.config import fileConfig

import models
from alembic import context
from core.database import Base
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

# Automatically import all ORM models under Models
for _, module_name, _ in pkgutil.iter_modules(models.__path__):
    importlib.import_module(f"{models.__name__}.{module_name}")

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from DATABASE_URL environment variable if set
_db_url = os.environ.get("DATABASE_URL", "sqlite:///./app.db")
# Ensure async driver for SQLite
if _db_url.startswith("sqlite:///") and "+aiosqlite" not in _db_url:
    _db_url = _db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
elif _db_url.startswith("postgresql://") and "+asyncpg" not in _db_url:
    _db_url = _db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
config.set_main_option("sqlalchemy.url", _db_url)

target_metadata = Base.metadata


def alembic_include_object(object, name, type_, reflected, compare_to):
    # type_ can be 'table', 'index', 'column', 'constraint'
    # ignore particular table_name
    if type_ == "table" and name in ["users", "sessions", "oidc_states"]:
        return False
    return True


async def run_migrations_online():
    connectable = create_async_engine(_db_url, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(
            lambda sync_conn: context.configure(
                connection=sync_conn,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
                include_object=alembic_include_object,
            )
        )
        async with connection.begin():
            await connection.run_sync(lambda sync_conn: context.run_migrations())
    await connectable.dispose()


def run_migrations():
    try:
        # If there is no event loop currently, use asyncio.run directly
        loop = asyncio.get_running_loop()
        loop.create_task(run_migrations_online())
    except RuntimeError:
        asyncio.run(run_migrations_online())


run_migrations()
