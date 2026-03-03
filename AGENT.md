# ActiVo 일정관리 시스템 — AI 에이전트 시스템 프롬프트

> **이 파일을 커스텀 에이전트의 시스템 프롬프트로 등록하세요.**
> 매 대화 시작 시 에이전트는 이 문서를 참고하여 프로젝트 컨텍스트를 복원합니다.

---

## 1. 프로젝트 정체성

| 항목 | 값 |
|------|-----|
| 프로젝트명 | **ActiVo 일정관리 시스템** (악티보) |
| GitHub 저장소 | `https://github.com/sweatmoon/projectmanage` |
| 기본 브랜치 | `main` |
| AI 개발 브랜치 | `genspark_ai_developer` |
| 워킹 디렉터리 | `/home/user/webapp/project_design` |
| 현재 버전 | v2 (section_map 독립 저장 지원) |
| 배포 환경 | Docker + Synology NAS (DSM 역방향 프록시) |
| Docker 이미지 | `sweatmoon/gantt-app:latest` |

---

## 2. 기술 스택

### 백엔드
| 구성 요소 | 기술 |
|-----------|------|
| 프레임워크 | **FastAPI** (Python 3.11+) |
| ORM | **SQLAlchemy** (AsyncSession) |
| DB (운영) | **PostgreSQL 16** (asyncpg 드라이버) |
| DB (개발) | SQLite (sqlite+aiosqlite) |
| 마이그레이션 | **Alembic** |
| 인증 | OIDC (PKCE + JWT) — 환경변수 미설정 시 인증 우회 |
| 설정 | pydantic-settings (`core/config.py`) |
| 실행 | uvicorn |

### 프론트엔드
| 구성 요소 | 기술 |
|-----------|------|
| 프레임워크 | **React 18** + **TypeScript** |
| 빌드 도구 | **Vite** |
| UI 라이브러리 | Shadcn/ui + Tailwind CSS |
| 상태 관리 | React useState / useEffect |
| 라우팅 | React Router v6 |
| API 클라이언트 | `src/lib/client.ts` (axios 기반) |
| 빌드 출력 | `app/frontend/dist/` |

---

## 3. 디렉터리 구조

```
/home/user/webapp/project_design/
├── app/
│   ├── backend/
│   │   ├── main.py                   # FastAPI 앱 진입점 (포트 8000)
│   │   ├── core/
│   │   │   ├── auth.py               # OIDC/JWT 인증 로직
│   │   │   ├── config.py             # 환경변수 → Settings 클래스
│   │   │   └── database.py           # AsyncSession 설정
│   │   ├── models/                   # SQLAlchemy 모델
│   │   │   ├── projects.py           # Projects 테이블
│   │   │   ├── phases.py             # Phases 테이블
│   │   │   ├── staffing.py           # Staffing 테이블
│   │   │   ├── people.py             # People 테이블
│   │   │   ├── calendar_entries.py   # Calendar_entries 테이블
│   │   │   └── page_presence.py      # PagePresence 테이블 (동접 잠금)
│   │   ├── routers/                  # API 라우터 (자동 discovery)
│   │   │   ├── project_import.py     # 텍스트 일괄 단계 입력/내보내기
│   │   │   ├── projects.py           # CRUD /api/v1/projects
│   │   │   ├── phases.py             # CRUD /api/v1/phases
│   │   │   ├── staffing.py           # CRUD /api/v1/staffing
│   │   │   ├── people.py             # CRUD /api/v1/people
│   │   │   ├── calendar_entries.py   # 달력 엔트리
│   │   │   ├── presence.py           # 동접 heartbeat (Presence)
│   │   │   ├── home_stats.py         # 홈 대시보드 통계
│   │   │   ├── admin.py              # 관리자 허용 사용자 관리
│   │   │   └── ...                   # 기타 라우터
│   │   ├── services/
│   │   │   ├── database.py           # DB 초기화/종료
│   │   │   └── audit_service.py      # 감사 로그
│   │   └── middlewares/
│   │       └── auth_middleware.py    # JWT 검증 미들웨어
│   └── frontend/
│       ├── src/
│       │   ├── pages/
│       │   │   ├── Index.tsx         # 메인 페이지 (탭 라우팅, 프로젝트 생성)
│       │   │   ├── ProjectDetail.tsx # 프로젝트 상세 (단계/인력 관리)
│       │   │   ├── PersonDetail.tsx  # 인력 상세
│       │   │   ├── ScheduleTab.tsx   # 인력별/사업별 일정
│       │   │   ├── ReportTab.tsx     # 리포트
│       │   │   └── ...
│       │   └── components/
│       │       ├── ScheduleTab.tsx   # 일정 셀 컴포넌트 (핵심)
│       │       ├── PeopleTab.tsx     # 인력 목록
│       │       ├── ProjectTab.tsx    # 프로젝트 목록
│       │       ├── LandingPage.tsx   # 홈 대시보드
│       │       ├── PresenceBadges.tsx# 동접 배지 표시
│       │       ├── Header.tsx        # 상단 헤더
│       │       └── ReportTab.tsx     # 리포트 컴포넌트
│       └── dist/                     # 빌드 결과물 (백엔드가 정적 서빙)
├── docker-compose.yml                # 운영 Docker Compose
├── docker-compose.dev.yml            # 개발 오버라이드
└── manual/                           # 사용자 매뉴얼 (index.html, PDF)
```

---

## 4. 핵심 데이터 모델

### Projects
```python
id, project_name, organization, status('감리'|'제안'), deadline, notes, updated_at, deleted_at
```

### Phases
```python
id, project_id, phase_name, start_date, end_date, sort_order, deleted_at
```

### Staffing
```python
id, project_id, phase_id,
category,           # '단계감리팀' | '핵심기술' | '필수기술' | '보안진단' | '테스트'
field,              # 분야 (예: '사업관리 및 품질보증', '응용시스템', 'SW개발보안')
sub_field,          # 세부 분야
person_id,          # People.id FK (nullable)
person_name_text,   # 이름 텍스트
md,                 # Man-Days
deleted_at
```

### People
```python
id, person_name, position, team(레거시), grade('특급'|'고급'|'중급'|'초급'),
employment_status('재직'|'외부'|'퇴사'), deleted_at
```

### Calendar_entries
```python
id, staffing_id, date, status('A'=실제/'P'=계획), is_holiday
```

### PagePresence (동접 잠금)
```python
id, page_type('project'|'schedule'), page_id, user_id, user_name, mode('viewing'|'editing'), last_seen
```

---

## 5. 핵심 API 엔드포인트

### project_import 라우터 (`/api/v1/project_import`)
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/import_phases` | 텍스트 → 단계+인력 일괄 생성 |
| POST | `/overwrite_phases` | 텍스트로 기존 단계 전체 덮어쓰기 |
| GET | `/export/{project_id}` | 프로젝트 텍스트 내보내기 + section_map 반환 |

#### 텍스트 형식 (감리 모드)
```
단계명, YYYYMMDD, YYYYMMDD, 이름:분야[:MD일수], 이름:분야[:MD일수], ...
예) 1단계, 20250301, 20250331, 이현우:사업관리 및 품질보증, 강진욱:SW개발보안:4
```

#### 텍스트 형식 (제안 모드 — 감리원 일정)
```
단계명, YYYYMMDD, YYYYMMDD, 이름, 이름, ...
```
- 전문가(핵심/필수/보안/테스트)는 별도 섹션 입력 후 `section_map`으로 category 매핑

#### section_map 구조
```json
{
  "이현우": "단계감리팀",
  "강진욱": "핵심기술",
  "홍길동": "필수기술"
}
```

---

## 6. 프론트엔드 핵심 로직

### Index.tsx — 프로젝트 생성 다이얼로그
- `proposalSections` 상태: `[{label, value}, ...]` (감리원·핵심기술·필수기술·보안진단·테스트)
- `buildProposalPhaseData()`: 섹션 텍스트 파싱 → `{text, sectionMap}` 반환
  - **중요**: 일정 텍스트에 없는 인원도 `nameInfo`에서 sectionMap에 추가 (v2 버그 수정 완료)
- `handleCreateProject()`: 프로젝트 생성 → import_phases API 호출

### ProjectDetail.tsx — 텍스트 편집 다이얼로그
- `handleOpenTextEdit()`: GET export → section_map 포함 파싱
- `handleTextEditSave()`: buildProposalPhaseData → overwrite_phases POST
- `parseTextToProposalForm()`: 텍스트 → 섹션별 분류 (categoryMap 필수)
  - **중요**: categoryMap 없을 때 `defaultFieldToSection`으로 폴백, 매핑 없으면 `'감리원'`으로 기본값

### ScheduleTab (components)
- 셀 색상:
  - 파랑(bg-blue-50): 선택된 셀 / 활성 상태
  - 초록(bg-green-50): 실제 근무일(A)
  - 노랑(bg-amber-50): 미확정(P)
  - 회색(bg-slate-100): 비근무일(휴일/주말)
- `TEAM_FIELD_ORDER`: 분야명 패턴으로 팀 분류
  - 사업관리, 응용시스템, 데이터베이스, 시스템구조 → `단계감리팀`
  - 기타 → `전문가팀`
- Presence(동접) 잠금: 60초 heartbeat, 편집 중이면 다른 사용자 잠금

---

## 7. 환경변수

### 필수 (운영)
```bash
DATABASE_URL=postgresql+asyncpg://gantt:PASSWORD@db:5432/ganttdb
JWT_SECRET=랜덤32자이상문자열
OIDC_ISSUER_URL=https://your-oidc-provider
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret
OIDC_REDIRECT_URI=https://your-domain/auth/callback
APP_URL=https://your-domain
ADMIN_USERS=admin@example.com,user@example.com
```

### 선택
```bash
PORT=8080
JWT_EXPIRE_HOURS=8
ENVIRONMENT=production   # 또는 dev (dev일 때 에러 상세 노출)
LOG_LEVEL=INFO
BACKUP_KEEP_DAYS=30
```

### 인증 우회 (개발/테스트)
`OIDC_ISSUER_URL`을 설정하지 않으면 인증 미들웨어가 비활성화됩니다.

---

## 8. 개발 실행 방법

### 백엔드 로컬 실행
```bash
cd /home/user/webapp/project_design/app/backend
pip install -r requirements.txt
python main.py  # 포트 8000
```

### 프론트엔드 로컬 실행
```bash
cd /home/user/webapp/project_design/app/frontend
npm install
npm run dev  # 포트 5173
```

### 프론트엔드 빌드
```bash
cd /home/user/webapp/project_design/app/frontend
npm run build  # 출력: dist/ (백엔드가 정적 서빙)
```

### Docker Compose 실행
```bash
cd /home/user/webapp/project_design
docker compose up -d  # 운영 모드
docker compose -f docker-compose.yml -f docker-compose.dev.yml up  # 개발 모드
```

---

## 9. Git 워크플로우 (필수 준수)

### 브랜치 전략
- `main`: 운영 배포 브랜치
- `genspark_ai_developer`: AI 개발 브랜치 (PR 대상: main)

### 커밋 규칙 (Conventional Commits)
```
feat(scope): 새 기능 추가
fix(scope): 버그 수정
refactor(scope): 리팩터링
docs(scope): 문서 변경
style(scope): 포매팅 변경
test(scope): 테스트 추가
chore(scope): 빌드/설정 변경
```

### 의무 워크플로우 (코드 변경 시 반드시 준수)
```bash
# 1. 코드 변경 후 즉시 커밋
git add .
git commit -m "type(scope): description"

# 2. 원격 최신화 동기화
git fetch origin main
git rebase origin/main  # 충돌 시 원격 코드 우선

# 3. 커밋 스쿼시 (N개 커밋을 1개로)
git reset --soft HEAD~N
git commit -m "comprehensive: all changes description"

# 4. 강제 푸시 (리베이스 후)
git push -f origin genspark_ai_developer

# 5. PR 생성/업데이트 후 링크 사용자에게 제공
```

---

## 10. 구현된 기능 목록 (현재 버전)

| 기능 | 상태 | 비고 |
|------|------|------|
| 프로젝트 CRUD | ✅ | 감리/제안 모드 |
| 단계 CRUD | ✅ | sort_order 관리 |
| 인력 CRUD | ✅ | 직급/등급/구분 |
| 텍스트 일괄 입력 (감리) | ✅ | 쉼표 구분 형식 |
| 텍스트 일괄 입력 (제안) | ✅ | 섹션별 분리 입력 |
| section_map 독립 저장 | ✅ | v2 (일정 미기재 인원 포함) |
| 텍스트 편집 (overwrite) | ✅ | export→편집→overwrite |
| 인력별 일정 | ✅ | 월별 셀 뷰 |
| 사업별 일정 | ✅ | 주간 업무 일정 |
| 동접 잠금 (Presence) | ✅ | 60초 heartbeat, polling |
| 셀 상태 (A/P) | ✅ | 실제/계획 구분 |
| 휴일 처리 | ✅ | 공휴일 DB 기반 |
| 리포트 | ✅ | |
| OIDC SSO 인증 | ✅ | PKCE 지원 |
| 관리자 허용 사용자 관리 | ✅ | |
| 홈 대시보드 통계 | ✅ | |
| 와이드 모드 토글 | ✅ | localStorage 저장 |
| 탭 URL 유지 (?tab=xxx) | ✅ | 새로고침 후 탭 복원 |
| DB 자동 백업 | ✅ | 30일 보관 |
| NAS 역방향 프록시 | ✅ | X-Forwarded-Proto |
| WebSocket | ❌ | 롤백됨, polling으로 대체 |

---

## 11. 알려진 이슈 / 주의사항

### 이슈 #1 — section_map 누락 (v2 수정 완료)
- **증상**: 전문가(핵심/필수/보안) 인원이 핵심기술 칸으로 이동
- **원인**: `buildProposalPhaseData()`가 일정 텍스트 파싱 중에만 sectionMap 채움
- **수정**: 커밋 `e974711` — 일정에 미기재된 인원도 `nameInfo`에서 sectionMap에 포함
- **파일**: `Index.tsx`, `ProjectDetail.tsx`

### 이슈 #2 — parseTextToProposalForm 폴백
- `categoryMap` 없을 때 `defaultFieldToSection`에 없는 분야 → 기본값 `'감리원'`으로 설정
- 해결책: 텍스트 편집 시 항상 export API의 `section_map`을 `categoryMap`으로 전달

### 주의 — 빌드 필수
- 프론트엔드 코드 수정 후 반드시 `npm run build` 실행
- 빌드 결과물이 `dist/`에 없으면 백엔드가 API 응답만 반환

---

## 12. 에이전트 행동 지침

### 코드 수정 시
1. 항상 `/home/user/webapp/project_design` 기준으로 파일 경로 참조
2. 백엔드 변경 후 → `uvicorn` 재시작 불필요 (핫리로드) 또는 서버 재시작
3. 프론트엔드 변경 후 → `npm run build` 실행 필수
4. TypeScript 타입 오류 없이 빌드 통과 확인

### 디버깅 시
- 백엔드 로그: `/home/user/webapp/project_design/app/backend/logs/`
- 프론트엔드: 브라우저 콘솔 또는 `PlaywrightConsoleCapture` 도구 활용
- API 테스트: `curl http://localhost:8000/health`

### 새 기능 추가 시
1. 백엔드: `routers/` 에 새 파일 생성 → 자동 discovery (router 변수명 필수)
2. 프론트엔드: 기존 컴포넌트 패턴 준수 (shadcn/ui 컴포넌트 우선)
3. DB 스키마 변경: Alembic migration 생성 (`alembic revision --autogenerate`)

### 사용자 응답 언어
- 기본: **한국어**
- 코드/명령어: 영어 그대로
- 에러 메시지 설명: 한국어

---

## 13. 자주 사용하는 명령어 모음

```bash
# 현재 코드 상태 확인
cd /home/user/webapp/project_design && git log --oneline -5

# 백엔드 실행
cd /home/user/webapp/project_design/app/backend && python main.py

# 프론트엔드 빌드
cd /home/user/webapp/project_design/app/frontend && npm run build

# 전체 Docker 재시작
cd /home/user/webapp/project_design && docker compose restart app

# DB 마이그레이션
cd /home/user/webapp/project_design/app/backend && alembic upgrade head

# 의존성 설치
cd /home/user/webapp/project_design/app/backend && pip install -r requirements.txt
cd /home/user/webapp/project_design/app/frontend && npm install
```

---

*이 파일은 `/home/user/webapp/AGENT.md` 에 저장됩니다.*
*마지막 업데이트: 2026-03-03*
