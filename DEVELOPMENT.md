# 개발 · 운영 가이드

> 감리 공수관리 시스템의 개발/운영 환경 차이 및 워크플로우

---

## 환경 비교

| 항목 | 개발 (Dev) | 운영 (Prod) |
|------|-----------|------------|
| **실행 방법** | `make dev` (로컬 직접 실행) | NAS Docker Compose |
| **백엔드 포트** | 8000 (FastAPI) | 8080 (컨테이너 내부) |
| **프론트 포트** | 8080 (Vite Dev Server) | → 백엔드가 빌드된 정적 파일 서빙 |
| **데이터베이스** | SQLite (`app.db`) or Docker PostgreSQL | PostgreSQL 16 컨테이너 |
| **인증 (OIDC)** | ❌ 비활성화 → `/auth/dev-login` 자동 사용 | ✅ 시놀로지 SSO 사용 |
| **관리자 계정** | `dev_admin` (자동) | `ADMIN_USERS` 환경변수로 지정 |
| **핫리로드** | ✅ Vite HMR + FastAPI `--reload` | ❌ (Watchtower가 이미지 교체) |
| **에러 상세** | ✅ 스택 트레이스 포함 | ❌ `Internal Server Error`만 반환 |
| **Docker 이미지** | 로컬 빌드 (`gantt-app:dev`) | Docker Hub (`sweatmoon/gantt-app:latest`) |
| **Watchtower** | ❌ 없음 | ✅ 5분마다 이미지 체크 |
| **DB 백업** | 없음 | 매일 자동, 30일 보관 |

---

## 디렉터리 구조

```
projectmanage/
├── .github/
│   └── workflows/
│       └── docker-build.yml     # CI/CD: 자동 빌드 & Docker Hub 업로드
│
├── project_design/
│   ├── docker-compose.yml       # 🔵 공통 베이스 (단독 실행 금지)
│   ├── docker-compose.dev.yml   # 🟡 개발 오버라이드 (로컬 빌드, DB 포트 노출)
│   ├── docker-compose.prod.yml  # 🔴 운영 오버라이드 (pull_policy, Watchtower)
│   ├── .env.example             # 환경변수 템플릿 (Git 커밋됨)
│   ├── .env                     # 실제 환경변수 (Git 커밋 금지!)
│   ├── Dockerfile               # 멀티스테이지 빌드 (프론트 + 백엔드)
│   │
│   ├── app/
│   │   ├── backend/             # FastAPI (Python 3.11)
│   │   │   ├── .env             # 백엔드 로컬 개발 환경변수
│   │   │   ├── main.py          # 앱 진입점
│   │   │   ├── core/config.py   # 설정 (환경변수 자동 로드)
│   │   │   ├── routers/
│   │   │   │   ├── auth.py      # OIDC 로그인 + dev-login
│   │   │   │   └── admin.py     # 관리자 API (/admin/*)
│   │   │   └── middlewares/
│   │   │       └── auth_middleware.py  # JWT 검증
│   │   │
│   │   └── frontend/            # React + Vite (TypeScript)
│   │       ├── vite.config.ts   # 환경 자동감지 HMR 설정
│   │       └── src/
│   │           ├── App.tsx      # 라우터 + AuthGuard
│   │           ├── lib/api.ts   # API 클라이언트 + 토큰 관리
│   │           └── pages/
│   │               └── AdminPage.tsx   # 관리자 페이지
│   │
│   └── deploy/
│       └── docker-entrypoint.sh  # 컨테이너 시작 스크립트 (마이그레이션 → 서버 시작)
│
└── Makefile                     # 개발/운영 명령 단축키
```

---

## 개발 환경 셋업

### 1) 처음 시작

```bash
# 환경변수 파일 생성
cp project_design/.env.example project_design/.env
# .env 편집: POSTGRES_PASSWORD, JWT_SECRET 등 입력

# 프론트엔드 의존성 설치
cd project_design/app/frontend && npm install

# 백엔드 의존성 설치
cd project_design/app/backend && pip install -r requirements.txt
```

### 2) 개발 서버 실행

```bash
# 방법 A: 로컬 직접 실행 (권장 - 빠른 개발)
make dev-be     # 터미널 1: FastAPI (포트 8000)
make dev-fe     # 터미널 2: Vite   (포트 8080) ← 브라우저로 이 포트 접속

# 방법 B: Docker로 실행 (운영과 동일한 환경)
make dev-docker
# 앱: http://localhost:8080
# DB: localhost:5432 (DBeaver 등으로 직접 접속 가능)
```

### 3) 인증 동작 (개발)

- `OIDC_ISSUER_URL` 이 비어있으면 **dev-login 모드** 자동 활성화
- 브라우저로 앱 접속 시 `/auth/dev-login` → JWT 발급 → 자동 로그인
- 발급된 계정: `dev_admin` / role: `admin` (관리자 기능 전체 접근 가능)
- **운영 서버에서는 `OIDC_ISSUER_URL` 이 설정되므로 dev-login 비활성화**

---

## 운영 배포 워크플로우

```
로컬 개발
   │
   ├─ git push origin main
   │
   ▼
GitHub Actions (docker-build.yml)
   ├─ main 브랜치 → sweatmoon/gantt-app:latest + :SHA
   └─ develop 브랜치 → sweatmoon/gantt-app:staging + :staging-SHA
   │
   ▼
Docker Hub (sweatmoon/gantt-app)
   │
   ▼
Watchtower (NAS, 5분 주기 폴링)
   ├─ 새 이미지 감지
   ├─ pull
   └─ gantt-app 컨테이너 자동 재시작 (~30초)
```

### NAS 수동 업데이트 (긴급 시)

```bash
# NAS에서 SSH 접속 후
docker pull sweatmoon/gantt-app:latest
docker compose -f /path/to/docker-compose.yml \
               -f /path/to/docker-compose.prod.yml \
               up -d app
```

---

## 환경변수 관리 규칙

| 파일 | 용도 | Git 커밋 |
|------|------|---------|
| `.env.example` | 템플릿 (빈 값 또는 예시) | ✅ 허용 |
| `project_design/.env` | 운영 실제 값 | ❌ 금지 |
| `app/backend/.env` | 백엔드 로컬 개발 값 | ❌ 금지 |

### 필수 환경변수 체크리스트 (운영)

```bash
# 아래 값이 모두 설정됐는지 확인
POSTGRES_PASSWORD=<안전한 비밀번호>
JWT_SECRET=<32자 이상 랜덤 문자열>
OIDC_ISSUER_URL=https://activo-no1.synology.me/webman/sso
OIDC_CLIENT_ID=<Synology SSO에서 발급>
OIDC_CLIENT_SECRET=<Synology SSO에서 발급>
OIDC_REDIRECT_URI=https://activo-no1.synology.me:8443/auth/callback
APP_URL=https://activo-no1.synology.me:8443
ADMIN_USERS=sweatmoon
```

---

## 브랜치 전략

```
main          ← 운영 (latest 이미지 빌드)
  │
  └── develop ← 스테이징 (staging 이미지 빌드)
        │
        └── feature/xxx  ← 기능 개발
```

| 브랜치 | 목적 | CI 동작 |
|--------|------|--------|
| `main` | 운영 배포 | `:latest` + `:SHA` 태그 빌드 & 푸시 |
| `develop` | 스테이징 검증 | `:staging` + `:staging-SHA` 태그 빌드 & 푸시 |
| `feature/*` | 기능 개발 | 빌드만 (푸시 없음) |

### 일반적인 개발 사이클

```bash
# 1. 기능 브랜치 생성
git checkout -b feature/my-feature

# 2. 개발 & 테스트
make dev

# 3. PR: feature → develop (스테이징 테스트)
git push origin feature/my-feature
# GitHub에서 PR 생성

# 4. 스테이징 확인 후 PR: develop → main (운영 배포)
# GitHub에서 PR 생성 및 머지
# → GitHub Actions 자동 빌드 → Docker Hub → Watchtower 자동 업데이트
```

---

## 자주 쓰는 명령

```bash
make help          # 전체 명령 목록 확인

make dev-be        # 백엔드만 시작
make dev-fe        # 프론트엔드만 시작

make db-shell      # DB 직접 접속
make db-backup     # 수동 백업

make lint          # 코드 린트 검사
make clean         # 빌드 결과물 정리
```

---

## 트러블슈팅

### "OIDC not configured" 오류

- **원인**: 운영 서버에서 OIDC 환경변수 미설정
- **해결**: `.env` 파일에 `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` 입력 후 재시작

### 컨테이너가 최신 이미지를 사용하지 않을 때

```bash
# 강제 pull
docker pull sweatmoon/gantt-app:latest
# 재시작
docker compose up -d --force-recreate app
```

### DB 연결 오류

```bash
# DB 상태 확인
docker exec gantt-db pg_isready -U gantt
# DB 로그 확인
docker logs gantt-db --tail 50
```

### 백업 파일 위치

```bash
# 백업 볼륨 경로 확인
docker volume inspect gantt-app_backup_data
# 백업 파일 목록
docker exec gantt-backup ls /backups/
```
