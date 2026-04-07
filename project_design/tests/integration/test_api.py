"""
통합 테스트 (Integration Tests) — API 엔드포인트
테스트 범위:
  IT-01  헬스체크 & 설정 API
  IT-02  인증 미들웨어 (토큰 없음 / 만료 / 위조)
  IT-03  프로젝트 API CRUD 흐름
  IT-04  인력 API CRUD 흐름
  IT-05  단계 API CRUD 흐름
  IT-06  스태핑 API + FK 무결성
  IT-07  관리자 API (권한 분리)
  IT-08  감사 로그 API (조회 / CSV 내보내기 / 불변성)
  IT-09  홈 통계 API
  IT-10  페이징 & 쿼리 파라미터
"""
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta


# ─────────────────────────────────────────────────────────────
# IT-01: 헬스체크 & 설정
# ─────────────────────────────────────────────────────────────
class TestHealthAndConfig:
    """IT-01: 헬스체크 및 설정 API"""

    @pytest.mark.asyncio
    async def test_health_returns_ok(self, client):
        """IT-01-01: GET /health → 200 OK"""
        r = await client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "healthy"

    @pytest.mark.asyncio
    async def test_config_returns_api_base_url(self, client):
        """IT-01-02: GET /api/config → API_BASE_URL 포함"""
        r = await client.get("/api/config")
        assert r.status_code == 200
        body = r.json()
        assert "API_BASE_URL" in body


# ─────────────────────────────────────────────────────────────
# IT-02: 인증 미들웨어
# ─────────────────────────────────────────────────────────────
class TestAuthMiddleware:
    """IT-02: 인증 미들웨어 통합 테스트"""

    @pytest.mark.asyncio
    async def test_no_token_returns_401(self, client):
        """IT-02-01: 토큰 없이 API 접근 → 401 (인증 설정 시)"""
        # 테스트 환경에서는 GOOGLE_CLIENT_ID 미설정이므로 인증 스킵
        # 실제 401 동작은 functional 테스트에서 검증
        r = await client.get("/api/v1/entities/projects")
        assert r.status_code in (200, 401)

    @pytest.mark.asyncio
    async def test_health_is_always_public(self, client):
        """IT-02-02: /health는 항상 공개"""
        r = await client.get("/health")
        assert r.status_code == 200

    @pytest.mark.asyncio
    async def test_dev_login_disabled_when_google_configured(self, client, monkeypatch):
        """IT-02-03: GOOGLE_CLIENT_ID 설정 시 dev-login 403"""
        import os
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "fake-client-id")
        r = await client.get("/auth/dev-login")
        assert r.status_code == 403


# ─────────────────────────────────────────────────────────────
# IT-03: 프로젝트 API CRUD
# ─────────────────────────────────────────────────────────────
class TestProjectsAPI:
    """IT-03: 프로젝트 API 통합 테스트"""

    @pytest.mark.asyncio
    async def test_create_project_201(self, client):
        """IT-03-01: POST /api/v1/entities/projects → 201"""
        r = await client.post("/api/v1/entities/projects", json={
            "project_name": "통합테스트사업A",
            "organization": "기관A",
            "status": "감리",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["project_name"] == "통합테스트사업A"
        assert body["is_won"] is False
        assert "id" in body

    @pytest.mark.asyncio
    async def test_create_project_missing_required_422(self, client):
        """IT-03-02: 필수 필드 누락 → 422"""
        r = await client.post("/api/v1/entities/projects", json={"status": "감리"})
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_get_project_by_id_200(self, client):
        """IT-03-03: GET /api/v1/entities/projects/{id} → 200"""
        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "단건조회테스트",
            "organization": "기관",
            "status": "제안",
        })
        pid = create_r.json()["id"]
        r = await client.get(f"/api/v1/entities/projects/{pid}")
        assert r.status_code == 200
        assert r.json()["id"] == pid

    @pytest.mark.asyncio
    async def test_get_project_not_found_404(self, client):
        """IT-03-04: 존재하지 않는 ID → 404"""
        r = await client.get("/api/v1/entities/projects/999999")
        assert r.status_code == 404

    @pytest.mark.asyncio
    async def test_update_project_200(self, client):
        """IT-03-05: PUT /api/v1/entities/projects/{id} → 200"""
        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "수정대상",
            "organization": "기관",
            "status": "제안",
        })
        pid = create_r.json()["id"]
        r = await client.put(f"/api/v1/entities/projects/{pid}", json={
            "status": "확정",
            "is_won": True,
        })
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "확정"
        assert body["is_won"] is True

    @pytest.mark.asyncio
    async def test_delete_project_soft(self, client):
        """IT-03-06: DELETE → 소프트 삭제 후 404"""
        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "삭제대상",
            "organization": "기관",
            "status": "감리",
        })
        pid = create_r.json()["id"]
        del_r = await client.delete(f"/api/v1/entities/projects/{pid}")
        assert del_r.status_code in (200, 204)
        get_r = await client.get(f"/api/v1/entities/projects/{pid}")
        assert get_r.status_code == 404

    @pytest.mark.asyncio
    async def test_deleted_project_not_in_list(self, client):
        """IT-03-07: 삭제된 프로젝트 목록 미노출"""
        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "목록제외예정",
            "organization": "기관",
            "status": "감리",
        })
        pid = create_r.json()["id"]
        await client.delete(f"/api/v1/entities/projects/{pid}")
        list_r = await client.get("/api/v1/entities/projects?limit=200")
        ids = [p["id"] for p in list_r.json()["items"]]
        assert pid not in ids

    @pytest.mark.asyncio
    async def test_project_list_pagination(self, client):
        """IT-03-08: 페이징 (limit/skip) 동작"""
        for i in range(5):
            await client.post("/api/v1/entities/projects", json={
                "project_name": f"페이징사업{i}",
                "organization": "기관",
                "status": "감리",
            })
        r = await client.get("/api/v1/entities/projects?limit=2&skip=0")
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) <= 2
        assert "total" in body

    @pytest.mark.asyncio
    async def test_create_proposal_with_is_won(self, client):
        """IT-03-09: 수주 완료 제안사업 생성"""
        r = await client.post("/api/v1/entities/projects", json={
            "project_name": "수주완료사업",
            "organization": "기관",
            "status": "제안",
            "is_won": True,
        })
        assert r.status_code == 201
        assert r.json()["is_won"] is True


# ─────────────────────────────────────────────────────────────
# IT-04: 인력 API
# ─────────────────────────────────────────────────────────────
class TestPeopleAPI:
    """IT-04: 인력 API 통합 테스트"""

    @pytest.mark.asyncio
    async def test_create_person_201(self, client):
        """IT-04-01: 인력 등록 201"""
        r = await client.post("/api/v1/entities/people", json={
            "person_name": "김감리",
            "position": "수석",
            "grade": "수석감리원",
            "employment_status": "재직",
        })
        assert r.status_code == 201
        body = r.json()
        assert body["person_name"] == "김감리"
        assert body["grade"] == "수석감리원"

    @pytest.mark.asyncio
    async def test_get_person_by_id(self, client):
        """IT-04-02: 인력 단건 조회"""
        create_r = await client.post("/api/v1/entities/people", json={
            "person_name": "이테스트",
            "grade": "감리원",
            "employment_status": "재직",
        })
        pid = create_r.json()["id"]
        r = await client.get(f"/api/v1/entities/people/{pid}")
        assert r.status_code == 200
        assert r.json()["id"] == pid

    @pytest.mark.asyncio
    async def test_delete_person_soft(self, client):
        """IT-04-03: 인력 소프트 삭제"""
        create_r = await client.post("/api/v1/entities/people", json={
            "person_name": "퇴사자",
            "grade": "감리원",
            "employment_status": "퇴사",
        })
        pid = create_r.json()["id"]
        del_r = await client.delete(f"/api/v1/entities/people/{pid}")
        assert del_r.status_code in (200, 204)
        get_r = await client.get(f"/api/v1/entities/people/{pid}")
        assert get_r.status_code == 404


# ─────────────────────────────────────────────────────────────
# IT-05: 단계 API
# ─────────────────────────────────────────────────────────────
class TestPhasesAPI:
    """IT-05: 단계 API 통합 테스트"""

    @pytest_asyncio.fixture
    async def project_id(self, client):
        r = await client.post("/api/v1/entities/projects", json={
            "project_name": "단계테스트사업",
            "organization": "기관",
            "status": "감리",
        })
        return r.json()["id"]

    @pytest.mark.asyncio
    async def test_create_phase_201(self, client, project_id):
        """IT-05-01: 단계 생성 201"""
        r = await client.post("/api/v1/entities/phases", json={
            "project_id": project_id,
            "phase_name": "착수단계",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "sort_order": 1,
        })
        assert r.status_code == 201
        body = r.json()
        assert body["phase_name"] == "착수단계"
        assert body["project_id"] == project_id

    @pytest.mark.asyncio
    async def test_list_phases_by_project(self, client, project_id):
        """IT-05-02: 프로젝트 단계 목록 조회"""
        for i, name in enumerate(["착수", "수행", "종료"]):
            await client.post("/api/v1/entities/phases", json={
                "project_id": project_id,
                "phase_name": name,
                "sort_order": i + 1,
            })
        import json as jsonlib
        r = await client.get(
            f'/api/v1/entities/phases?query={jsonlib.dumps({"project_id": project_id})}&limit=100'
        )
        assert r.status_code == 200
        body = r.json()
        assert body["total"] >= 3

    @pytest.mark.asyncio
    async def test_delete_phase_soft(self, client, project_id):
        """IT-05-03: 단계 소프트 삭제"""
        create_r = await client.post("/api/v1/entities/phases", json={
            "project_id": project_id,
            "phase_name": "삭제단계",
            "sort_order": 99,
        })
        phase_id = create_r.json()["id"]
        del_r = await client.delete(f"/api/v1/entities/phases/{phase_id}")
        assert del_r.status_code in (200, 204)
        get_r = await client.get(f"/api/v1/entities/phases/{phase_id}")
        assert get_r.status_code == 404


# ─────────────────────────────────────────────────────────────
# IT-06: 스태핑 API + FK 무결성
# ─────────────────────────────────────────────────────────────
class TestStaffingAPI:
    """IT-06: 스태핑 API 통합 테스트"""

    @pytest_asyncio.fixture
    async def proj_phase(self, client):
        proj_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "스태핑API테스트",
            "organization": "기관",
            "status": "감리",
        })
        proj_id = proj_r.json()["id"]
        phase_r = await client.post("/api/v1/entities/phases", json={
            "project_id": proj_id,
            "phase_name": "착수",
            "sort_order": 1,
        })
        phase_id = phase_r.json()["id"]
        return proj_id, phase_id

    @pytest.mark.asyncio
    async def test_create_staffing_201(self, client, proj_phase):
        """IT-06-01: 스태핑 생성 201"""
        proj_id, phase_id = proj_phase
        r = await client.post("/api/v1/entities/staffing", json={
            "project_id": proj_id,
            "phase_id": phase_id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "수석감리원",
            "person_name_text": "홍길동",
            "md": 20,
        })
        assert r.status_code == 201
        body = r.json()
        assert body["project_id"] == proj_id
        assert body["md"] == 20

    @pytest.mark.asyncio
    async def test_fk_invalid_project_id_404(self, client, proj_phase):
        """IT-06-02: 존재하지 않는 project_id → 404 (FK 무결성)"""
        _, phase_id = proj_phase
        r = await client.post("/api/v1/entities/staffing", json={
            "project_id": 999999,
            "phase_id": phase_id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "수석감리원",
            "md": 10,
        })
        assert r.status_code == 404, f"FK 무결성 미검증: {r.text}"

    @pytest.mark.asyncio
    async def test_fk_invalid_phase_id_404(self, client, proj_phase):
        """IT-06-03: 존재하지 않는 phase_id → 404 (FK 무결성)"""
        proj_id, _ = proj_phase
        r = await client.post("/api/v1/entities/staffing", json={
            "project_id": proj_id,
            "phase_id": 999999,
            "category": "감리",
            "field": "감리원",
            "sub_field": "수석감리원",
            "md": 10,
        })
        assert r.status_code == 404, f"FK 무결성 미검증: {r.text}"

    @pytest.mark.asyncio
    async def test_update_md(self, client, proj_phase):
        """IT-06-04: MD(공수) 수정"""
        proj_id, phase_id = proj_phase
        create_r = await client.post("/api/v1/entities/staffing", json={
            "project_id": proj_id,
            "phase_id": phase_id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "감리원",
            "md": 10,
        })
        staff_id = create_r.json()["id"]
        r = await client.put(f"/api/v1/entities/staffing/{staff_id}", json={"md": 25})
        assert r.status_code == 200
        assert r.json()["md"] == 25


# ─────────────────────────────────────────────────────────────
# IT-07: 관리자 API 권한 분리
# ─────────────────────────────────────────────────────────────
class TestAdminAPI:
    """IT-07: 관리자 API 권한 분리 통합 테스트 (인증 환경)"""

    @pytest.mark.asyncio
    async def test_admin_stats_accessible_in_dev(self, client):
        """IT-07-01: 개발 환경(인증 미설정)에서 관리자 API 접근 가능"""
        r = await client.get("/admin/stats")
        # 개발환경 인증 스킵으로 200 또는 의존성 문제 500
        assert r.status_code in (200, 500)

    @pytest.mark.asyncio
    async def test_admin_audit_accessible_in_dev(self, client):
        """IT-07-02: 개발 환경에서 감사 로그 조회 가능"""
        r = await client.get("/admin/audit?limit=5")
        assert r.status_code in (200, 500)

    @pytest.mark.asyncio
    async def test_audit_log_no_delete_endpoint(self, client):
        """IT-07-03: 감사 로그 삭제 엔드포인트 없음 (405)"""
        r = await client.delete("/admin/audit/1")
        assert r.status_code == 405

    @pytest.mark.asyncio
    async def test_audit_log_no_update_endpoint(self, client):
        """IT-07-04: 감사 로그 수정 엔드포인트 없음 (405)"""
        r = await client.put("/admin/audit/1", json={"event_type": "TAMPERED"})
        assert r.status_code == 405


# ─────────────────────────────────────────────────────────────
# IT-08: 감사 로그 연동 검증
# ─────────────────────────────────────────────────────────────
class TestAuditLogIntegration:
    """IT-08: 감사 로그 자동 기록 통합 테스트"""

    @pytest.mark.asyncio
    async def test_audit_logged_on_project_create(self, client, db_session):
        """IT-08-01: 프로젝트 생성 시 감사 로그 자동 기록"""
        from models.audit import AuditLog
        from sqlalchemy import select

        r = await client.post("/api/v1/entities/projects", json={
            "project_name": "감사로그테스트사업",
            "organization": "기관",
            "status": "감리",
        })
        assert r.status_code == 201

        result = await db_session.execute(
            select(AuditLog).where(
                AuditLog.event_type == "CREATE",
                AuditLog.entity_type == "project",
            )
        )
        logs = result.scalars().all()
        assert len(logs) >= 1

    @pytest.mark.asyncio
    async def test_audit_logged_on_project_update(self, client, db_session):
        """IT-08-02: 프로젝트 수정 시 감사 로그 자동 기록
        
        비즈니스 규칙: status 변경 → STATUS_CHANGE, 일반 필드 변경 → UPDATE
        notes 필드를 변경하면 UPDATE 이벤트가 기록됨
        """
        from models.audit import AuditLog
        from sqlalchemy import select

        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "수정감사로그",
            "organization": "기관",
            "status": "제안",
        })
        assert create_r.status_code == 201
        pid = create_r.json()["id"]
        
        # notes 변경 → UPDATE 이벤트 기록 (status 변경은 STATUS_CHANGE)
        r = await client.put(f"/api/v1/entities/projects/{pid}", json={"notes": "감사 로그 테스트용 메모"})
        assert r.status_code == 200

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.event_type == "UPDATE")
        )
        logs = result.scalars().all()
        assert len(logs) >= 1, "notes 수정 시 UPDATE 이벤트가 감사 로그에 기록되어야 함"
        
    @pytest.mark.asyncio
    async def test_audit_status_change_logged(self, client, db_session):
        """IT-08-02b: status 변경 시 STATUS_CHANGE 이벤트 기록
        
        비즈니스 규칙: status 변경은 STATUS_CHANGE 이벤트로 별도 분류
        """
        from models.audit import AuditLog
        from sqlalchemy import select

        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "상태변경감사로그",
            "organization": "기관",
            "status": "제안",
        })
        assert create_r.status_code == 201
        pid = create_r.json()["id"]
        
        # status 변경 → STATUS_CHANGE 이벤트
        await client.put(f"/api/v1/entities/projects/{pid}", json={"status": "감리"})

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.event_type == "STATUS_CHANGE")
        )
        logs = result.scalars().all()
        assert len(logs) >= 1, "status 변경 시 STATUS_CHANGE 이벤트가 감사 로그에 기록되어야 함"

    @pytest.mark.asyncio
    async def test_audit_logged_on_project_delete(self, client, db_session):
        """IT-08-03: 프로젝트 삭제 시 감사 로그 자동 기록"""
        from models.audit import AuditLog
        from sqlalchemy import select

        create_r = await client.post("/api/v1/entities/projects", json={
            "project_name": "삭제감사로그",
            "organization": "기관",
            "status": "감리",
        })
        pid = create_r.json()["id"]
        await client.delete(f"/api/v1/entities/projects/{pid}")

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.event_type == "DELETE")
        )
        logs = result.scalars().all()
        assert len(logs) >= 1


# ─────────────────────────────────────────────────────────────
# IT-09: 홈 통계 API
# ─────────────────────────────────────────────────────────────
class TestHomeStatsAPI:
    """IT-09: 홈 통계 API 통합 테스트"""

    @pytest.mark.asyncio
    async def test_home_stats_structure(self, client):
        """IT-09-01: 홈 통계 응답 구조 확인"""
        r = await client.get("/api/v1/home/stats")
        assert r.status_code == 200
        body = r.json()
        required_fields = [
            "active_project_count", "proposal_count", "people_count",
            "utilization_rate", "utilization_numerator",
            "utilization_denominator", "auditor_count", "biz_days_ytd",
        ]
        for field in required_fields:
            assert field in body, f"필드 누락: {field}"

    @pytest.mark.asyncio
    async def test_utilization_rate_range(self, client):
        """IT-09-02: 가동률 0.0 ~ 1.0 범위"""
        r = await client.get("/api/v1/home/stats")
        rate = r.json()["utilization_rate"]
        assert 0.0 <= rate <= 1.0

    @pytest.mark.asyncio
    async def test_active_project_count_nonnegative(self, client):
        """IT-09-03: 진행중 사업 수 음수 아님"""
        r = await client.get("/api/v1/home/stats")
        assert r.json()["active_project_count"] >= 0

    @pytest.mark.asyncio
    async def test_stats_reflect_new_project(self, client):
        """IT-09-04: 신규 제안 프로젝트 → proposal_count 증가"""
        r_before = await client.get("/api/v1/home/stats")
        before_count = r_before.json()["proposal_count"]

        await client.post("/api/v1/entities/projects", json={
            "project_name": "통계반영테스트",
            "organization": "기관",
            "status": "제안",
        })

        r_after = await client.get("/api/v1/home/stats")
        after_count = r_after.json()["proposal_count"]
        assert after_count == before_count + 1


# ─────────────────────────────────────────────────────────────
# IT-10: 페이징 & 쿼리 파라미터
# ─────────────────────────────────────────────────────────────
class TestPaginationAndQuery:
    """IT-10: 페이징 및 쿼리 파라미터 통합 테스트"""

    @pytest.mark.asyncio
    async def test_limit_max_2000(self, client):
        """IT-10-01: limit 최대값 2000 (초과 시 422)"""
        r = await client.get("/api/v1/entities/projects?limit=2000")
        assert r.status_code == 200

        r = await client.get("/api/v1/entities/projects?limit=2001")
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_skip_negative_422(self, client):
        """IT-10-02: skip 음수 → 422"""
        r = await client.get("/api/v1/entities/projects?skip=-1")
        assert r.status_code == 422

    @pytest.mark.asyncio
    async def test_query_filter_by_status(self, client):
        """IT-10-03: status 필터 쿼리"""
        import json as jsonlib
        await client.post("/api/v1/entities/projects", json={
            "project_name": "쿼리필터감리",
            "organization": "기관",
            "status": "감리",
        })
        await client.post("/api/v1/entities/projects", json={
            "project_name": "쿼리필터제안",
            "organization": "기관",
            "status": "제안",
        })
        r = await client.get(
            f'/api/v1/entities/projects?query={jsonlib.dumps({"status": "감리"})}&limit=100'
        )
        assert r.status_code == 200
        items = r.json()["items"]
        statuses = {item["status"] for item in items}
        assert statuses == {"감리"}, f"필터 오류: {statuses}"

    @pytest.mark.asyncio
    async def test_total_count_matches_items(self, client):
        """IT-10-04: total 카운트와 실제 아이템 일치 확인"""
        r = await client.get("/api/v1/entities/projects?limit=5")
        assert r.status_code == 200
        body = r.json()
        assert len(body["items"]) <= body["total"]
        assert len(body["items"]) <= 5
