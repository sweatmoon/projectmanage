"""
단위 테스트 (Unit Tests) — 서비스 레이어
테스트 범위:
  UT-01  ProjectsService CRUD
  UT-02  PeopleService CRUD + 소프트 삭제
  UT-03  PhasesService CRUD + project_id 연관
  UT-04  StaffingService CRUD + FK 무결성
  UT-05  AuditService write_audit_log
  UT-06  JWT 유틸 (생성 / 검증 / 만료)
  UT-07  보안 헤더 유틸
  UT-08  입력 유효성 (Pydantic 스키마)
"""
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta, date


# ─────────────────────────────────────────────────────────────
# UT-01: ProjectsService
# ─────────────────────────────────────────────────────────────
class TestProjectsService:
    """UT-01: 프로젝트 서비스 단위 테스트"""

    @pytest.mark.asyncio
    async def test_create_project(self, db_session):
        """UT-01-01: 프로젝트 생성"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        data = {
            "project_name": "단위테스트사업",
            "organization": "테스트기관",
            "status": "감리",
            "is_won": False,
        }
        obj = await svc.create(data)
        assert obj is not None
        assert obj.id is not None
        assert obj.project_name == "단위테스트사업"
        assert obj.status == "감리"
        assert obj.is_won is False
        assert obj.deleted_at is None

    @pytest.mark.asyncio
    async def test_get_project_by_id(self, db_session):
        """UT-01-02: ID로 프로젝트 조회"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        created = await svc.create({
            "project_name": "조회테스트",
            "organization": "기관A",
            "status": "제안",
            "is_won": False,
        })
        fetched = await svc.get_by_id(created.id)
        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.project_name == "조회테스트"

    @pytest.mark.asyncio
    async def test_get_nonexistent_project(self, db_session):
        """UT-01-03: 존재하지 않는 ID 조회 시 None 반환"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        result = await svc.get_by_id(999999)
        assert result is None

    @pytest.mark.asyncio
    async def test_update_project(self, db_session):
        """UT-01-04: 프로젝트 수정"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        created = await svc.create({
            "project_name": "수정전",
            "organization": "기관",
            "status": "제안",
            "is_won": False,
        })
        updated = await svc.update(created.id, {
            "project_name": "수정후",
            "status": "감리",
            "is_won": True,
        })
        assert updated.project_name == "수정후"
        assert updated.status == "감리"
        assert updated.is_won is True

    @pytest.mark.asyncio
    async def test_soft_delete_project(self, db_session):
        """UT-01-05: 소프트 삭제 (deleted_at 설정, 조회 불가)"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        created = await svc.create({
            "project_name": "삭제대상",
            "organization": "기관",
            "status": "감리",
            "is_won": False,
        })
        result = await svc.delete(created.id)
        assert result is True
        # 삭제 후 get_by_id는 None 반환
        fetched = await svc.get_by_id(created.id)
        assert fetched is None

    @pytest.mark.asyncio
    async def test_list_excludes_deleted(self, db_session):
        """UT-01-06: 목록에서 삭제된 항목 미포함"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        p1 = await svc.create({"project_name": "활성", "organization": "기관", "status": "감리", "is_won": False})
        p2 = await svc.create({"project_name": "삭제됨", "organization": "기관", "status": "감리", "is_won": False})
        await svc.delete(p2.id)
        result = await svc.get_list(limit=100)
        ids = [item.id for item in result["items"]]
        assert p1.id in ids
        assert p2.id not in ids

    @pytest.mark.asyncio
    async def test_is_won_field(self, db_session):
        """UT-01-07: is_won 필드 기본값 False, 수주 상태 변경"""
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        p = await svc.create({
            "project_name": "수주테스트",
            "organization": "기관",
            "status": "제안",
            "is_won": False,
        })
        assert p.is_won is False
        updated = await svc.update(p.id, {"is_won": True})
        assert updated.is_won is True


# ─────────────────────────────────────────────────────────────
# UT-02: PeopleService
# ─────────────────────────────────────────────────────────────
class TestPeopleService:
    """UT-02: 인력 서비스 단위 테스트"""

    @pytest.mark.asyncio
    async def test_create_person(self, db_session):
        """UT-02-01: 인력 등록"""
        from services.people import PeopleService
        svc = PeopleService(db_session)
        obj = await svc.create({
            "person_name": "홍길동",
            "position": "수석",
            "grade": "수석감리원",
            "employment_status": "재직",
        })
        assert obj.id is not None
        assert obj.person_name == "홍길동"
        assert obj.grade == "수석감리원"

    @pytest.mark.asyncio
    async def test_soft_delete_person(self, db_session):
        """UT-02-02: 인력 소프트 삭제"""
        from services.people import PeopleService
        svc = PeopleService(db_session)
        p = await svc.create({
            "person_name": "삭제예정자",
            "position": "책임",
            "grade": "감리원",
            "employment_status": "재직",
        })
        await svc.delete(p.id)
        fetched = await svc.get_by_id(p.id)
        assert fetched is None

    @pytest.mark.asyncio
    async def test_list_people_pagination(self, db_session):
        """UT-02-03: 인력 목록 페이징"""
        from services.people import PeopleService
        svc = PeopleService(db_session)
        for i in range(5):
            await svc.create({
                "person_name": f"인력{i}",
                "position": "선임",
                "grade": "감리원",
                "employment_status": "재직",
            })
        result = await svc.get_list(skip=0, limit=3)
        assert len(result["items"]) == 3
        assert result["total"] >= 5


# ─────────────────────────────────────────────────────────────
# UT-03: PhasesService
# ─────────────────────────────────────────────────────────────
class TestPhasesService:
    """UT-03: 단계 서비스 단위 테스트"""

    @pytest_asyncio.fixture
    async def sample_project(self, db_session):
        from services.projects import ProjectsService
        svc = ProjectsService(db_session)
        return await svc.create({
            "project_name": "페이즈테스트사업",
            "organization": "기관",
            "status": "감리",
            "is_won": False,
        })

    @pytest.mark.asyncio
    async def test_create_phase(self, db_session, sample_project):
        """UT-03-01: 단계 생성"""
        from services.phases import PhasesService
        svc = PhasesService(db_session)
        phase = await svc.create({
            "project_id": sample_project.id,
            "phase_name": "착수",
            "start_date": date(2026, 1, 1),
            "end_date": date(2026, 3, 31),
            "sort_order": 1,
        })
        assert phase.id is not None
        assert phase.project_id == sample_project.id
        assert phase.phase_name == "착수"

    @pytest.mark.asyncio
    async def test_phase_date_range(self, db_session, sample_project):
        """UT-03-02: 단계 날짜 범위 저장"""
        from services.phases import PhasesService
        svc = PhasesService(db_session)
        phase = await svc.create({
            "project_id": sample_project.id,
            "phase_name": "중간",
            "start_date": date(2026, 4, 1),
            "end_date": date(2026, 6, 30),
            "sort_order": 2,
        })
        assert phase.start_date == date(2026, 4, 1)
        assert phase.end_date == date(2026, 6, 30)

    @pytest.mark.asyncio
    async def test_list_phases_by_project(self, db_session, sample_project):
        """UT-03-03: 프로젝트별 단계 목록 조회"""
        from services.phases import PhasesService
        svc = PhasesService(db_session)
        for i, name in enumerate(["착수", "중간", "최종"]):
            await svc.create({
                "project_id": sample_project.id,
                "phase_name": name,
                "sort_order": i + 1,
            })
        result = await svc.get_list(
            query_dict={"project_id": sample_project.id},
            limit=100,
        )
        assert result["total"] == 3


# ─────────────────────────────────────────────────────────────
# UT-04: StaffingService
# ─────────────────────────────────────────────────────────────
class TestStaffingService:
    """UT-04: 스태핑 서비스 단위 테스트"""

    @pytest_asyncio.fixture
    async def project_and_phase(self, db_session):
        from services.projects import ProjectsService
        from services.phases import PhasesService
        proj = await ProjectsService(db_session).create({
            "project_name": "스태핑테스트",
            "organization": "기관",
            "status": "감리",
            "is_won": False,
        })
        phase = await PhasesService(db_session).create({
            "project_id": proj.id,
            "phase_name": "착수",
            "sort_order": 1,
        })
        return proj, phase

    @pytest.mark.asyncio
    async def test_create_staffing(self, db_session, project_and_phase):
        """UT-04-01: 스태핑 생성"""
        from services.staffing import StaffingService
        proj, phase = project_and_phase
        svc = StaffingService(db_session)
        staff = await svc.create({
            "project_id": proj.id,
            "phase_id": phase.id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "수석감리원",
            "person_name_text": "홍길동",
            "md": 20,
        })
        assert staff.id is not None
        assert staff.project_id == proj.id
        assert staff.md == 20

    @pytest.mark.asyncio
    async def test_soft_delete_staffing(self, db_session, project_and_phase):
        """UT-04-02: 스태핑 소프트 삭제"""
        from services.staffing import StaffingService
        proj, phase = project_and_phase
        svc = StaffingService(db_session)
        staff = await svc.create({
            "project_id": proj.id,
            "phase_id": phase.id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "수석감리원",
            "md": 10,
        })
        result = await svc.delete(staff.id)
        assert result is True
        fetched = await svc.get_by_id(staff.id)
        assert fetched is None

    @pytest.mark.asyncio
    async def test_update_md(self, db_session, project_and_phase):
        """UT-04-03: MD(공수) 수정"""
        from services.staffing import StaffingService
        proj, phase = project_and_phase
        svc = StaffingService(db_session)
        staff = await svc.create({
            "project_id": proj.id,
            "phase_id": phase.id,
            "category": "감리",
            "field": "감리원",
            "sub_field": "감리원",
            "md": 15,
        })
        updated = await svc.update(staff.id, {"md": 30})
        assert updated.md == 30


# ─────────────────────────────────────────────────────────────
# UT-05: AuditService
# ─────────────────────────────────────────────────────────────
class TestAuditService:
    """UT-05: 감사 로그 서비스 단위 테스트"""

    @pytest.mark.asyncio
    async def test_write_audit_log_create(self, db_session):
        """UT-05-01: CREATE 이벤트 감사 로그 기록"""
        from services.audit_service import write_audit_log, EventType, EntityType
        from models.audit import AuditLog
        from sqlalchemy import select

        await write_audit_log(
            db_session,
            event_type=EventType.CREATE,
            entity_type=EntityType.PROJECT,
            entity_id=1,
            project_id=1,
            after_obj={"project_name": "테스트", "status": "감리"},
            user_id="test_user",
            user_name="테스트유저",
            user_role="admin",
        )
        await db_session.commit()

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.event_type == "CREATE")
        )
        logs = result.scalars().all()
        assert len(logs) >= 1
        assert logs[0].entity_type == "project"

    @pytest.mark.asyncio
    async def test_write_audit_log_update_with_diff(self, db_session):
        """UT-05-02: UPDATE 이벤트 diff (변경 전/후) 기록"""
        from services.audit_service import write_audit_log, EventType, EntityType
        from models.audit import AuditLog
        from sqlalchemy import select
        import json

        await write_audit_log(
            db_session,
            event_type=EventType.UPDATE,
            entity_type=EntityType.PROJECT,
            entity_id=2,
            before_obj={"project_name": "변경전", "status": "제안"},
            after_obj={"project_name": "변경후", "status": "감리"},
            user_id="test_user",
        )
        await db_session.commit()

        result = await db_session.execute(
            select(AuditLog).where(AuditLog.event_type == "UPDATE")
        )
        logs = result.scalars().all()
        assert len(logs) >= 1
        log = logs[0]
        assert log.before_data is not None
        assert log.after_data is not None

    @pytest.mark.asyncio
    async def test_audit_log_immutable_no_delete_api(self, db_session):
        """UT-05-03: 감사 로그 직접 삭제 불가 (서비스 레이어에 삭제 함수 없음)"""
        from services import audit_service
        # audit_service에 delete 함수가 없어야 함
        assert not hasattr(audit_service, "delete_audit_log"), \
            "감사 로그 삭제 API가 존재하면 안 됩니다"


# ─────────────────────────────────────────────────────────────
# UT-06: JWT 유틸
# ─────────────────────────────────────────────────────────────
class TestJWTUtils:
    """UT-06: JWT 생성/검증/만료 단위 테스트"""

    def test_create_and_decode_token(self):
        """UT-06-01: JWT 생성 및 정상 디코딩"""
        from jose import jwt
        secret = "test-secret-key-for-unit-tests-only"
        now = datetime.now(timezone.utc)
        payload = {
            "sub": "user_001",
            "role": "admin",
            "iat": now,
            "exp": now + timedelta(hours=8),
        }
        token = jwt.encode(payload, secret, algorithm="HS256")
        decoded = jwt.decode(token, secret, algorithms=["HS256"])
        assert decoded["sub"] == "user_001"
        assert decoded["role"] == "admin"

    def test_expired_token_raises(self):
        """UT-06-02: 만료된 JWT는 예외 발생"""
        from jose import jwt, ExpiredSignatureError
        secret = "test-secret-key-for-unit-tests-only"
        now = datetime.now(timezone.utc)
        expired_payload = {
            "sub": "user_001",
            "iat": now - timedelta(hours=10),
            "exp": now - timedelta(hours=2),
        }
        token = jwt.encode(expired_payload, secret, algorithm="HS256")
        with pytest.raises(Exception):
            jwt.decode(token, secret, algorithms=["HS256"])

    def test_wrong_secret_raises(self):
        """UT-06-03: 잘못된 시크릿으로 디코딩 시 예외 발생"""
        from jose import jwt, JWTError
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {"sub": "user", "exp": now + timedelta(hours=1)},
            "correct-secret",
            algorithm="HS256"
        )
        with pytest.raises(Exception):
            jwt.decode(token, "wrong-secret", algorithms=["HS256"])

    def test_role_in_token(self):
        """UT-06-04: role 클레임 정상 포함 확인"""
        from jose import jwt
        secret = "test-secret-key-for-unit-tests-only"
        now = datetime.now(timezone.utc)
        for role in ["admin", "user", "viewer"]:
            token = jwt.encode(
                {"sub": "u", "role": role, "exp": now + timedelta(hours=1)},
                secret,
                algorithm="HS256"
            )
            decoded = jwt.decode(token, secret, algorithms=["HS256"])
            assert decoded["role"] == role


# ─────────────────────────────────────────────────────────────
# UT-07: 보안 헤더 미들웨어
# ─────────────────────────────────────────────────────────────
class TestSecurityHeaders:
    """UT-07: HTTP 보안 헤더 단위 테스트"""

    @pytest.mark.asyncio
    async def test_security_headers_present(self, client):
        """UT-07-01: 응답에 보안 헤더 포함 확인"""
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.headers.get("x-frame-options") == "SAMEORIGIN"
        assert response.headers.get("x-content-type-options") == "nosniff"
        assert response.headers.get("x-xss-protection") == "1; mode=block"
        assert "max-age=31536000" in response.headers.get("strict-transport-security", "")
        assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
        assert response.headers.get("content-security-policy") is not None
        assert response.headers.get("permissions-policy") is not None

    @pytest.mark.asyncio
    async def test_csp_includes_self(self, client):
        """UT-07-02: CSP에 'self' 포함 확인"""
        response = await client.get("/health")
        csp = response.headers.get("content-security-policy", "")
        assert "'self'" in csp


# ─────────────────────────────────────────────────────────────
# UT-08: Pydantic 입력 유효성
# ─────────────────────────────────────────────────────────────
class TestPydanticValidation:
    """UT-08: Pydantic 스키마 입력 유효성 테스트"""

    def test_project_required_fields(self):
        """UT-08-01: 필수 필드 누락 시 ValidationError"""
        from pydantic import ValidationError
        from routers.projects import ProjectsData
        with pytest.raises(ValidationError):
            ProjectsData(status="감리")  # project_name, organization 누락

    def test_project_is_won_default(self):
        """UT-08-02: is_won 기본값 False"""
        from routers.projects import ProjectsData
        p = ProjectsData(project_name="테스트", organization="기관", status="감리")
        assert p.is_won is False

    def test_phase_data_validation(self):
        """UT-08-03: phase_name 필수 확인"""
        from pydantic import ValidationError
        from routers.phases import PhasesData
        with pytest.raises(ValidationError):
            PhasesData(project_id=1, sort_order=1)  # phase_name 누락

    def test_staffing_required_fields(self):
        """UT-08-04: 스태핑 필수 필드 확인"""
        from pydantic import ValidationError
        from routers.staffing import StaffingData
        with pytest.raises(ValidationError):
            StaffingData(project_id=1)  # phase_id, category, field, sub_field 누락
