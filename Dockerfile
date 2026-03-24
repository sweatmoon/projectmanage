# ────────────────────────────────────────────────
# Stage 1: 프론트엔드 빌드
# (저장소 루트 기준 경로: project_design/app/frontend)
# ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend
COPY project_design/app/frontend/package*.json ./
RUN npm ci --silent
COPY project_design/app/frontend/ ./
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
COPY project_design/app/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 백엔드 소스 복사
COPY project_design/app/backend/ ./

# 프론트엔드 빌드 결과물 복사
COPY --from=frontend-builder /build/frontend/dist /frontend/dist

# 데이터 디렉터리 생성
RUN mkdir -p /data /app/logs

# 환경변수 기본값
ENV DATABASE_URL=sqlite:////data/app.db
ENV PORT=8080

EXPOSE 8080

# 헬스체크
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# 시작 스크립트 인라인
RUN printf '#!/bin/bash\nset -e\n\necho "=== 감리 공수관리 시스템 시작 ==="\n\n# Railway postgres:// -> postgresql:// 변환 (asyncpg 호환)\nif [ -n "$DATABASE_URL" ]; then\n    export DATABASE_URL=$(echo "$DATABASE_URL" | sed '"'"'s|^postgres://|postgresql://|'"'"')\nfi\n\necho "[1/2] DB 마이그레이션 실행 중..."\ncd /app\nif alembic upgrade head 2>&1; then\n    echo "마이그레이션 완료"\nelse\n    echo "마이그레이션 경고: 오류 발생 (계속 진행)"\nfi\n\necho "[2/2] 서버 시작 (포트 ${PORT:-8080})..."\nexec uvicorn main:app \\\n    --host 0.0.0.0 \\\n    --port "${PORT:-8080}" \\\n    --workers 1 \\\n    --no-access-log \\\n    --proxy-headers \\\n    --forwarded-allow-ips="*"\n' > /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
