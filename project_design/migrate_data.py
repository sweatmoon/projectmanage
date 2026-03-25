#!/usr/bin/env python3
"""
데이터 마이그레이션 스크립트
기존 DB(SQLite 또는 구 PostgreSQL) → Railway PostgreSQL

사용법:
  python migrate_data.py --src <기존 DB URL> --dst <Railway DB URL>

예시:
  # SQLite → Railway PostgreSQL
  python migrate_data.py \
    --src "sqlite:///./app.db" \
    --dst "postgresql://postgres:HCfKILjUYshBqeAtarBSIgsHmOZJAceD@junction.proxy.rlwy.net:PORT/railway"

  # 구 PostgreSQL → Railway PostgreSQL
  python migrate_data.py \
    --src "postgresql://user:pass@old-host:5432/olddb" \
    --dst "postgresql://postgres:HCfKILjUYshBqeAtarBSIgsHmOZJAceD@junction.proxy.rlwy.net:PORT/railway"

  # 드라이 런 (실제 쓰기 없이 통계만)
  python migrate_data.py --src "sqlite:///./app.db" --dst "..." --dry-run

필요 패키지:
  pip install sqlalchemy psycopg2-binary aiosqlite
"""

import argparse
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    create_engine, text, inspect,
    Column, Integer, String, DateTime, Date, Boolean, Text
)
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# ─────────────────────────────────────────────────────────────
# 마이그레이션 대상 테이블 순서 (FK 의존성 순서)
# ─────────────────────────────────────────────────────────────
TABLES_IN_ORDER = [
    "people",
    "projects",
    "phases",
    "staffing",
    "calendar_entries",
    "staffing_hat",
    "staffing_change",
    "audit_logs",
    "audit_logs_archive",
    # auth 관련 (있으면)
    "users",
    "allowed_users",
    "oidc_states",
    "access_logs",
    "pending_users",
]

# 각 테이블의 PK 컬럼
TABLE_PK = {
    "people":              "id",
    "projects":            "id",
    "phases":              "id",
    "staffing":            "id",
    "calendar_entries":    "id",
    "staffing_hat":        "id",
    "staffing_change":     "id",
    "audit_logs":          "id",
    "audit_logs_archive":  "id",
    "users":               "id",
    "allowed_users":       "id",
    "oidc_states":         "id",
    "access_logs":         "id",
    "pending_users":       "id",
}


def normalize_src_url(url: str) -> str:
    """소스 URL을 동기 드라이버로 정규화"""
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    url = url.replace("sqlite+aiosqlite://", "sqlite:///")
    # ?sslmode 제거
    if "?" in url:
        url = url.split("?")[0]
    return url


def normalize_dst_url(url: str) -> str:
    """목적지 URL을 psycopg2 동기 드라이버로 정규화"""
    url = normalize_src_url(url)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


def get_engine(url: str, is_sqlite: bool = False):
    kwargs = {}
    if is_sqlite:
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


def get_existing_tables(engine) -> List[str]:
    insp = inspect(engine)
    return insp.get_table_names()


def get_table_columns(engine, table: str) -> List[str]:
    insp = inspect(engine)
    return [col["name"] for col in insp.get_columns(table)]


def read_all_rows(engine, table: str) -> List[Dict[str, Any]]:
    with engine.connect() as conn:
        result = conn.execute(text(f"SELECT * FROM {table}"))
        rows = result.mappings().all()
        return [dict(r) for r in rows]


def upsert_rows(engine, table: str, rows: List[Dict[str, Any]], pk: str, dst_cols: List[str], dry_run: bool) -> int:
    """행 단위 UPSERT (INSERT ON CONFLICT UPDATE)"""
    if not rows:
        return 0

    # 소스에서 받은 컬럼 중 목적지에 있는 것만 필터
    common_cols = [c for c in rows[0].keys() if c in dst_cols]
    if not common_cols:
        print(f"  [WARN] {table}: 공통 컬럼 없음, 건너뜀")
        return 0

    if dry_run:
        return len(rows)

    inserted = 0
    with engine.begin() as conn:
        for row in rows:
            filtered = {k: v for k, v in row.items() if k in common_cols}
            cols = list(filtered.keys())
            vals = list(filtered.values())

            col_str = ", ".join(f'"{c}"' for c in cols)
            param_str = ", ".join(f":p_{i}" for i in range(len(cols)))
            params = {f"p_{i}": v for i, v in enumerate(vals)}

            # UPDATE SET 절 (pk 제외)
            update_cols = [c for c in cols if c != pk]
            if not update_cols:
                # pk만 있는 경우 INSERT OR IGNORE
                sql = text(f"""
                    INSERT INTO "{table}" ({col_str})
                    VALUES ({param_str})
                    ON CONFLICT ("{pk}") DO NOTHING
                """)
            else:
                update_str = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in update_cols)
                sql = text(f"""
                    INSERT INTO "{table}" ({col_str})
                    VALUES ({param_str})
                    ON CONFLICT ("{pk}") DO UPDATE SET {update_str}
                """)
            conn.execute(sql, params)
            inserted += 1

    return inserted


def reset_sequence(engine, table: str, pk: str):
    """PostgreSQL 시퀀스를 최대 ID + 1로 리셋"""
    with engine.begin() as conn:
        try:
            result = conn.execute(text(f'SELECT MAX("{pk}") FROM "{table}"'))
            max_id = result.scalar()
            if max_id is not None:
                conn.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', '{pk}'), {max_id})"
                ))
        except Exception as e:
            print(f"  [WARN] 시퀀스 리셋 실패 ({table}.{pk}): {e}")


def migrate(src_url: str, dst_url: str, dry_run: bool, tables_filter: Optional[List[str]] = None):
    src_url = normalize_src_url(src_url)
    dst_url = normalize_dst_url(dst_url)

    is_sqlite_src = src_url.startswith("sqlite")
    is_sqlite_dst = dst_url.startswith("sqlite")

    print(f"\n{'[DRY RUN] ' if dry_run else ''}마이그레이션 시작")
    print(f"  SRC: {src_url[:60]}...")
    print(f"  DST: {dst_url[:60]}...")
    print()

    src_engine = get_engine(src_url, is_sqlite=is_sqlite_src)
    dst_engine = get_engine(dst_url, is_sqlite=is_sqlite_dst)

    src_tables = get_existing_tables(src_engine)
    dst_tables = get_existing_tables(dst_engine)

    print(f"소스 테이블: {sorted(src_tables)}")
    print(f"목적지 테이블: {sorted(dst_tables)}")
    print()

    total_copied = 0
    total_skipped = 0

    for table in TABLES_IN_ORDER:
        if tables_filter and table not in tables_filter:
            continue
        if table not in src_tables:
            print(f"⏭  {table}: 소스에 없음, 건너뜀")
            continue
        if table not in dst_tables:
            print(f"⚠️  {table}: 목적지에 없음 (마이그레이션 실행 필요), 건너뜀")
            total_skipped += 1
            continue

        src_cols = get_table_columns(src_engine, table)
        dst_cols = get_table_columns(dst_engine, table)
        pk = TABLE_PK.get(table, "id")

        rows = read_all_rows(src_engine, table)
        count = upsert_rows(dst_engine, table, rows, pk, dst_cols, dry_run)

        # PostgreSQL 시퀀스 리셋
        if not dry_run and not is_sqlite_dst and count > 0:
            reset_sequence(dst_engine, table, pk)

        status = "🟡 DRY" if dry_run else "✅"
        print(f"{status}  {table}: {count}행 복사 | 소스컬럼={len(src_cols)} 목적지컬럼={len(dst_cols)}")
        total_copied += count

    print()
    print(f"{'[DRY RUN] ' if dry_run else ''}완료: 총 {total_copied}행 복사, {total_skipped}개 테이블 건너뜀")
    if dry_run:
        print("  ※ 드라이 런이므로 실제 DB에는 변경사항 없음. --dry-run 제거 후 재실행.")


def main():
    parser = argparse.ArgumentParser(description="ActiVo DB 마이그레이션 도구")
    parser.add_argument("--src", required=True, help="소스 DB URL (기존)")
    parser.add_argument("--dst", required=True, help="목적지 DB URL (Railway)")
    parser.add_argument("--dry-run", action="store_true", help="실제 쓰기 없이 시뮬레이션")
    parser.add_argument("--tables", nargs="+", help="마이그레이션할 테이블 목록 (기본: 전체)")
    args = parser.parse_args()

    migrate(
        src_url=args.src,
        dst_url=args.dst,
        dry_run=args.dry_run,
        tables_filter=args.tables,
    )


if __name__ == "__main__":
    main()
