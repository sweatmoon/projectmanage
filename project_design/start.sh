#!/bin/bash
# 감리 공수관리 시스템 - 서버 시작 스크립트

set -e

APP_DIR="/home/user/webapp/project_design/app"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
PORT=8080

echo "=== 감리 공수관리 시스템 시작 ==="
echo "Backend: $BACKEND_DIR"
echo "Frontend: $FRONTEND_DIR"
echo "Port: $PORT"

# 기존 uvicorn 프로세스 종료
echo ""
echo "[1/3] 기존 서버 종료 중..."
pkill -f "uvicorn main:app.*$PORT" 2>/dev/null || true
sleep 1

# 프론트엔드 빌드
echo ""
echo "[2/3] 프론트엔드 빌드 중..."
cd "$FRONTEND_DIR"
npm run build 2>&1 | tail -5

# 백엔드 서버 시작
echo ""
echo "[3/3] 백엔드 서버 시작 중..."
cd "$BACKEND_DIR"
export DATABASE_URL="sqlite:///./app.db"
nohup uvicorn main:app --host 0.0.0.0 --port $PORT > logs/server.log 2>&1 &
SERVER_PID=$!
echo "서버 PID: $SERVER_PID"

# 헬스 체크
echo ""
echo "서버 시작 대기 중..."
for i in {1..15}; do
    sleep 1
    if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
        echo "✅ 서버 시작 성공!"
        echo ""
        echo "접속 URL: http://localhost:$PORT"
        break
    fi
    echo "  대기 중... ($i/15)"
done

echo ""
echo "=== 완료 ==="
