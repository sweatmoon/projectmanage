# 프로젝트 공수관리 시스템

FastAPI + React 기반 프로젝트 일정/인력 관리 시스템입니다.

## 기능

- 사업별 단계 및 인력 투입 관리
- 간트차트 (공휴일/주말 표시)
- 월별 투입 일정 관리 (ScheduleTab)
- 한국 공휴일 자동 제외 (2024~2035)
- 인력별 투입 가능일 계산

---

## 빠른 시작 (Docker)

### 방법 1: Docker Compose (권장)

```bash
git clone https://github.com/sweatmoon/projectmanage.git
cd projectmanage/project_design

docker compose up -d
```

접속: http://localhost:8080

### 방법 2: Docker 직접 실행

```bash
git clone https://github.com/sweatmoon/projectmanage.git
cd projectmanage/project_design

# 빌드
docker build -t project-schedule .

# 실행 (포트: 8080, 데이터 볼륨 포함)
docker run -d \
  -p 8080:8080 \
  -v project_data:/data \
  --name gantt-app \
  project-schedule
```

접속: http://localhost:8080

> ⚠️ `-p 8000:8000` 은 동작하지 않습니다. 앱은 **8080** 포트에서 실행됩니다.

---

## 구조

```
project_design/
├── app/
│   ├── backend/          # FastAPI 백엔드
│   │   ├── main.py
│   │   ├── routers/      # API 라우터
│   │   ├── models/       # SQLAlchemy 모델
│   │   ├── services/     # 비즈니스 로직
│   │   └── utils/
│   │       └── holidays.py   # 한국 공휴일 유틸
│   └── frontend/         # React + TypeScript
│       └── src/
│           ├── components/
│           │   ├── ScheduleTab.tsx
│           │   ├── ProjectGanttTab.tsx
│           │   └── ...
│           └── lib/
│               └── holidays.ts  # 프론트엔드 공휴일 유틸
├── Dockerfile
├── docker-compose.yml
└── deploy/               # 서버 배포 스크립트
```

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `8080` | 서버 포트 |
| `DATABASE_URL` | `sqlite:////data/app.db` | DB 경로 |

## 데이터 백업

```bash
# DB 백업
docker cp gantt-app:/data/app.db ./backup_$(date +%Y%m%d).db

# DB 복원
docker cp backup_20260301.db gantt-app:/data/app.db
docker restart gantt-app
```

## 업데이트

```bash
cd projectmanage
git pull

cd project_design
docker compose down
docker compose up -d --build
```
