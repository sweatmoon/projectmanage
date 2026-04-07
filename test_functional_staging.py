#!/usr/bin/env python3
"""
스테이징 서버 기능 테스트 (Functional Test)
실행: python test_functional_staging.py

테스트 범위:
  FT-01  사업 전체 라이프사이클
  FT-02  인증/인가 시나리오
  FT-03  감사 로그 추적
  FT-04  홈 통계 연동
  FT-05  동시 처리 안정성
  FT-06  보안 헤더 검증 (감리 배포 후)
  FT-07  에러 처리 시나리오
  FT-08  성능 기준 (3초 이내)
  FT-09  데이터 일관성 검증
  FT-10  배치 API 시나리오
"""
import json
import time
import threading
import sys
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = "https://projectmanage-production-13e7.up.railway.app"
JWT_SECRET = "gT9mK2xPqR7vN4wL8cFIyH6sA3dE5bJ0"

# ──────────────────────────────────────────────
# 공통 유틸
# ──────────────────────────────────────────────
def make_token(role="admin", sub="ft_tester_001"):
    from jose import jwt as jlib
    now = datetime.now(timezone.utc)
    return jlib.encode({
        "sub": sub, "email": "ft@activo.com",
        "name": f"FT테스터({role})", "role": role,
        "iat": now, "exp": now + timedelta(hours=8),
    }, JWT_SECRET, algorithm="HS256")

def hdr(role="admin"):
    return {"Authorization": f"Bearer {make_token(role)}", "Content-Type": "application/json"}

pass_count = 0
fail_count = 0
warn_count = 0
results = []

def record(test_id, name, passed, detail="", warn=False):
    global pass_count, fail_count, warn_count
    icon = "✅ PASS" if passed and not warn else ("⚠️  WARN" if warn else "❌ FAIL")
    print(f"  {icon}  [{test_id}] {name}" + (f"\n         → {detail}" if detail else ""))
    if warn:
        warn_count += 1
        results.append({"id": test_id, "name": name, "status": "WARN", "detail": detail})
    elif passed:
        pass_count += 1
        results.append({"id": test_id, "name": name, "status": "PASS", "detail": detail})
    else:
        fail_count += 1
        results.append({"id": test_id, "name": name, "status": "FAIL", "detail": detail})


# ══════════════════════════════════════════════
# FT-01: 사업 전체 라이프사이클
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-01: 사업 전체 라이프사이클 테스트")
print("="*60)
proj_id = phase_ids = staff_ids = None
try:
    # FT-01-01: 사업 생성
    r = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
        json={"project_name": "[FT]E2E테스트사업", "organization": "FT기관", "status": "감리"})
    ok = r.status_code == 201
    proj_id = r.json().get("id") if ok else None
    record("FT-01-01", "사업 생성 (201)", ok, f"ID={proj_id}" if ok else r.text[:80])

    if proj_id:
        # FT-01-02: 단계 3개 생성 (재시도 1회)
        phase_ids = []
        for i, (nm, s, e) in enumerate([("착수", "2026-01-01", "2026-03-31"),
                                         ("수행", "2026-04-01", "2026-09-30"),
                                         ("종료", "2026-10-01", "2026-12-31")]):
            for _attempt in range(2):
                r2 = requests.post(f"{BASE_URL}/api/v1/entities/phases", headers=hdr(), timeout=15,
                    json={"project_id": proj_id, "phase_name": nm,
                          "start_date": s, "end_date": e, "sort_order": i+1})
                if r2.status_code == 201:
                    phase_ids.append(r2.json()["id"])
                    break
                time.sleep(0.5)
        record("FT-01-02", "단계 3개 생성", len(phase_ids)==3, f"IDs={phase_ids}")

        # FT-01-03: 스태핑 등록
        staff_ids = []
        if phase_ids:
            for person, sf in [("김수석감리원","수석감리원"), ("이감리원","감리원")]:
                rs = requests.post(f"{BASE_URL}/api/v1/entities/staffing", headers=hdr(), timeout=10,
                    json={"project_id": proj_id, "phase_id": phase_ids[0],
                          "category": "감리", "field": "감리원", "sub_field": sf,
                          "person_name_text": person, "md": 20})
                if rs.status_code == 201:
                    staff_ids.append(rs.json()["id"])
        record("FT-01-03", "스태핑 2명 등록", len(staff_ids)==2, f"IDs={staff_ids}")

        # FT-01-04: is_won 상태 변경
        rw = requests.put(f"{BASE_URL}/api/v1/entities/projects/{proj_id}", headers=hdr(), timeout=10,
            json={"is_won": True, "status": "확정"})
        body = rw.json() if rw.status_code == 200 else {}
        record("FT-01-04", "사업 수주 상태 변경 (is_won=True)", rw.status_code==200 and body.get("is_won")==True,
               f"status={body.get('status')}, is_won={body.get('is_won')}")

        # FT-01-05: 단계 목록 조회 (project_id 필터)
        rl = requests.get(f"{BASE_URL}/api/v1/entities/phases", headers=hdr(), timeout=10,
            params={"query": json.dumps({"project_id": proj_id}), "limit": 100})
        total = rl.json().get("total", 0) if rl.status_code == 200 else 0
        record("FT-01-05", "단계 필터 조회", rl.status_code==200 and total >= 3, f"total={total}")

        # FT-01-06: 스태핑 MD 업데이트
        if staff_ids:
            ru = requests.put(f"{BASE_URL}/api/v1/entities/staffing/{staff_ids[0]}", headers=hdr(), timeout=10,
                json={"md": 35})
            record("FT-01-06", "스태핑 MD 업데이트", ru.status_code==200 and ru.json().get("md")==35,
                   f"md={ru.json().get('md') if ru.status_code==200 else ru.text[:60]}")

        # FT-01-07: 소프트 삭제 후 미노출
        requests.delete(f"{BASE_URL}/api/v1/entities/projects/{proj_id}", headers=hdr(), timeout=10)
        rg = requests.get(f"{BASE_URL}/api/v1/entities/projects/{proj_id}", headers=hdr(), timeout=10)
        record("FT-01-07", "삭제 후 404 확인", rg.status_code==404)

except Exception as ex:
    record("FT-01-ERR", "라이프사이클 예외", False, str(ex))
    # 정리
    if proj_id:
        requests.delete(f"{BASE_URL}/api/v1/entities/projects/{proj_id}", headers=hdr(), timeout=5)


# ══════════════════════════════════════════════
# FT-02: 인증/인가
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-02: 인증/인가 시나리오")
print("="*60)

# FT-02-01: 토큰 없이 → 401
r = requests.get(f"{BASE_URL}/api/v1/entities/projects", timeout=10)
record("FT-02-01", "미인증 요청 401 차단", r.status_code==401,
       f"auth_required={r.json().get('auth_required')}" if r.status_code==401 else r.text[:60])

# FT-02-02: 만료 토큰 → 401
from jose import jwt as jlib
now = datetime.now(timezone.utc)
expired_tok = jlib.encode({"sub":"u","role":"admin","exp": now - timedelta(hours=1)}, JWT_SECRET, algorithm="HS256")
r2 = requests.get(f"{BASE_URL}/api/v1/entities/projects",
    headers={"Authorization": f"Bearer {expired_tok}"}, timeout=10)
record("FT-02-02", "만료 토큰 401 차단", r2.status_code==401)

# FT-02-03: 위조 시크릿 → 401
wrong_tok = jlib.encode({"sub":"u","role":"admin","exp": now + timedelta(hours=8)}, "WRONG_SECRET_XYZ", algorithm="HS256")
r3 = requests.get(f"{BASE_URL}/api/v1/entities/projects",
    headers={"Authorization": f"Bearer {wrong_tok}"}, timeout=10)
record("FT-02-03", "위조 토큰 401 차단", r3.status_code==401)

# FT-02-04: Viewer 쓰기 → 403
r4 = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr("viewer"), timeout=10,
    json={"project_name": "뷰어쓰기시도", "organization": "X", "status": "감리"})
record("FT-02-04", "Viewer 쓰기 403 차단", r4.status_code==403)

# FT-02-05: Viewer 읽기 → 200
r5 = requests.get(f"{BASE_URL}/api/v1/entities/projects", headers=hdr("viewer"), timeout=10)
record("FT-02-05", "Viewer 읽기 200 허용", r5.status_code==200)

# FT-02-06: user role → 관리자 API 차단 403
r6 = requests.get(f"{BASE_URL}/admin/users", headers=hdr("user"), timeout=10)
record("FT-02-06", "User 관리자 API 403 차단", r6.status_code==403)

# FT-02-07: viewer → 관리자 API 차단 403
r7 = requests.get(f"{BASE_URL}/admin/users", headers=hdr("viewer"), timeout=10)
record("FT-02-07", "Viewer 관리자 API 403 차단", r7.status_code==403)

# FT-02-08: dev-login 프로덕션 비활성화
r8 = requests.get(f"{BASE_URL}/auth/dev-login", timeout=10)
record("FT-02-08", "dev-login 프로덕션 비활성화 (403)", r8.status_code==403)

# FT-02-09: admin → 관리자 API 200
r9 = requests.get(f"{BASE_URL}/admin/users", headers=hdr("admin"), timeout=10)
record("FT-02-09", "Admin 관리자 API 200 접근", r9.status_code==200,
       f"users={len(r9.json()) if r9.status_code==200 else '?'}명")


# ══════════════════════════════════════════════
# FT-03: 감사 로그 추적
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-03: 감사 로그 추적 시나리오")
print("="*60)

# FT-03-01: CREATE 이벤트 기록 확인
r_b = requests.get(f"{BASE_URL}/admin/audit?event_type=CREATE&limit=1", headers=hdr(), timeout=10)
cnt_before = r_b.json().get("total", 0) if r_b.status_code==200 else -1

r_c = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
    json={"project_name": "[FT감사]생성테스트", "organization": "기관", "status": "감리"})
new_pid = r_c.json().get("id") if r_c.status_code==201 else None

r_a = requests.get(f"{BASE_URL}/admin/audit?event_type=CREATE&limit=1", headers=hdr(), timeout=10)
cnt_after = r_a.json().get("total", 0) if r_a.status_code==200 else -1
record("FT-03-01", "사업 생성 → CREATE 감사 로그 증가",
       cnt_after > cnt_before, f"{cnt_before} → {cnt_after}")

# FT-03-02: STATUS_CHANGE 이벤트 기록
if new_pid:
    r_sc_b = requests.get(f"{BASE_URL}/admin/audit?event_type=STATUS_CHANGE&limit=1", headers=hdr(), timeout=10)
    sc_before = r_sc_b.json().get("total", 0) if r_sc_b.status_code==200 else -1
    
    requests.put(f"{BASE_URL}/api/v1/entities/projects/{new_pid}", headers=hdr(), timeout=10,
        json={"status": "확정"})
    
    r_sc_a = requests.get(f"{BASE_URL}/admin/audit?event_type=STATUS_CHANGE&limit=1", headers=hdr(), timeout=10)
    sc_after = r_sc_a.json().get("total", 0) if r_sc_a.status_code==200 else -1
    record("FT-03-02", "상태 변경 → STATUS_CHANGE 감사 로그 증가",
           sc_after > sc_before, f"{sc_before} → {sc_after}")

# FT-03-03: 감사 로그 불변성 (삭제/수정 차단)
rd = requests.delete(f"{BASE_URL}/admin/audit/1", headers=hdr(), timeout=10)
rp = requests.put(f"{BASE_URL}/admin/audit/1", headers=hdr(), timeout=10,
    json={"event_type": "TAMPERED"})
record("FT-03-03", "감사 로그 불변성 (DELETE/PUT → 405)",
       rd.status_code==405 and rp.status_code==405,
       f"DELETE={rd.status_code}, PUT={rp.status_code}")

# FT-03-04: CSV 내보내기
r_csv = requests.get(f"{BASE_URL}/admin/audit/export/csv?limit=10", headers=hdr(), timeout=15)
csv_ok = (r_csv.status_code==200 and "text/csv" in r_csv.headers.get("Content-Type","")
          and len(r_csv.text.strip().split("\n")) >= 2)
record("FT-03-04", "감사 로그 CSV 내보내기",
       csv_ok, f"rows={len(r_csv.text.strip().split(chr(10)))-1}" if csv_ok else r_csv.text[:60])

# FT-03-05: 아카이빙 API
r_arc = requests.post(f"{BASE_URL}/admin/audit/archive", headers=hdr(), timeout=15, json={})
arc_ok = r_arc.status_code==200 and "archived_count" in r_arc.json()
record("FT-03-05", "감사 로그 아카이빙 API",
       arc_ok, f"archived={r_arc.json().get('archived_count','?')}" if arc_ok else r_arc.text[:60])

# 정리
if new_pid:
    requests.delete(f"{BASE_URL}/api/v1/entities/projects/{new_pid}", headers=hdr(), timeout=5)


# ══════════════════════════════════════════════
# FT-04: 홈 통계 연동
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-04: 홈 통계 연동 시나리오")
print("="*60)

r_stats = requests.get(f"{BASE_URL}/api/v1/home/stats", headers=hdr(), timeout=10)
if r_stats.status_code == 200:
    body = r_stats.json()
    
    # FT-04-01: 응답 필드 완전성
    required_fields = ["active_project_count","proposal_count","people_count",
                       "utilization_rate","utilization_numerator","utilization_denominator",
                       "auditor_count","biz_days_ytd"]
    missing = [f for f in required_fields if f not in body]
    record("FT-04-01", "홈 통계 응답 필드 완전성 (8개)", not missing,
           f"missing={missing}" if missing else f"all {len(required_fields)} fields present")
    
    # FT-04-02: 가동률 0~1 범위
    rate = body.get("utilization_rate", -1)
    record("FT-04-02", "가동률 범위 (0.0 ~ 1.0)", 0.0 <= rate <= 1.0, f"utilization_rate={rate:.2%}")
    
    # FT-04-03: 업무일수 양수
    biz = body.get("biz_days_ytd", 0)
    record("FT-04-03", "업무일수 양수", biz > 0, f"biz_days_ytd={biz}")
    
    # FT-04-04: 제안 추가 시 카운트 증가
    cnt_before = body["proposal_count"]
    rp = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
        json={"project_name": "[FT통계]제안사업", "organization": "기관", "status": "제안"})
    fp_id = rp.json().get("id") if rp.status_code==201 else None
    
    r_stats2 = requests.get(f"{BASE_URL}/api/v1/home/stats", headers=hdr(), timeout=10)
    cnt_after = r_stats2.json().get("proposal_count", 0) if r_stats2.status_code==200 else 0
    record("FT-04-04", "제안 추가 시 proposal_count 증가", cnt_after == cnt_before + 1,
           f"{cnt_before} → {cnt_after}")
    if fp_id:
        requests.delete(f"{BASE_URL}/api/v1/entities/projects/{fp_id}", headers=hdr(), timeout=5)
else:
    record("FT-04-01", "홈 통계 API", False, f"status={r_stats.status_code}")


# ══════════════════════════════════════════════
# FT-05: 동시 처리 안정성
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-05: 동시 처리 안정성 테스트")
print("="*60)

# FT-05-01: 동시 10요청 읽기
read_results = []
def do_read():
    r = requests.get(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10)
    read_results.append(r.status_code)

start = time.time()
threads = [threading.Thread(target=do_read) for _ in range(10)]
for t in threads: t.start()
for t in threads: t.join()
elapsed = (time.time() - start) * 1000
ok_cnt = read_results.count(200)
record("FT-05-01", "동시 10요청 읽기 안정성", ok_cnt==10,
       f"{ok_cnt}/10 성공, {elapsed:.0f}ms")

# FT-05-02: 동시 5건 생성 (ID 중복 없음)
created_ids = []
lock = threading.Lock()
def do_create(i):
    r = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
        json={"project_name": f"[FT동시]{i}", "organization": "기관", "status": "감리"})
    if r.status_code == 201:
        with lock:
            created_ids.append(r.json()["id"])

threads2 = [threading.Thread(target=do_create, args=(i,)) for i in range(5)]
for t in threads2: t.start()
for t in threads2: t.join()
record("FT-05-02", "동시 5건 생성, ID 중복 없음", len(created_ids)==5 and len(set(created_ids))==5,
       f"생성={len(created_ids)}, 고유={len(set(created_ids))}, IDs={created_ids}")
for pid in created_ids:
    requests.delete(f"{BASE_URL}/api/v1/entities/projects/{pid}", headers=hdr(), timeout=5)


# ══════════════════════════════════════════════
# FT-06: 보안 헤더 (감리 보완 후)
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-06: 보안 헤더 검증 (감리 배포 후)")
print("="*60)

r_health = requests.get(f"{BASE_URL}/health", timeout=10)
h = r_health.headers

SECURITY_HEADERS = {
    "x-frame-options": ["SAMEORIGIN", "DENY"],
    "x-content-type-options": ["nosniff"],
    "strict-transport-security": ["max-age=31536000"],
    "referrer-policy": ["strict-origin-when-cross-origin", "no-referrer"],
    "x-xss-protection": ["1; mode=block"],
    "content-security-policy": ["'self'", "default-src"],
    "permissions-policy": ["geolocation=", "camera=", "microphone="],
}

all_ok = True
details = []
for header, expected_vals in SECURITY_HEADERS.items():
    actual = h.get(header, "")
    found = any(ev in actual for ev in expected_vals)
    if not found:
        all_ok = False
        details.append(f"MISSING: {header} (got='{actual[:50]}')")
    else:
        details.append(f"OK: {header}={actual[:50]}")

for d in details:
    print(f"    {d}")
record("FT-06-01", f"7종 보안 헤더 모두 존재", all_ok,
       f"{7-len([d for d in details if d.startswith('MISSING')])}/7 헤더 정상" if not all_ok else "7/7 모두 정상")

# FT-06-02: CORS malicious origin 차단
r_cors = requests.options(f"{BASE_URL}/api/v1/entities/projects",
    headers={"Origin": "https://evil.hacker.com",
             "Access-Control-Request-Method": "GET"}, timeout=10)
acao = r_cors.headers.get("access-control-allow-origin", "")
cors_blocked = acao not in ("https://evil.hacker.com", "*")
record("FT-06-02", "악성 Origin CORS 차단", cors_blocked,
       f"ACAO='{acao}' (status={r_cors.status_code})")


# ══════════════════════════════════════════════
# FT-07: 에러 처리
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-07: 에러 처리 시나리오")
print("="*60)

# FT-07-01: 없는 ID → 404
r71 = requests.get(f"{BASE_URL}/api/v1/entities/projects/99999999", headers=hdr(), timeout=10)
record("FT-07-01", "없는 ID 조회 → 404", r71.status_code==404)

# FT-07-02: 잘못된 경로 파라미터 → 422
r72 = requests.get(f"{BASE_URL}/api/v1/entities/projects/invalid-abc", headers=hdr(), timeout=10)
record("FT-07-02", "잘못된 경로 파라미터 → 422", r72.status_code==422)

# FT-07-03: 필수 필드 누락 → 422
r73 = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
    json={"status": "감리"})
record("FT-07-03", "필수 필드 누락 → 422", r73.status_code==422)

# FT-07-04: 에러 응답에 스택 트레이스 미노출
r74 = requests.get(f"{BASE_URL}/api/v1/entities/projects/invalid", headers=hdr(), timeout=10)
no_trace = "traceback" not in r74.text.lower() and "stack" not in r74.text.lower()
record("FT-07-04", "에러 응답에 스택 트레이스 미노출", no_trace,
       r74.text[:80] if not no_trace else "안전한 에러 응답 확인")

# FT-07-05: FK 무결성 검증 (없는 project_id로 스태핑 생성)
r75 = requests.post(f"{BASE_URL}/api/v1/entities/staffing", headers=hdr(), timeout=10,
    json={"project_id": 999999, "phase_id": 999999, "category": "감리",
          "field": "감리원", "sub_field": "수석감리원", "md": 10})
record("FT-07-05", "FK 무결성: 없는 project_id 스태핑 → 404", r75.status_code==404,
       f"status={r75.status_code}, response={r75.text[:60]}")

# FT-07-06: limit 초과 → 422
r76 = requests.get(f"{BASE_URL}/api/v1/entities/projects?limit=9999", headers=hdr(), timeout=10)
record("FT-07-06", "limit 초과(9999) → 422", r76.status_code==422)

# FT-07-07: skip 음수 → 422
r77 = requests.get(f"{BASE_URL}/api/v1/entities/projects?skip=-1", headers=hdr(), timeout=10)
record("FT-07-07", "skip 음수(-1) → 422", r77.status_code==422)


# ══════════════════════════════════════════════
# FT-08: 성능 기준 (3초 이내)
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-08: 응답 시간 성능 기준 테스트 (기준: 3,000ms)")
print("="*60)

endpoints = [
    ("/health",                         "헬스체크",      False),
    ("/api/v1/entities/projects",       "프로젝트 목록", True),
    ("/api/v1/entities/people",         "인력 목록",     True),
    ("/api/v1/entities/phases",         "단계 목록",     True),
    ("/api/v1/entities/staffing",       "스태핑 목록",   True),
    ("/api/v1/home/stats",              "홈 통계",       True),
    ("/admin/stats",                    "관리자 통계",   True),
    ("/admin/audit?limit=50",           "감사 로그 50건",True),
]
for ep, name, auth in endpoints:
    h_ = hdr() if auth else {}
    t0 = time.time()
    r_ep = requests.get(f"{BASE_URL}{ep}", headers=h_, timeout=10)
    ms = (time.time() - t0) * 1000
    ok = r_ep.status_code not in (500, 503) and ms < 3000
    warn = r_ep.status_code not in (500, 503) and 1500 <= ms < 3000
    record(f"FT-08", f"{name} < 3000ms", ok, f"{ms:.0f}ms (HTTP {r_ep.status_code})",
           warn=warn and ok)


# ══════════════════════════════════════════════
# FT-09: 데이터 일관성 검증
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-09: 데이터 일관성 검증")
print("="*60)

# FT-09-01: 삭제된 항목이 목록에 미노출
r_c9 = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
    json={"project_name": "[FT일관성]삭제확인", "organization": "기관", "status": "감리"})
p9_id = r_c9.json().get("id") if r_c9.status_code==201 else None
if p9_id:
    requests.delete(f"{BASE_URL}/api/v1/entities/projects/{p9_id}", headers=hdr(), timeout=5)
    r_list = requests.get(f"{BASE_URL}/api/v1/entities/projects?limit=200", headers=hdr(), timeout=10)
    ids_in_list = [it["id"] for it in r_list.json().get("items", [])]
    not_in_list = p9_id not in ids_in_list
    record("FT-09-01", "삭제된 항목 목록 미노출", not_in_list,
           f"ID {p9_id} {'목록에 없음 ✓' if not_in_list else '목록에 있음 ✗'}")

# FT-09-02: 총 카운트와 실제 아이템 수 일치
r_pg = requests.get(f"{BASE_URL}/api/v1/entities/projects?limit=5", headers=hdr(), timeout=10)
if r_pg.status_code == 200:
    pg_body = r_pg.json()
    items_len = len(pg_body.get("items", []))
    total = pg_body.get("total", 0)
    record("FT-09-02", "페이지 아이템 수 ≤ total", items_len <= total and items_len <= 5,
           f"items={items_len}, total={total}")

# FT-09-03: XSS 입력 저장 후 스크립트 실행 여부
xss_name = "<script>alert('xss')</script>"
r_xss = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
    json={"project_name": xss_name, "organization": "기관", "status": "감리"})
if r_xss.status_code == 201:
    xss_id = r_xss.json().get("id")
    r_get = requests.get(f"{BASE_URL}/api/v1/entities/projects/{xss_id}", headers=hdr(), timeout=10)
    # 저장은 되지만 API 응답에서 원문 그대로 반환 (프런트엔드 이스케이프 필요)
    raw_returned = r_get.json().get("project_name","") if r_get.status_code==200 else ""
    # 백엔드는 이스케이프 안 하지만 실제 XSS는 프론트 이슈
    record("FT-09-03", "XSS 입력 저장 (프런트 이스케이프 필요)", r_xss.status_code==201,
           f"저장 가능 (백엔드 저장 허용, 프런트 이스케이프 별도 필요) → WARN",
           warn=True)
    requests.delete(f"{BASE_URL}/api/v1/entities/projects/{xss_id}", headers=hdr(), timeout=5)

# FT-09-04: SQL인젝션 입력 저장 후 DB 무결성
sql_name = "'; DROP TABLE projects; --"
r_sql = requests.post(f"{BASE_URL}/api/v1/entities/projects", headers=hdr(), timeout=10,
    json={"project_name": sql_name, "organization": "기관", "status": "감리"})
if r_sql.status_code == 201:
    sql_id = r_sql.json().get("id")
    # DB 목록이 정상 반환되면 SQL 인젝션 차단됨
    r_check = requests.get(f"{BASE_URL}/api/v1/entities/projects?limit=1", headers=hdr(), timeout=10)
    record("FT-09-04", "SQL 인젝션 차단 (ORM 파라미터화 쿼리)", r_check.status_code==200,
           f"DB 무결성 유지: {r_check.json().get('total','?')}건")
    requests.delete(f"{BASE_URL}/api/v1/entities/projects/{sql_id}", headers=hdr(), timeout=5)


# ══════════════════════════════════════════════
# FT-10: 배치 API 시나리오
# ══════════════════════════════════════════════
print("\n" + "="*60)
print("FT-10: 배치 API 시나리오")
print("="*60)

# FT-10-01: 배치 프로젝트 생성
r_batch = requests.post(f"{BASE_URL}/api/v1/entities/projects/batch", headers=hdr(), timeout=15,
    json={"items": [
        {"project_name": f"[FT배치]{i}", "organization": "배치기관", "status": "감리"}
        for i in range(3)
    ]})
batch_ids = [it["id"] for it in r_batch.json()] if r_batch.status_code==201 else []
record("FT-10-01", "배치 프로젝트 3건 생성", r_batch.status_code==201 and len(batch_ids)==3,
       f"status={r_batch.status_code}, ids={batch_ids}")

# FT-10-02: 배치 상태 업데이트
if batch_ids:
    r_bu = requests.put(f"{BASE_URL}/api/v1/entities/projects/batch", headers=hdr(), timeout=15,
        json={"items": [{"id": i, "updates": {"status": "확정"}} for i in batch_ids]})
    ok_bu = r_bu.status_code==200 and all(it.get("status")=="확정" for it in r_bu.json())
    record("FT-10-02", "배치 상태 업데이트 (감리→확정)", ok_bu,
           f"status={r_bu.status_code}, all=확정: {ok_bu}")

# FT-10-03: 배치 삭제
if batch_ids:
    r_bd = requests.delete(f"{BASE_URL}/api/v1/entities/projects/batch", headers=hdr(), timeout=15,
        json={"ids": batch_ids})
    record("FT-10-03", "배치 프로젝트 삭제", r_bd.status_code in (200,204),
           f"status={r_bd.status_code}")


# ══════════════════════════════════════════════
# 최종 결과 요약
# ══════════════════════════════════════════════
total = pass_count + fail_count + warn_count
print("\n" + "="*60)
print("📊 기능 테스트 최종 결과 요약")
print("="*60)
print(f"  전체: {total}건")
print(f"  ✅ PASS: {pass_count}건 ({pass_count/total*100:.0f}%)")
print(f"  ⚠️  WARN: {warn_count}건 ({warn_count/total*100:.0f}%)")
print(f"  ❌ FAIL: {fail_count}건 ({fail_count/total*100:.0f}%)")

if fail_count > 0:
    print("\n❌ 실패 항목:")
    for r_ in results:
        if r_["status"] == "FAIL":
            print(f"  - [{r_['id']}] {r_['name']}: {r_['detail']}")

if warn_count > 0:
    print("\n⚠️  경고 항목:")
    for r_ in results:
        if r_["status"] == "WARN":
            print(f"  - [{r_['id']}] {r_['name']}: {r_['detail']}")

print("\n" + "="*60)

# 결과 저장
import json
with open("/home/user/webapp/functional_test_results.json", "w", encoding="utf-8") as f:
    json.dump({
        "run_at": datetime.now(timezone.utc).isoformat(),
        "base_url": BASE_URL,
        "summary": {"total": total, "pass": pass_count, "warn": warn_count, "fail": fail_count},
        "results": results
    }, f, ensure_ascii=False, indent=2)
print(f"결과 저장: /home/user/webapp/functional_test_results.json")

sys.exit(0 if fail_count == 0 else 1)
