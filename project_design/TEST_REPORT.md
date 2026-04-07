# 소프트웨어 테스트 종합 보고서

> **프로젝트**: 정보시스템 감리 관리 시스템 (ProjectManage)  
> **테스트 일시**: 2026-04-07  
> **테스트 환경**: 스테이징 서버 (`https://projectmanage-production-13e7.up.railway.app`)  
> **테스트 수행자**: Genspark AI Developer  
> **테스트 유형**: 단위(Unit) + 통합(Integration) + 기능(Functional/E2E)  
> **보고서 버전**: v2.0 (보안 개선사항 반영)

---

## 1. 테스트 요약

| 테스트 유형 | 총 케이스 | PASS | FAIL | 통과율 |
|------------|---------|------|------|--------|
| **단위 테스트 (Unit)** | 29 | **29** | 0 | **100%** |
| **통합 테스트 (Integration)** | 40 | **40** | 0 | **100%** |
| **기능 테스트 (Functional/E2E)** | 51 | **50** | 0 (WARN 1) | **98%** |
| **합계** | **120** | **119** | **0** | **99.2%** |

> ⚠️ WARN 1건: FT-09-03 XSS 입력 → 백엔드 sanitize 적용 완료, 프런트엔드 이스케이프 별도 확인 권장

---

## 2. 단위 테스트 (Unit Tests) 결과

**실행 환경**: 인메모리 SQLite (aiosqlite), FastAPI TestClient  
**테스트 파일**: `tests/unit/test_services.py`

### 2.1 테스트 케이스 목록 (29개 전체 통과)

#### UT-01: 프로젝트 서비스
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-01-01 | 프로젝트 생성 (필수 필드) | ✅ PASS |
| UT-01-02 | 프로젝트 조회 by ID | ✅ PASS |
| UT-01-03 | 프로젝트 수정 (status 변경) | ✅ PASS |
| UT-01-04 | 프로젝트 소프트 삭제 (deleted_at 설정) | ✅ PASS |
| UT-01-05 | 삭제된 프로젝트 조회 → None 반환 | ✅ PASS |
| UT-01-06 | 프로젝트 목록 페이지네이션 | ✅ PASS |
| UT-01-07 | is_won 기본값 False 확인 | ✅ PASS |
| UT-01-08 | is_won True 저장 확인 | ✅ PASS |

#### UT-02: 인력 서비스
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-02-01 | 인력 생성 | ✅ PASS |
| UT-02-02 | 인력 소프트 삭제 | ✅ PASS |
| UT-02-03 | 인력 목록 페이지네이션 | ✅ PASS |

#### UT-03: 단계 서비스
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-03-01 | 단계 생성 (날짜 포함) | ✅ PASS |
| UT-03-02 | 단계 날짜 범위 저장 | ✅ PASS |
| UT-03-03 | project_id별 단계 목록 조회 | ✅ PASS |

#### UT-04: 스태핑 서비스
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-04-01 | 스태핑 생성 | ✅ PASS |
| UT-04-02 | 스태핑 소프트 삭제 | ✅ PASS |
| UT-04-03 | MD 업데이트 | ✅ PASS |

#### UT-05: 감사 로그 서비스
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-05-01 | CREATE 이벤트 감사 로그 작성 | ✅ PASS |
| UT-05-02 | UPDATE diff 필드 감사 로그 작성 | ✅ PASS |
| UT-05-03 | 감사 로그 불변성 (DELETE API 없음) | ✅ PASS |

#### UT-06: JWT 인증
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-06-01 | 토큰 생성 및 디코딩 | ✅ PASS |
| UT-06-02 | 만료 토큰 예외 발생 | ✅ PASS |
| UT-06-03 | 위조 시크릿 예외 발생 | ✅ PASS |
| UT-06-04 | 역할(role) 토큰 포함 확인 | ✅ PASS |

#### UT-07: 보안 헤더
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-07-01 | 7종 보안 헤더 존재 확인 | ✅ PASS |
| UT-07-02 | CSP 헤더 'self' 포함 확인 | ✅ PASS |

#### UT-08: Pydantic 유효성 검사
| ID | 테스트명 | 결과 |
|----|---------|------|
| UT-08-01 | 프로젝트 필수 필드 누락 ValidationError | ✅ PASS |
| UT-08-02 | is_won 기본값 False | ✅ PASS |
| UT-08-03 | 단계 데이터 유효성 검사 | ✅ PASS |
| UT-08-04 | 스태핑 필수 필드 확인 | ✅ PASS |

---

## 3. 통합 테스트 (Integration Tests) 결과

**실행 환경**: 인메모리 SQLite + FastAPI ASGI TestClient (httpx)  
**테스트 파일**: `tests/integration/test_api.py`  
**핵심 수정 이력**: IT-08-02 감사 로그 업데이트 테스트 수정  
  - 원인: `status` 변경 → `STATUS_CHANGE` 이벤트 (비즈니스 규칙)  
  - 수정: `notes` 필드 변경 → `UPDATE` 이벤트, 별도 `STATUS_CHANGE` 테스트 추가

### 3.1 테스트 케이스 목록 (40개 전체 통과)

#### IT-01: 헬스체크 & 설정 API
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-01-01 | GET /health → 200 OK, status=healthy | ✅ PASS |
| IT-01-02 | GET /api/config → API_BASE_URL 포함 | ✅ PASS |

#### IT-02: 인증 미들웨어
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-02-01 | 토큰 없이 API 접근 → 200/401 (환경 의존) | ✅ PASS |
| IT-02-02 | /health 항상 공개 | ✅ PASS |
| IT-02-03 | GOOGLE_CLIENT_ID 설정 시 dev-login 403 | ✅ PASS |

#### IT-03: 프로젝트 API CRUD
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-03-01 | POST 사업 생성 → 201 | ✅ PASS |
| IT-03-02 | 필수 필드 누락 → 422 | ✅ PASS |
| IT-03-03 | GET by ID → 200 | ✅ PASS |
| IT-03-04 | 없는 ID 조회 → 404 | ✅ PASS |
| IT-03-05 | PUT 수정 → 200 | ✅ PASS |
| IT-03-06 | DELETE 소프트 삭제 → 200/204 | ✅ PASS |
| IT-03-07 | 삭제 후 목록 미노출 | ✅ PASS |
| IT-03-08 | 목록 페이지네이션 | ✅ PASS |
| IT-03-09 | is_won 필드 저장 | ✅ PASS |

#### IT-04: 인력 API CRUD
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-04-01 | 인력 생성 → 201 | ✅ PASS |
| IT-04-02 | 인력 조회 by ID | ✅ PASS |
| IT-04-03 | 인력 소프트 삭제 | ✅ PASS |

#### IT-05: 단계 API CRUD
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-05-01 | 단계 생성 → 201 | ✅ PASS |
| IT-05-02 | project_id 기준 목록 조회 | ✅ PASS |
| IT-05-03 | 단계 소프트 삭제 | ✅ PASS |

#### IT-06: 스태핑 API + FK 무결성
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-06-01 | 스태핑 생성 → 201 | ✅ PASS |
| IT-06-02 | 없는 project_id → 404 | ✅ PASS |
| IT-06-03 | 없는 phase_id → 404 | ✅ PASS |
| IT-06-04 | MD 업데이트 → 200 | ✅ PASS |

#### IT-07: 관리자 API 권한 분리
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-07-01 | 개발 환경 관리자 API 접근 200 | ✅ PASS |
| IT-07-02 | 감사 로그 조회 200 | ✅ PASS |
| IT-07-03 | 감사 로그 DELETE 차단 405 | ✅ PASS |
| IT-07-04 | 감사 로그 PUT 차단 405 | ✅ PASS |

#### IT-08: 감사 로그 연동 검증
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-08-01 | 프로젝트 생성 → CREATE 이벤트 기록 | ✅ PASS |
| IT-08-02 | 필드 수정 → UPDATE 이벤트 기록 | ✅ PASS |
| IT-08-02b | 상태 변경 → STATUS_CHANGE 이벤트 기록 | ✅ PASS |
| IT-08-03 | 프로젝트 삭제 → DELETE 이벤트 기록 | ✅ PASS |

#### IT-09: 홈 통계 API
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-09-01 | 통계 응답 구조 확인 (8개 필드) | ✅ PASS |
| IT-09-02 | 가동률 0.0~1.0 범위 | ✅ PASS |
| IT-09-03 | 진행중 사업 수 음수 아님 | ✅ PASS |
| IT-09-04 | 제안 추가 시 proposal_count 증가 | ✅ PASS |

#### IT-10: 페이징 & 쿼리 파라미터
| ID | 테스트명 | 결과 |
|----|---------|------|
| IT-10-01 | limit 최대 2000 초과 → 422 | ✅ PASS |
| IT-10-02 | skip 음수 → 422 | ✅ PASS |
| IT-10-03 | status 필터 쿼리 정확성 | ✅ PASS |
| IT-10-04 | total 카운트 일관성 | ✅ PASS |

---

## 4. 기능 테스트 (Functional/E2E Tests) 결과

**실행 환경**: 스테이징 서버 (`https://projectmanage-production-13e7.up.railway.app`)  
**테스트 스크립트**: `test_functional_staging.py`  
**결과**: PASS 50건 / WARN 1건 / FAIL 0건 (통과율 98%)

### 4.1 테스트 케이스 목록

#### FT-01: 사업 전체 라이프사이클 (7건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-01-01 | 사업 생성 (201) | ✅ PASS | ID 정상 발급 |
| FT-01-02 | 단계 3개 생성 | ✅ PASS | 착수/수행/종료 순서 생성 |
| FT-01-03 | 스태핑 2명 등록 | ✅ PASS | 수석감리원/감리원 |
| FT-01-04 | 사업 수주 상태 변경 (is_won=True) | ✅ PASS | status=확정, is_won=True |
| FT-01-05 | 단계 필터 조회 | ✅ PASS | total=3 정상 |
| FT-01-06 | 스태핑 MD 업데이트 | ✅ PASS | md=35 정상 저장 |
| FT-01-07 | 삭제 후 404 확인 | ✅ PASS | 소프트 삭제 정상 |

#### FT-02: 인증/인가 시나리오 (9건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-02-01 | 미인증 요청 401 차단 | ✅ PASS | auth_required=True |
| FT-02-02 | 만료 토큰 401 차단 | ✅ PASS | |
| FT-02-03 | 위조 토큰 401 차단 | ✅ PASS | |
| FT-02-04 | Viewer 쓰기 403 차단 | ✅ PASS | |
| FT-02-05 | Viewer 읽기 200 허용 | ✅ PASS | |
| FT-02-06 | User 관리자 API 403 차단 | ✅ PASS | |
| FT-02-07 | Viewer 관리자 API 403 차단 | ✅ PASS | |
| FT-02-08 | dev-login 프로덕션 비활성화 | ✅ PASS | 403 정상 |
| FT-02-09 | Admin 관리자 API 200 접근 | ✅ PASS | 3명 정상 조회 |

#### FT-03: 감사 로그 추적 (5건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-03-01 | 사업 생성 → CREATE 감사 로그 증가 | ✅ PASS | 253 → 254 |
| FT-03-02 | 상태 변경 → STATUS_CHANGE 증가 | ✅ PASS | 72 → 73 |
| FT-03-03 | 감사 로그 불변성 (DELETE/PUT → 405) | ✅ PASS | |
| FT-03-04 | 감사 로그 CSV 내보내기 | ✅ PASS | rows=10 |
| FT-03-05 | 감사 로그 아카이빙 API | ✅ PASS | archived=0 (정상) |

#### FT-04: 홈 통계 연동 (4건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-04-01 | 홈 통계 응답 필드 완전성 (8개) | ✅ PASS | all fields present |
| FT-04-02 | 가동률 범위 (0.0 ~ 1.0) | ✅ PASS | 13.18% |
| FT-04-03 | 업무일수 양수 | ✅ PASS | 64일 |
| FT-04-04 | 제안 추가 시 proposal_count 증가 | ✅ PASS | 1 → 2 |

#### FT-05: 동시 처리 안정성 (2건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-05-01 | 동시 10요청 읽기 안정성 | ✅ PASS | 10/10 성공, 359ms |
| FT-05-02 | 동시 5건 생성, ID 중복 없음 | ✅ PASS | 고유 ID 5개 |

#### FT-06: 보안 헤더 검증 (2건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-06-01 | 7종 보안 헤더 모두 존재 | ✅ PASS | 7/7 모두 정상 |
| FT-06-02 | 악성 Origin CORS 차단 | ✅ PASS | ACAO='' |

**확인된 보안 헤더 목록:**
```
x-frame-options: SAMEORIGIN
x-content-type-options: nosniff
strict-transport-security: max-age=31536000; includeSubDomains
referrer-policy: strict-origin-when-cross-origin
x-xss-protection: 1; mode=block
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'...
permissions-policy: geolocation=(), microphone=(), camera=()
```

#### FT-07: 에러 처리 시나리오 (7건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-07-01 | 없는 ID 조회 → 404 | ✅ PASS | |
| FT-07-02 | 잘못된 경로 파라미터 → 422 | ✅ PASS | |
| FT-07-03 | 필수 필드 누락 → 422 | ✅ PASS | |
| FT-07-04 | 에러 응답에 스택 트레이스 미노출 | ✅ PASS | 안전한 에러 응답 |
| FT-07-05 | FK 무결성: 없는 project_id → 404 | ✅ PASS | `project_id 999999를 찾을 수 없습니다.` |
| FT-07-06 | limit 초과(9999) → 422 | ✅ PASS | |
| FT-07-07 | skip 음수(-1) → 422 | ✅ PASS | |

#### FT-08: 성능 기준 (8건 모두 통과)
| ID | 엔드포인트 | 결과 | 응답시간 | 기준 |
|----|-----------|------|---------|------|
| FT-08 | 헬스체크 | ✅ PASS | **107ms** | < 3,000ms |
| FT-08 | 프로젝트 목록 | ✅ PASS | **145ms** | < 3,000ms |
| FT-08 | 인력 목록 | ✅ PASS | **161ms** | < 3,000ms |
| FT-08 | 단계 목록 | ✅ PASS | **171ms** | < 3,000ms |
| FT-08 | 스태핑 목록 | ✅ PASS | **146ms** | < 3,000ms |
| FT-08 | 홈 통계 | ✅ PASS | **144ms** | < 3,000ms |
| FT-08 | 관리자 통계 | ✅ PASS | **166ms** | < 3,000ms |
| FT-08 | 감사 로그 50건 | ✅ PASS | **280ms** | < 3,000ms |

> 모든 응답시간이 기준(3,000ms) 대비 **10% 이내** 수준

#### FT-09: 데이터 일관성 (4건 중 3 PASS, 1 WARN)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-09-01 | 삭제된 항목 목록 미노출 | ✅ PASS | 소프트 삭제 정상 |
| FT-09-02 | 페이지 아이템 수 ≤ total | ✅ PASS | items=5, total=15 |
| FT-09-03 | XSS 입력 저장 | ⚠️ WARN | 백엔드 sanitize 적용 완료, 프런트 이스케이프 별도 확인 권장 |
| FT-09-04 | SQL 인젝션 차단 (ORM 파라미터화) | ✅ PASS | DB 무결성 유지 |

#### FT-10: 배치 API 시나리오 (3건 모두 통과)
| ID | 테스트명 | 결과 | 세부 내용 |
|----|---------|------|---------|
| FT-10-01 | 배치 프로젝트 3건 생성 | ✅ PASS | 정상 생성 |
| FT-10-02 | 배치 상태 업데이트 | ✅ PASS | 모두 확정 |
| FT-10-03 | 배치 프로젝트 삭제 | ✅ PASS | status=200 |

---

## 5. 발견된 이슈 및 조치

### 5.1 수정 완료 이슈

| 이슈 | 유형 | 원인 | 조치 |
|------|------|------|------|
| IT-08-02 테스트 실패 | 테스트 로직 오류 | `status` 변경 시 `STATUS_CHANGE` 이벤트 기록 (비즈니스 규칙) | 테스트 로직 수정: `notes` 변경 → `UPDATE`, 별도 `STATUS_CHANGE` 테스트 추가 |

### 5.2 보안 개선사항 적용 완료 (v2.0)

감리 보고서에서 지적된 3가지 권고사항이 **모두 적용 완료**되었습니다.

#### 개선 1: CORS 허용 도메인 명시적 제한 ✅ 완료
- **이전**: `allow_origin_regex=".*"` (모든 도메인 허용)
- **이후**: 명시적 허용 목록 (`localhost:5173`, `localhost:3000`, APP_URL)
- **환경변수 확장**: `ALLOWED_ORIGINS` 환경변수로 추가 도메인 지정 가능
- **파일**: `app/backend/main.py`

```python
# CORS 허용 출처 - 명시적 허용 목록으로 변경
_CORS_ORIGINS = _build_cors_origins()  # localhost + APP_URL + ALLOWED_ORIGINS
app.add_middleware(CORSMiddleware, allow_origins=_CORS_ORIGINS, ...)
```

#### 개선 2: API Rate Limiting (slowapi) ✅ 완료
- **라이브러리**: `slowapi==0.1.9`
- **기본 제한**: 200 req/min (전역, `RATE_LIMIT_DEFAULT` 환경변수로 조정 가능)
- **엔드포인트별 제한**:

| 엔드포인트 | 제한 | 적용 이유 |
|-----------|------|---------|
| `POST /api/v1/entities/projects` | 60/min | 단일 생성 남용 방지 |
| `POST /api/v1/entities/projects/batch` | 20/min | 배치 생성 부하 제한 |
| `POST /api/v1/entities/people` | 60/min | 단일 생성 남용 방지 |
| `GET /admin/audit/export/csv` | 10/min | 대용량 CSV 내보내기 |
| `POST /admin/audit/archive` | 5/min | 아카이빙 작업 과도 실행 방지 |

- **파일**: `app/backend/main.py`, `app/backend/routers/projects.py`, `app/backend/routers/people.py`, `app/backend/routers/admin.py`

#### 개선 3: XSS 방어 sanitize 유틸리티 ✅ 완료
- **새 파일**: `app/backend/utils/sanitize.py`
- **기능**:
  - HTML 태그 전체 제거 (`strip_tags`)
  - 위험 프로토콜 제거 (`javascript:`, `vbscript:`, `data:`)
  - 이벤트 핸들러 제거 (`onclick=`, `onerror=` 등)
  - 이중 인코딩 방어 (HTML unescape 후 재처리)
  - 필드별 최대 길이 제한

- **적용 범위**:

| 파일 | 적용 함수 | 적용 엔드포인트 |
|------|---------|--------------|
| `routers/projects.py` | `sanitize_project_data` | POST (단일/배치), PUT (단일/배치) |
| `routers/people.py` | `sanitize_person_data` | POST (단일), PUT (단일/배치) |

- **React 프런트엔드 확인**: JSX `{}` 표현식은 자동 이스케이프 적용됨. `chart.tsx`의 `dangerouslySetInnerHTML`은 CSS 변수값만 출력하므로 안전.

### 5.3 잔여 경고

| ID | 항목 | 상태 | 권장 조치 |
|----|------|------|---------|
| FT-09-03 | XSS 입력 저장 | ⚠️ 부분 해결 | 백엔드 sanitize 완료. 프런트 출력 확인 (`textContent` 사용 여부 점검) |
| W-03 | Railway Hobby 자동 백업 미지원 | 🔵 인프라 이슈 | Railway Pro 업그레이드 또는 외부 백업 스크립트 |

---

## 6. 테스트 환경 정보

### 백엔드 구성
- **프레임워크**: FastAPI 0.110+, Python 3.12
- **데이터베이스**: PostgreSQL (Railway), SQLite (테스트용)
- **ORM**: SQLAlchemy 2.0 (AsyncSession)
- **인증**: JWT (python-jose), OIDC (Google OAuth 선택적)
- **Rate Limiting**: slowapi 0.1.9

### 테스트 스택
```
pytest==9.0.2
pytest-asyncio==1.3.0
httpx==0.27.0+
aiosqlite==0.20.0+
sqlalchemy==2.0.0+
```

### 테스트 파일 구조
```
tests/
├── conftest.py              # 공통 fixtures (인메모리 DB, TestClient, JWT 헬퍼)
├── unit/
│   ├── __init__.py
│   └── test_services.py     # 29개 단위 테스트
├── integration/
│   ├── __init__.py
│   └── test_api.py          # 40개 통합 테스트
└── functional/
    ├── __init__.py
    └── test_e2e.py          # 41개 기능 테스트 (pytest 기반, 스테이징)
```

---

## 7. 결론

### 합격 판정: **PASS** (v2.0 - 보안 개선 완료)

본 소프트웨어는 **총 120개 테스트 케이스** 중 **119개 통과(99.2%)** 를 달성하였으며, 감리 지적 보안사항 3종이 모두 적용 완료되었습니다.

#### 주요 검증 결과
1. **인증/인가**: JWT 만료·위조·역할 기반 접근 제어 100% 정상
2. **CRUD 무결성**: 프로젝트/인력/단계/스태핑 전 엔티티 소프트 삭제 포함 정상
3. **FK 무결성**: 없는 project_id/phase_id로 스태핑 생성 시 404 반환 정상
4. **감사 로그**: CREATE/UPDATE/STATUS_CHANGE/DELETE 모든 이벤트 자동 기록, 불변성 보장
5. **보안 헤더**: 7종 보안 헤더 모두 정상 적용 (감리 지적 후 수정 완료)
6. **성능**: 모든 엔드포인트 107~280ms (기준 3,000ms 대비 최대 9.3%)
7. **동시 처리**: 10개 동시 요청 100% 성공, 5개 동시 생성 ID 중복 없음

#### 감리 권고사항 이행 현황 (v2.0)
| 권고 ID | 항목 | 이행 상태 |
|---------|------|---------|
| W-01 | CORS 와일드카드 → 명시적 도메인 | ✅ **완료** |
| W-02 | Rate Limiting 적용 (slowapi) | ✅ **완료** |
| W-03 (XSS) | 백엔드 sanitize 유틸리티 적용 | ✅ **완료** |

#### 잔여 개선 권고
- 프런트엔드 XSS 이스케이프 최종 확인 (`textContent` vs `innerHTML`)
- Railway Hobby 플랜 백업 정책 재검토

---

*본 보고서는 자동화된 테스트 도구에 의해 생성되었습니다.*  
*감리 기준: 행정안전부 정보시스템 감리 기준 (NIA 가이드)*  
*최종 업데이트: 2026-04-07 (v2.0 - 보안 개선사항 반영)*
