#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# 감리 공수관리 시스템 — 일반 서버(VM/VPS) 배포 스크립트
# Ubuntu 20.04 / 22.04 기준
# 사용법: sudo bash deploy/setup-server.sh
# ─────────────────────────────────────────────────────────────────
set -e

APP_DIR="/opt/gantt-app"
APP_USER="ganttapp"
SERVICE_NAME="gantt-app"
PORT=8080

echo "════════════════════════════════════════"
echo "  감리 공수관리 시스템 서버 설치"
echo "════════════════════════════════════════"

# ── 1. 시스템 패키지 ──────────────────────────
echo ""
echo "[1/7] 시스템 패키지 설치..."
apt-get update -q
apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3-pip \
    nodejs npm curl git nginx

# Node 18+ 확인 및 설치
NODE_VER=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [ "$NODE_VER" -lt 18 ]; then
    echo "  Node.js 20 LTS 설치 중..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# ── 2. 앱 유저 생성 ────────────────────────────
echo ""
echo "[2/7] 앱 유저 생성..."
id "$APP_USER" &>/dev/null || useradd -r -s /bin/bash -d "$APP_DIR" "$APP_USER"

# ── 3. 앱 디렉터리 설정 ───────────────────────
echo ""
echo "[3/7] 앱 디렉터리 설정..."
mkdir -p "$APP_DIR"/{app,data,logs}
cp -r app/ "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 4. 프론트엔드 빌드 ───────────────────────
echo ""
echo "[4/7] 프론트엔드 빌드..."
cd "$APP_DIR/app/frontend"
sudo -u "$APP_USER" npm ci --silent
sudo -u "$APP_USER" npm run build

# ── 5. Python 가상환경 & 의존성 ──────────────
echo ""
echo "[5/7] Python 환경 설정..."
cd "$APP_DIR/app/backend"
sudo -u "$APP_USER" python3.11 -m venv "$APP_DIR/venv"
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install --quiet -r requirements.txt

# ── 6. DB 초기화 ─────────────────────────────
echo ""
echo "[6/7] DB 마이그레이션..."
cd "$APP_DIR/app/backend"
DATABASE_URL="sqlite:////$APP_DIR/data/app.db" \
    sudo -u "$APP_USER" "$APP_DIR/venv/bin/alembic" upgrade head

# ── 7. systemd 서비스 등록 ────────────────────
echo ""
echo "[7/7] systemd 서비스 등록..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=감리 공수관리 시스템
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/app/backend
Environment="DATABASE_URL=sqlite:////${APP_DIR}/data/app.db"
Environment="PORT=${PORT}"
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 127.0.0.1 --port ${PORT} --workers 1
Restart=always
RestartSec=5
StandardOutput=append:${APP_DIR}/logs/app.log
StandardError=append:${APP_DIR}/logs/app.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── Nginx 리버스 프록시 설정 ──────────────────
cat > "/etc/nginx/sites-available/$SERVICE_NAME" << 'EOF'
server {
    listen 80;
    server_name _;          # 실제 도메인으로 교체: your-domain.com

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (Vite HMR 제외 — 운영 불필요)
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf "/etc/nginx/sites-available/$SERVICE_NAME" /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo ""
echo "════════════════════════════════════════"
echo "✅ 설치 완료!"
echo "   접속: http://$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo "   로그: journalctl -u $SERVICE_NAME -f"
echo "════════════════════════════════════════"
