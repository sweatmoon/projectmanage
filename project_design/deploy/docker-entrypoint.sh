#!/bin/bash
set -e

echo "=== 감리 공수관리 시스템 시작 ==="

# DB 마이그레이션 실행
echo "[1/2] DB 마이그레이션 실행 중..."
cd /app
alembic upgrade head || echo "마이그레이션 건너뜀 (이미 최신 상태)"

# 서버 시작
# --proxy-headers : X-Forwarded-Proto, X-Forwarded-For 헤더 신뢰
#                   (DSM Application Portal 역방향 프록시 HTTPS 처리)
# --forwarded-allow-ips='*' : 모든 프록시 IP 허용 (NAS 내부망이므로 안전)
echo "[2/2] 서버 시작 (포트 ${PORT:-8080})..."
exec uvicorn main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8080}" \
    --workers 1 \
    --no-access-log \
    --proxy-headers \
    --forwarded-allow-ips='*'
