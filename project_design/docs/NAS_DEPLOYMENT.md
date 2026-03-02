# NAS 운영 배포 가이드

## 문제 진단 및 해결

### 증상
Synology SSO 로그인은 되는데 콜백 후 "페이지를 찾을 수 없습니다" 오류

### 원인
1. **포트 불일치**: 컨테이너 포트(8888)와 OIDC 콜백 URI 포트(8443)가 다름
2. **역방향 프록시 헤더 미처리**: HTTPS→HTTP 변환 시 `X-Forwarded-Proto` 헤더를 uvicorn이 무시

### 해결책 (v74b212e → 현재 버전에서 수정됨)
- `deploy/docker-entrypoint.sh`: uvicorn에 `--proxy-headers --forwarded-allow-ips='*'` 추가
- `app/backend/main.py`: `ReverseProxyMiddleware` 추가 (X-Forwarded-* 헤더 반영)
- 콜백 후 `APP_URL` 미설정 시 `request.base_url` 폴백 처리

---

## Synology NAS 배포 절차

### 전제 조건
- Docker Hub: `sweatmoon/gantt-app:latest`
- NAS 도메인: `activo-no1.synology.me`
- OIDC 외부 접속 포트: `8443`

---

## 방법 A: DSM Application Portal 역방향 프록시 (권장)

### 1단계: Application Portal 역방향 프록시 설정

DSM > 제어판 > Application Portal > 역방향 프록시 탭 > 만들기

| 항목 | 값 |
|------|-----|
| 역방향 프록시 이름 | gantt-app |
| **원본** 프로토콜 | HTTPS |
| **원본** 호스트 이름 | activo-no1.synology.me |
| **원본** 포트 | **8443** |
| **대상** 프로토콜 | HTTP |
| **대상** 호스트 이름 | localhost |
| **대상** 포트 | **8080** |

> "사용자 지정 헤더" 탭에서 **WebSocket 활성화** 체크

### 2단계: `.env` 파일 생성

```bash
cd ~/docker/gantt-app   # NAS Container Manager 작업 디렉터리
cp .env.example .env
nano .env
```

```env
POSTGRES_PASSWORD=안전한비밀번호32자이상
JWT_SECRET=랜덤32자이상문자열

# OIDC 설정
OIDC_ISSUER_URL=https://activo-no1.synology.me/webman/sso
OIDC_CLIENT_ID=dc94720916c6260370a1653e9342050b
OIDC_CLIENT_SECRET=여기에_클라이언트_시크릿_입력
OIDC_REDIRECT_URI=https://activo-no1.synology.me:8443/auth/callback
APP_URL=https://activo-no1.synology.me:8443

# 역방향 프록시 사용 → 컨테이너는 8080으로만 리슨
APP_HOST_PORT=8080

ADMIN_USERS=sweatmoon
```

### 3단계: 컨테이너 실행

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 4단계: Alembic 마이그레이션 (최초 1회)

```bash
docker exec gantt-app alembic upgrade head
```

---

## 방법 B: 역방향 프록시 없이 직접 포트 노출

### `.env` 설정

```env
APP_HOST_PORT=8443    # 컨테이너 8080 → 호스트 8443 매핑
APP_URL=https://activo-no1.synology.me:8443
OIDC_REDIRECT_URI=https://activo-no1.synology.me:8443/auth/callback
```

> ⚠️ 이 경우 HTTPS 종료를 별도로 처리해야 합니다. (DSM 인증서 또는 nginx)

---

## DSM SSO 애플리케이션 설정 확인

DSM > 제어판 > Application Portal > SSO 클라이언트 설정에서:

- **Redirect URI**: `https://activo-no1.synology.me:8443/auth/callback` ✅
- **허용 범위**: `openid profile email`

---

## 트러블슈팅

### "페이지를 찾을 수 없습니다" 오류

```bash
# 컨테이너 로그 확인
docker logs gantt-app --tail=50

# 콜백 처리 확인
docker logs gantt-app 2>&1 | grep "callback\|redirect\|Login"
```

**체크리스트**:
1. ✅ `APP_URL`이 실제 접속 URL과 일치하는지 확인
2. ✅ `OIDC_REDIRECT_URI`가 DSM SSO에 등록된 URI와 **정확히** 일치하는지 확인
3. ✅ Application Portal 역방향 프록시에서 포트(8443)가 올바른지 확인
4. ✅ 방화벽에서 8443 포트가 열려 있는지 확인

### 로그인 후 빈 화면

```bash
# 토큰이 올바르게 전달되는지 확인
docker logs gantt-app 2>&1 | grep "Login success"
```

- `Login success for user: ... → https://activo-no1.synology.me:8443` 확인

### DB 마이그레이션 오류

```bash
docker exec gantt-app alembic current
docker exec gantt-app alembic upgrade head
```
