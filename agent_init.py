#!/usr/bin/env python3
"""
ActiVo 일정관리 시스템 — 에이전트 환경 초기화 스크립트
새 샌드박스/세션 시작 시 실행하여 작업 환경을 복원합니다.

사용법:
    python3 /home/user/webapp/agent_init.py
"""

import os
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path("/home/user/webapp/project_design")
BACKEND_DIR = PROJECT_DIR / "app/backend"
FRONTEND_DIR = PROJECT_DIR / "app/frontend"
REPO_URL = "https://github.com/sweatmoon/projectmanage"

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BLUE = "\033[94m"
RESET = "\033[0m"
BOLD = "\033[1m"


def run(cmd: str, cwd: Path = None, check: bool = True) -> subprocess.CompletedProcess:
    """명령어 실행 헬퍼"""
    result = subprocess.run(
        cmd, shell=True, cwd=cwd or PROJECT_DIR,
        capture_output=True, text=True
    )
    if check and result.returncode != 0:
        print(f"{RED}오류: {result.stderr[:500]}{RESET}")
    return result


def print_section(title: str):
    print(f"\n{BOLD}{BLUE}{'='*60}{RESET}")
    print(f"{BOLD}{BLUE}  {title}{RESET}")
    print(f"{BOLD}{BLUE}{'='*60}{RESET}")


def check_project_structure():
    print_section("1. 프로젝트 구조 확인")

    checks = {
        "백엔드 디렉터리": BACKEND_DIR,
        "프론트엔드 디렉터리": FRONTEND_DIR,
        "main.py": BACKEND_DIR / "main.py",
        "Index.tsx": PROJECT_DIR / "app/frontend/src/pages/Index.tsx",
        "ProjectDetail.tsx": PROJECT_DIR / "app/frontend/src/pages/ProjectDetail.tsx",
        "docker-compose.yml": PROJECT_DIR / "docker-compose.yml",
    }

    all_ok = True
    for name, path in checks.items():
        exists = path.exists()
        status = f"{GREEN}✅{RESET}" if exists else f"{RED}❌{RESET}"
        print(f"  {status} {name}: {path}")
        if not exists:
            all_ok = False

    return all_ok


def check_git_status():
    print_section("2. Git 상태 확인")

    result = run("git log --oneline -5", check=False)
    if result.returncode == 0:
        print(f"{GREEN}최근 커밋:{RESET}")
        for line in result.stdout.strip().split('\n'):
            print(f"  {line}")
    else:
        print(f"{YELLOW}Git 저장소 없음 — 클론 시도...{RESET}")
        run(f"git clone {REPO_URL} .", cwd=Path("/home/user/webapp"), check=False)

    branch = run("git branch --show-current", check=False).stdout.strip()
    print(f"\n{GREEN}현재 브랜치: {branch}{RESET}")

    status = run("git status --short", check=False).stdout.strip()
    if status:
        print(f"{YELLOW}변경된 파일:{RESET}")
        print(status)
    else:
        print(f"{GREEN}작업 디렉터리 깨끗함{RESET}")


def check_backend_dependencies():
    print_section("3. 백엔드 의존성 확인")

    # Python 버전 확인
    py_version = run("python3 --version", check=False).stdout.strip()
    print(f"  Python: {py_version}")

    # 핵심 패키지 확인
    packages = ["fastapi", "sqlalchemy", "uvicorn", "pydantic", "httpx", "alembic"]
    for pkg in packages:
        result = run(f"python3 -c \"import {pkg}; print({pkg}.__version__)\"",
                     cwd=BACKEND_DIR, check=False)
        if result.returncode == 0:
            version = result.stdout.strip()
            print(f"  {GREEN}✅ {pkg} {version}{RESET}")
        else:
            print(f"  {YELLOW}⚠️  {pkg} 미설치 — pip install 필요{RESET}")

    req_file = BACKEND_DIR / "requirements.txt"
    if req_file.exists():
        print(f"\n  {GREEN}requirements.txt 존재 — 설치하려면:{RESET}")
        print(f"  cd {BACKEND_DIR} && pip install -r requirements.txt")


def check_frontend_dependencies():
    print_section("4. 프론트엔드 의존성 확인")

    # Node.js 버전 확인
    node_version = run("node --version", check=False).stdout.strip()
    print(f"  Node.js: {node_version}")

    npm_version = run("npm --version", check=False).stdout.strip()
    print(f"  npm: {npm_version}")

    # node_modules 확인
    node_modules = FRONTEND_DIR / "node_modules"
    if node_modules.exists():
        print(f"  {GREEN}✅ node_modules 존재{RESET}")
    else:
        print(f"  {YELLOW}⚠️  node_modules 없음 — npm install 필요{RESET}")

    # dist 빌드 확인
    dist = FRONTEND_DIR / "dist"
    if dist.exists():
        index_html = dist / "index.html"
        print(f"  {GREEN}✅ dist/ 빌드 결과물 존재{RESET}")
        if index_html.exists():
            size = index_html.stat().st_size
            print(f"     index.html: {size} bytes")
    else:
        print(f"  {YELLOW}⚠️  dist/ 없음 — npm run build 필요{RESET}")


def print_quick_reference():
    print_section("5. 빠른 참조 — 자주 쓰는 명령어")

    commands = [
        ("백엔드 실행", f"cd {BACKEND_DIR} && python main.py"),
        ("프론트엔드 개발서버", f"cd {FRONTEND_DIR} && npm run dev"),
        ("프론트엔드 빌드", f"cd {FRONTEND_DIR} && npm run build"),
        ("Docker 운영 시작", f"cd {PROJECT_DIR} && docker compose up -d"),
        ("Docker 재시작", f"cd {PROJECT_DIR} && docker compose restart app"),
        ("DB 마이그레이션", f"cd {BACKEND_DIR} && alembic upgrade head"),
        ("Git 상태", f"cd {PROJECT_DIR} && git status"),
        ("Git 최신화", f"cd {PROJECT_DIR} && git pull origin main"),
    ]

    for desc, cmd in commands:
        print(f"\n  {YELLOW}{desc}:{RESET}")
        print(f"    {cmd}")


def print_project_summary():
    print_section("ActiVo 일정관리 시스템 — 에이전트 컨텍스트")

    summary = f"""
  {BOLD}프로젝트:{RESET} ActiVo 일정관리 시스템 (악티보)
  {BOLD}GitHub:{RESET}  https://github.com/sweatmoon/projectmanage
  {BOLD}버전:{RESET}    v2 (section_map 독립 저장 지원)

  {BOLD}기술 스택:{RESET}
    • 백엔드:  FastAPI + SQLAlchemy + PostgreSQL/SQLite
    • 프론트:  React 18 + TypeScript + Vite + Tailwind CSS
    • 배포:    Docker + Synology NAS

  {BOLD}주요 기능:{RESET}
    • 감리/제안 프로젝트 관리
    • 텍스트 일괄 단계+인력 입력 (section_map 지원)
    • 인력별/사업별 일정 관리
    • 동접 잠금 (Presence, polling 방식)
    • OIDC SSO 인증 (미설정 시 우회)

  {BOLD}개발 브랜치:{RESET} genspark_ai_developer → main PR

  {BOLD}AGENT.md:{RESET} /home/user/webapp/AGENT.md (전체 시스템 프롬프트)
"""
    print(summary)


def main():
    print(f"\n{BOLD}{'#'*60}{RESET}")
    print(f"{BOLD}  ActiVo 에이전트 환경 초기화{RESET}")
    print(f"{BOLD}{'#'*60}{RESET}")

    print_project_summary()
    structure_ok = check_project_structure()
    check_git_status()
    check_backend_dependencies()
    check_frontend_dependencies()
    print_quick_reference()

    print(f"\n{BOLD}{GREEN}{'='*60}{RESET}")
    if structure_ok:
        print(f"{BOLD}{GREEN}  ✅ 환경 초기화 완료 — 작업 준비됨{RESET}")
    else:
        print(f"{BOLD}{YELLOW}  ⚠️  일부 파일 누락 — Git에서 복원 필요{RESET}")
        print(f"  git clone {REPO_URL} {PROJECT_DIR}")
    print(f"{BOLD}{GREEN}{'='*60}{RESET}\n")


if __name__ == "__main__":
    main()
