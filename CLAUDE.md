# CLAUDE.md – AI 개발자 상시 준수 규칙

> 이 파일은 대화 기록이 압축·초기화되어도 반드시 읽어야 하는 영구 지침입니다.
> 작업 시작 전 항상 이 파일을 확인하세요.

---

## 🚨 배포 규칙 (최우선 준수)

### 기본 배포 대상: 스테이징 서버만
- 코드 변경 후 **기본 배포는 스테이징(staging 브랜치)에만** 수행한다.
- 스테이징 서버: `https://projectmanage-production-13e7.up.railway.app`

### 라이브 서버 배포: 명시적 요청 시에만
- 라이브 서버 배포는 **사용자가 명시적으로 "라이브 배포해줘" 등으로 요청한 경우에만** 수행한다.
- 라이브 서버: `https://activo-projectmanage.up.railway.app`
- 라이브 브랜치: `live`

### 배포 흐름 요약
```
코드 변경
  → genspark_ai_developer 브랜치 커밋
  → PR 생성 (genspark_ai_developer → main)
  → main 머지
  → staging 브랜치 동기화 & 푸시  ← 여기까지가 기본
  → live 브랜치 동기화 & 푸시     ← 요청 시에만
```

---

## 프로젝트 기본 정보

- **프로젝트명**: Activo (프로젝트 일정·인력 관리 시스템)
- **레포지토리**: https://github.com/sweatmoon/projectmanage
- **Railway 서비스**:
  - 스테이징: `projectmanage-production-13e7` (staging/main 브랜치 추적)
  - 라이브: `activo-projectmanage` (live 브랜치 추적)
- **기술 스택**: FastAPI (Python) + React (TypeScript) + PostgreSQL

## Git 브랜치 구조
| 브랜치 | 용도 |
|--------|------|
| `genspark_ai_developer` | AI 개발 작업 브랜치 |
| `main` | 통합 브랜치 |
| `staging` | 스테이징 서버 배포용 |
| `live` | 라이브 서버 배포용 (**요청 시에만 업데이트**) |
