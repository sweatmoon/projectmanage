# ============================================================
# Makefile  ─  개발/운영 명령 표준화
# ============================================================
# 사용법: make <target>
# 예시:
#   make dev          # 백엔드 + 프론트엔드 개발 서버 동시 시작
#   make build        # 프로덕션 이미지 로컬 빌드
#   make prod-up      # NAS 운영 스택 시작
# ============================================================

.PHONY: help dev dev-be dev-fe build \
        dev-docker dev-docker-down \
        prod-up prod-down prod-logs prod-pull \
        db-shell db-backup db-restore \
        lint test clean

BACKEND_DIR  := project_design/app/backend
FRONTEND_DIR := project_design/app/frontend
COMPOSE_BASE := docker compose -f project_design/docker-compose.yml
COMPOSE_DEV  := $(COMPOSE_BASE) -f project_design/docker-compose.dev.yml
COMPOSE_PROD := $(COMPOSE_BASE) -f project_design/docker-compose.prod.yml

# ── 기본: 도움말 ─────────────────────────────────────────────
help:
	@echo ""
	@echo "  감리 공수관리 시스템 - 개발/운영 명령"
	@echo "  ======================================="
	@echo ""
	@echo "  📦 개발 (로컬 PC)"
	@echo "    make dev            백엔드 + 프론트 동시 시작 (tmux 필요)"
	@echo "    make dev-be         FastAPI 백엔드만 시작 (포트 8000)"
	@echo "    make dev-fe         Vite 프론트엔드만 시작 (포트 8080)"
	@echo "    make dev-docker     Docker Compose 개발 스택 시작"
	@echo "    make dev-docker-down  개발 Docker 스택 종료"
	@echo ""
	@echo "  🐳 빌드"
	@echo "    make build          프로덕션 Docker 이미지 로컬 빌드"
	@echo "    make build-nc       캐시 없이 빌드 (clean build)"
	@echo ""
	@echo "  🚀 운영 (NAS)"
	@echo "    make prod-up        운영 스택 시작"
	@echo "    make prod-down      운영 스택 종료"
	@echo "    make prod-logs      운영 로그 실시간 확인"
	@echo "    make prod-pull      최신 이미지 pull 후 재시작"
	@echo ""
	@echo "  🗄️  DB"
	@echo "    make db-shell       PostgreSQL 쉘 접속"
	@echo "    make db-backup      수동 DB 백업"
	@echo "    make db-restore FILE=backup.sql.gz  백업 복원"
	@echo ""
	@echo "  🧹 기타"
	@echo "    make lint           프론트엔드 린트 검사"
	@echo "    make clean          빌드 결과물 정리"
	@echo ""

# ── 개발: 백엔드 + 프론트 동시 실행 ────────────────────────
dev:
	@echo "🚀 개발 서버 시작 (백엔드:8000, 프론트:8080)"
	@if command -v tmux >/dev/null 2>&1; then \
		tmux new-session -d -s gantt-dev -x 220 -y 50 2>/dev/null || true; \
		tmux send-keys -t gantt-dev "make dev-be" Enter; \
		tmux split-window -h -t gantt-dev; \
		tmux send-keys -t gantt-dev "make dev-fe" Enter; \
		tmux attach-session -t gantt-dev; \
	else \
		echo "tmux 없음: 터미널 2개를 열어 각각 실행하세요"; \
		echo "  터미널1: make dev-be"; \
		echo "  터미널2: make dev-fe"; \
	fi

dev-be:
	@echo "🐍 FastAPI 백엔드 시작 (http://localhost:8000)"
	@cd $(BACKEND_DIR) && \
		test -f .env || (echo "⚠️  .env 없음: project_design/.env.example 복사 후 편집하세요" && cp ../../.env.example .env) && \
		python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

dev-fe:
	@echo "⚡ Vite 프론트엔드 시작 (http://localhost:8080)"
	@cd $(FRONTEND_DIR) && \
		test -d node_modules || npm install && \
		npm run dev

# ── Docker 개발 스택 ─────────────────────────────────────────
dev-docker:
	@echo "🐳 Docker 개발 스택 시작"
	@test -f project_design/.env || (echo "⚠️  .env 파일 생성 중..." && cp project_design/.env.example project_design/.env)
	@cd project_design && $(COMPOSE_DEV) up --build -d
	@echo "✅ 앱: http://localhost:8080  DB: localhost:5432"

dev-docker-down:
	@cd project_design && $(COMPOSE_DEV) down

# ── 프로덕션 빌드 ───────────────────────────────────────────
build:
	@echo "🏗️  프로덕션 이미지 빌드 중..."
	@docker build -t sweatmoon/gantt-app:local ./project_design
	@echo "✅ 빌드 완료: sweatmoon/gantt-app:local"

build-nc:
	@echo "🏗️  캐시 없이 빌드 중..."
	@docker build --no-cache -t sweatmoon/gantt-app:local ./project_design

# ── 운영 스택 ────────────────────────────────────────────────
prod-up:
	@echo "🚀 운영 스택 시작"
	@test -f project_design/.env || (echo "❌ .env 파일이 없습니다!" && exit 1)
	@cd project_design && $(COMPOSE_PROD) up -d
	@echo "✅ 운영 스택 시작됨"

prod-down:
	@cd project_design && $(COMPOSE_PROD) down

prod-logs:
	@cd project_design && $(COMPOSE_PROD) logs -f --tail=100

prod-pull:
	@echo "📥 최신 이미지 pull 후 재시작"
	@cd project_design && docker compose pull app && $(COMPOSE_PROD) up -d app

# ── DB 관리 ──────────────────────────────────────────────────
db-shell:
	@docker exec -it gantt-db psql -U gantt -d ganttdb

db-backup:
	@echo "💾 수동 DB 백업 실행..."
	@docker exec gantt-db pg_dump -U gantt -d ganttdb | \
		gzip > project_design/backups/manual_$(shell date +%Y%m%d_%H%M%S).sql.gz
	@echo "✅ 백업 완료"

db-restore:
	@test -n "$(FILE)" || (echo "❌ 사용법: make db-restore FILE=backup.sql.gz" && exit 1)
	@echo "⚠️  DB 복원: $(FILE) → ganttdb"
	@read -p "계속하시겠습니까? (y/N): " confirm && [ "$$confirm" = "y" ]
	@gunzip -c $(FILE) | docker exec -i gantt-db psql -U gantt -d ganttdb
	@echo "✅ 복원 완료"

# ── 기타 ────────────────────────────────────────────────────
lint:
	@cd $(FRONTEND_DIR) && npm run lint

clean:
	@rm -rf $(FRONTEND_DIR)/dist
	@find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
	@find . -name "*.pyc" -delete 2>/dev/null || true
	@echo "✅ 정리 완료"
