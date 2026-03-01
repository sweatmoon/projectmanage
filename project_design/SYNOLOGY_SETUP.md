# 시놀로지 NAS 계정 인증 연동 가이드

이 가이드는 프로젝트 일정 관리 시스템에 **시놀로지 NAS SSO(Single Sign-On)** 인증을 연동하는 방법을 설명합니다.  
직원들이 별도 계정 없이 **회사 NAS 계정**으로 로그인할 수 있습니다.

---

## 📋 사전 요구사항

| 항목 | 요구사항 |
|------|---------|
| Synology DSM 버전 | **7.0 이상** |
| 패키지 | **SSO Server** (패키지 센터에서 설치) |
| 네트워크 | 앱 서버 ↔ NAS 간 내부망 통신 가능 |
| Docker | 앱 서버에 Docker 설치 필요 |

---

## 1단계: 시놀로지 SSO Server 설치

1. DSM 접속 → **패키지 센터** → "SSO Server" 검색 → **설치**
2. 설치 후 **SSO Server** 앱 실행

---

## 2단계: SSO Server에서 앱 등록

1. SSO Server 열기 → **응용 프로그램** 탭 → **추가** 클릭

2. 다음 정보 입력:

   | 항목 | 값 |
   |------|---|
   | 응용 프로그램 이름 | `프로젝트 일정 관리` (원하는 이름) |
   | 리다이렉션 URI | `http://앱서버IP:8080/auth/callback` |
   | 허용 범위 | `openid`, `profile`, `email` 체크 |

3. **저장** 후 생성된 **클라이언트 ID**와 **클라이언트 시크릿** 복사

   > ⚠️ 클라이언트 시크릿은 한 번만 표시됩니다. 안전한 곳에 보관하세요.

4. **SSO 서버 URL** 확인:
   - SSO Server → **개요** 탭에서 확인
   - 형식: `https://NAS주소:포트/webman/sso`
   - 예시: `https://192.168.1.100:5001/webman/sso`

---

## 3단계: 앱 서버 설정

### 3-1. 환경 변수 파일 작성

```bash
# .env 파일 생성
cp .env.example .env
```

`.env` 파일 편집:

```env
# JWT 시크릿 (반드시 변경!)
JWT_SECRET=여기에-32자-이상-무작위-문자열-입력
JWT_EXPIRE_HOURS=8

# 시놀로지 NAS SSO 설정
OIDC_ISSUER_URL=https://192.168.1.100:5001/webman/sso
OIDC_CLIENT_ID=복사한-클라이언트-ID
OIDC_CLIENT_SECRET=복사한-클라이언트-시크릿
OIDC_REDIRECT_URI=http://앱서버IP:8080/auth/callback
APP_URL=http://앱서버IP:8080

# 기본 설정
PORT=8080
DATABASE_URL=sqlite:////data/app.db
```

### 3-2. JWT 시크릿 생성

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# 출력 예시: a1b2c3d4e5f6... (64자리 16진수 문자열)
```

---

## 4단계: Docker로 서비스 실행

### 방법 A: Docker Compose (권장)

```bash
# 이 저장소 클론
git clone https://github.com/sweatmoon/projectmanage.git
cd projectmanage/project_design

# .env 파일 작성 (위 3단계 참고)
cp .env.example .env
# .env 파일 편집...

# 서비스 시작
docker compose up -d

# 로그 확인
docker compose logs -f
```

### 방법 B: Docker Run

```bash
docker build -t project-schedule .

docker run -d \
  --name gantt-app \
  --restart unless-stopped \
  -p 8080:8080 \
  -v project_data:/data \
  -e JWT_SECRET="your-secret-here" \
  -e OIDC_ISSUER_URL="https://YOUR_NAS:5001/webman/sso" \
  -e OIDC_CLIENT_ID="your-client-id" \
  -e OIDC_CLIENT_SECRET="your-client-secret" \
  -e OIDC_REDIRECT_URI="http://YOUR_APP:8080/auth/callback" \
  -e APP_URL="http://YOUR_APP:8080" \
  project-schedule
```

---

## 5단계: 동작 확인

1. 브라우저에서 `http://앱서버IP:8080` 접속
2. 자동으로 시놀로지 NAS 로그인 페이지로 리다이렉트됨
3. NAS 계정/비밀번호 입력
4. 로그인 성공 → 앱 메인 화면으로 이동

---

## 🔧 문제 해결

### 로그인 후 오류 발생

**증상**: `Token exchange failed` 또는 `Invalid state`

**원인 및 해결**:
1. **OIDC_REDIRECT_URI** 값이 SSO Server에 등록한 URI와 정확히 일치하는지 확인
2. 앱 서버에서 NAS에 HTTPS 접근 시 자체 서명 인증서 오류 → 기본 설정에서 `verify=False`로 허용됨

### NAS 자체 서명 인증서 경고

내부망 환경이라 `verify=False`로 설정되어 있습니다. HTTPS 연결은 지원되지만 인증서 검증을 건너뜁니다.  
공인 인증서 사용 시 `app/backend/routers/auth.py`에서 `verify=False`를 `verify=True`로 변경하세요.

### 인증 없이 개발 환경 실행

`.env` 파일에서 OIDC 관련 설정을 **제거**하거나 비워두면 인증 없이 동작합니다:

```env
# OIDC 설정 주석 처리 시 인증 스킵 (개발용)
# OIDC_ISSUER_URL=
# OIDC_CLIENT_ID=
```

또는 `localhost`에서 접근 시 자동으로 인증을 건너뜁니다.

### Docker 컨테이너 상태 확인

```bash
# 컨테이너 상태
docker ps

# 로그 확인
docker logs gantt-app --tail 50

# 헬스체크
curl http://localhost:8080/health
```

---

## 🏗️ 아키텍처 흐름

```
직원 브라우저
    │
    │ 1. http://앱서버:8080 접속
    ▼
┌─────────────────┐
│   앱 서버        │  (Docker, port 8080)
│  FastAPI +      │
│  React SPA      │
└────────┬────────┘
         │ 2. 미로그인 → /auth/login 리다이렉트
         │ 3. 시놀로지 로그인 페이지로 리다이렉트
         ▼
┌─────────────────┐
│  시놀로지 NAS    │  (내부망, port 5001)
│  SSO Server     │
└────────┬────────┘
         │ 4. 로그인 성공 → /auth/callback?code=xxx
         │ 5. 백엔드가 code → token 교환
         │ 6. 사용자 정보 추출, JWT 발급
         │ 7. /?token=JWT 로 리다이렉트
         ▼
┌─────────────────┐
│   앱 서버        │
│  (JWT 저장,      │
│   앱 사용 가능)  │
└─────────────────┘
```

---

## 📁 관련 파일

| 파일 | 역할 |
|------|------|
| `app/backend/routers/auth.py` | OIDC 인증 라우터 (login, callback, logout, me) |
| `app/backend/middlewares/auth_middleware.py` | JWT 검증 미들웨어 |
| `app/frontend/src/lib/api.ts` | 프론트엔드 인증 클라이언트 |
| `app/frontend/src/App.tsx` | AuthGuard 컴포넌트 |
| `.env.example` | 환경 변수 템플릿 |

---

## 💡 보안 권장사항

1. **JWT_SECRET**: 프로덕션에서 반드시 32자 이상의 무작위 문자열 사용
2. **내부망 격리**: 앱 서버는 회사 내부망에서만 접근 가능하도록 설정
3. **NAS 접근 제한**: SSO Server에서 특정 그룹만 허용 가능 (DSM > SSO Server > 사용자 탭)
4. **HTTPS 적용**: 가능하면 Nginx + Let's Encrypt 또는 내부 CA 인증서 사용
