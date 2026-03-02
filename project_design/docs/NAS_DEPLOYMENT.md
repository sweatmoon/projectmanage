# NAS 운영 배포 가이드

## 현재 activo-no1 NAS 실제 구성 (스크린샷 확인 기준)

```
브라우저 → https://activo-no1.synology.me:8443
    ↓  (DSM Application Portal 역방향 프록시)
NAS localhost:8888  (HTTP)
    ↓  (Docker 포트 매핑 8888:8080)
컨테이너:8080  (FastAPI uvicorn)
```

| 구성 요소 | 설정값 |
|----------|--------|
| 역방향 프록시 소스 | HTTPS · `activo-no1.synology.me` · **8443** |
| 역방향 프록시 대상 | HTTP · `localhost` · **8888** |
| Docker 포트 매핑 | `8888:8080` (호스트:컨테이너) |
| 라우터 포트포워딩 | 외부 8443, 8888 모두 개방 |

---

## 문제 진단 및 해결

### 증상
Synology SSO 로그인은 되는데 콜백 후 "페이지를 찾을 수 없습니다" 오류

### 원인
1. **X-Forwarded-Proto 미처리**: DSM 역방향 프록시가 HTTPS→HTTP 변환 시 헤더를 전달하는데 uvicorn이 무시하여 콜백 리다이렉트 URL이 `http://`로 생성됨
2. **APP_HOST_PORT 불일치**: 이전 설정에서 `8080:8080`이었는데 역방향 프록시 대상이 `8888`이므로 컨테이너가 응답하지 않음

### 해결 (현재 버전에 반영)
- `deploy/docker-entrypoint.sh`: uvicorn `--proxy-headers --forwarded-allow-ips='*'` 추가
- `app/backend/main.py`: `ReverseProxyMiddleware` 추가 (X-Forwarded-Proto/Host 자동 반영)
- `docker-compose.prod.yml`: `APP_HOST_PORT=8888` 기본값으로 수정

---

## NAS .env 파일 설정

NAS의 docker 작업 디렉터리에서 `.env` 파일을 아래와 같이 설정:

```env
# ─── 필수 변경 항목 ───────────────────────────────────────
POSTGRES_PASSWORD=안전한비밀번호를여기입력
JWT_SECRET=최소32자이상랜덤문자열을여기입력

# ─── OIDC (Synology SSO) ─────────────────────────────────
OIDC_ISSUER_URL=https://activo-no1.synology.me/webman/sso
OIDC_CLIENT_ID=dc94720916c6260370a1653e9342050b
OIDC_CLIENT_SECRET=여기에_DSM_SSO_클라이언트_시크릿_입력
OIDC_REDIRECT_URI=https://activo-no1.synology.me:8443/auth/callback
APP_URL=https://activo-no1.synology.me:8443

# ─── 포트 매핑 (역방향 프록시 대상 포트와 일치) ──────────
APP_HOST_PORT=8888   ← 역방향 프록시 대상이 8888이므로 반드시 8888

# ─── 관리자 ──────────────────────────────────────────────
ADMIN_USERS=sweatmoon
```

---

## 컨테이너 재시작 방법

```bash
# NAS SSH 또는 Container Manager 터미널에서:
cd ~/docker/gantt-app   # docker-compose.yml 위치

# 최신 이미지 pull 후 재시작
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 또는 Watchtower가 자동으로 5분마다 업데이트 (이미 실행 중)
```

---

## DSM Application Portal 역방향 프록시 설정 확인

**DSM > 제어판 > Application Portal > 역방향 프록시 > "gantt-app" 편집**

| 항목 | 현재값 | 올바른값 |
|------|--------|---------|
| 소스 프로토콜 | HTTPS | HTTPS ✅ |
| 소스 호스트 | activo-no1.synology.me | 동일 ✅ |
| 소스 포트 | 8443 | 8443 ✅ |
| 대상 프로토콜 | HTTP | HTTP ✅ |
| 대상 호스트 | localhost | localhost ✅ |
| 대상 포트 | **8888** | **8888** ✅ |

> **"사용자 지정 머리글" 탭** 에서 WebSocket 관련 헤더 확인:
> - `Upgrade: $http_upgrade`
> - `Connection: $connection_upgrade`

---

## 트러블슈팅

### 로그 확인

```bash
# 컨테이너 실시간 로그
docker logs gantt-app -f --tail=50

# 콜백 처리 확인
docker logs gantt-app 2>&1 | grep -E "callback|redirect|Login success|error"
```

**정상 작동 시 로그**:
```
Login success for user: sweatmoon (...) role=admin → https://activo-no1.synology.me:8443
```

### "Invalid or expired state" 오류
- OIDC state가 10분 안에 콜백이 와야 함
- DB 연결 확인: `docker logs gantt-db --tail=20`

### 로그인 후 빈 화면 / 무한 로딩
- 브라우저 개발자 도구 > Network 탭에서 `/?token=...` 리다이렉트 확인
- localStorage에 `app_token` 키가 저장됐는지 확인

### DB 마이그레이션

```bash
docker exec gantt-app alembic current
docker exec gantt-app alembic upgrade head
```
