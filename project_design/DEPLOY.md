# 감리 공수관리 시스템 — 배포 가이드

## 아키텍처

```
[브라우저]
    │  HTTP
    ▼
[uvicorn / FastAPI]  ← 포트 8080 (단일 포트)
    ├── /api/v1/*       API 엔드포인트
    └── /*              React SPA (빌드된 정적 파일 서빙)

[SQLite]  app.db  (파일 기반 DB)
```

---

## 옵션 A — 🐳 Docker (추천, 가장 간단)

### 사전 요건
- Docker 20.10+
- Docker Compose v2+

### 1단계: 실행

```bash
# 프로젝트 루트에서
docker compose up -d --build

# 로그 확인
docker compose logs -f

# 접속
# http://localhost:8080
```

### 2단계: 업데이트 배포

```bash
docker compose down
docker compose up -d --build
```

### 데이터 백업

```bash
# DB 백업 (볼륨에서 파일 추출)
docker compose cp app:/data/app.db ./backup_$(date +%Y%m%d).db
```

---

## 옵션 B — 🖥️ VPS / 클라우드 VM (Ubuntu)

### 사전 요건
- Ubuntu 20.04 / 22.04
- Python 3.11+, Node.js 20+, Nginx

### 1단계: 초기 설치

```bash
# 서버에서 프로젝트 루트 디렉터리에서 실행
sudo bash deploy/setup-server.sh
```

→ 자동으로 아래 작업 수행:
1. Node.js 20, Python 3.11, Nginx 설치
2. 프론트엔드 빌드 (`npm run build`)
3. Python 가상환경 생성 + 의존성 설치
4. SQLite DB 마이그레이션
5. systemd 서비스 등록 (`/etc/systemd/system/gantt-app.service`)
6. Nginx 리버스 프록시 설정

### 2단계: 서비스 관리

```bash
# 상태 확인
sudo systemctl status gantt-app

# 로그 보기
sudo journalctl -u gantt-app -f

# 재시작
sudo systemctl restart gantt-app
```

### 3단계: 코드 업데이트

```bash
sudo bash deploy/update.sh
```

### HTTPS 설정 (도메인 있을 때)

```bash
# Certbot으로 Let's Encrypt 인증서 발급
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 옵션 C — ☁️ 클라우드 PaaS (Railway / Render)

### Railway

```bash
# Railway CLI 설치
npm install -g @railway/cli
railway login

# 프로젝트 루트에서
railway init
railway up
```

**railway.toml** (프로젝트 루트에 생성):
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "/docker-entrypoint.sh"
healthcheckPath = "/health"
```

> ⚠️ Railway/Render는 SQLite 데이터가 재배포 시 초기화됩니다.
> 운영 환경에서는 **PostgreSQL로 전환**을 권장합니다.

### Render

1. Render.com → New Web Service
2. GitHub 저장소 연결
3. 설정:
   - **Environment**: Docker
   - **Dockerfile Path**: `Dockerfile`
   - **Port**: 8080
4. 환경변수 추가:
   - `DATABASE_URL` = `sqlite:////data/app.db`

---

## 옵션 D — 🟣 개인 서버 (간단 실행)

### 빠른 실행 (개발/테스트용)

```bash
# 1. 프론트엔드 빌드
cd app/frontend
npm install
npm run build

# 2. 백엔드 실행
cd ../backend
pip install -r requirements.txt
alembic upgrade head
DATABASE_URL=sqlite:///./app.db uvicorn main:app --host 0.0.0.0 --port 8080
```

---

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `DATABASE_URL` | `sqlite:///./app.db` | DB 연결 URL |
| `PORT` | `8080` | 서버 포트 |

---

## DB 관리

```bash
# 현재 마이그레이션 상태 확인
alembic current

# 마이그레이션 실행
alembic upgrade head

# 롤백
alembic downgrade -1

# DB 백업 (SQLite)
cp app.db backup_$(date +%Y%m%d_%H%M%S).db
```

---

## 권장 배포 방식 선택

| 상황 | 추천 방식 |
|------|----------|
| 사내 서버 / NAS | **옵션 B** (VPS 설치) 또는 **옵션 A** (Docker) |
| AWS EC2 / GCP VM | **옵션 A** (Docker) |
| 빠른 테스트 공유 | **옵션 C** (Railway) |
| 개발/테스트 | **옵션 D** (직접 실행) |
