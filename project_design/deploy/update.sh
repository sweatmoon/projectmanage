#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# 코드 업데이트 배포 스크립트 (이미 설치된 서버에서 사용)
# 사용법: bash deploy/update.sh
# ─────────────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/gantt-app"
APP_USER="ganttapp"
SERVICE_NAME="gantt-app"

echo "=== 업데이트 배포 시작 ==="

# 1. 코드 복사
echo "[1/4] 코드 업데이트..."
rsync -a --exclude='*.db' --exclude='logs/' --exclude='node_modules/' --exclude='venv/' \
    app/ "$APP_DIR/app/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/app"

# 2. 프론트엔드 재빌드
echo "[2/4] 프론트엔드 빌드..."
cd "$APP_DIR/app/frontend"
sudo -u "$APP_USER" npm ci --silent
sudo -u "$APP_USER" npm run build

# 3. Python 의존성 업데이트
echo "[3/4] Python 의존성 업데이트..."
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install --quiet -r "$APP_DIR/app/backend/requirements.txt"

# 4. DB 마이그레이션 + 재시작
echo "[4/4] DB 마이그레이션 & 서비스 재시작..."
cd "$APP_DIR/app/backend"
DATABASE_URL="sqlite:////$APP_DIR/data/app.db" \
    sudo -u "$APP_USER" "$APP_DIR/venv/bin/alembic" upgrade head

systemctl restart "$SERVICE_NAME"
sleep 3
systemctl is-active "$SERVICE_NAME" && echo "✅ 배포 완료!" || echo "❌ 서비스 시작 실패 — journalctl -u $SERVICE_NAME 확인"
