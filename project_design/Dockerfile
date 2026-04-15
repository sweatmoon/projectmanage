# ────────────────────────────────────────────────
# Stage 1: 프론트엔드 빌드
# cache-bust: 2026-04-15T13:30
# ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend
COPY app/frontend/package*.json ./
RUN npm ci --silent
COPY app/frontend/ ./
RUN npm run build

# ────────────────────────────────────────────────
# Stage 2: 백엔드 + 빌드된 프론트엔드
# ────────────────────────────────────────────────
FROM python:3.11-slim

# 시스템 패키지
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 의존성 설치
COPY app/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 백엔드 소스 복사
COPY app/backend/ ./

# 프론트엔드 빌드 결과물 복사
# main.py: Path(__file__).parent.parent / "frontend" / "dist"
# = /app(backend).parent(=/app_root) / frontend/dist → /app_root/frontend/dist
COPY --from=frontend-builder /build/frontend/dist /frontend/dist

# 데이터 디렉터리 생성 (SQLite DB 저장용 / PostgreSQL 미설정 시 폴백)
RUN mkdir -p /data /app/logs

# PORT만 기본값 설정 (DATABASE_URL은 Railway 환경변수로 주입)
ENV PORT=8080

EXPOSE 8080

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# 시작 스크립트 (인라인 — COPY 경로 문제 우회)
RUN printf '#!/bin/bash\nset -e\n\necho "=== 감리 공수관리 시스템 시작 ==="\n\n# ── DATABASE_URL 정규화 ──────────────────────────────\n# Railway는 postgres:// 또는 postgresql:// 형태로 주입함\n# asyncpg는 postgresql+asyncpg:// 형태 필요\nif [ -n "$DATABASE_URL" ]; then\n  # Step1: postgres:// → postgresql://\n  DATABASE_URL=$(echo "$DATABASE_URL" | sed "s|^postgres://|postgresql://|")\n  # Step2: postgresql:// → postgresql+asyncpg:// (이미 +asyncpg 없을 때만)\n  case "$DATABASE_URL" in\n    postgresql+asyncpg://*) ;; # 이미 올바른 형태\n    postgresql://*) DATABASE_URL=$(echo "$DATABASE_URL" | sed "s|^postgresql://|postgresql+asyncpg://|") ;;\n  esac\n  # Step3: ?sslmode=require 등 쿼리 파라미터 제거 (connect_args ssl=False와 충돌)\n  DATABASE_URL=$(echo "$DATABASE_URL" | sed "s|?.*||")\n  export DATABASE_URL\n  echo "[INFO] DATABASE_URL 정규화 완료: $(echo $DATABASE_URL | sed s/:.*@/:***@/)"\nelse\n  export DATABASE_URL="sqlite+aiosqlite:////data/app.db"\n  echo "[경고] DATABASE_URL 미설정 → SQLite 폴백: $DATABASE_URL"\nfi\n\necho "[1/2] DB 마이그레이션 실행 중..."\ncd /app\n# 마이그레이션 실패 시 서버 시작 중단 (오류 은닉 제거)\nalembic upgrade head\n\necho "[2/2] 서버 시작 (포트 ${PORT:-8080})..."\nexec uvicorn main:app \\\n    --host 0.0.0.0 \\\n    --port "${PORT:-8080}" \\\n    --workers 1 \\\n    --log-level info \\\n    --proxy-headers \\\n    --forwarded-allow-ips="*"\n' > /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
