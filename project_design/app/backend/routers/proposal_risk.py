"""
제안일정 리스크 분석 API
GET /api/v1/proposal-risk/list   → 제안사업 목록 + 리스크 요약
GET /api/v1/proposal-risk/{id}   → 특정 제안사업 상세 리스크 분석

리스크 유형:
  1. schedule_conflict   - 인력 일정 중복 (전체, 감리/제안 구분 없이)
  2. chief_overload      - 총괄감리원(is_chief=True) 동일 제안사업에 3명 이상
  3. chief_role_conflict - is_chief 인력이 다른 사업(감리/제안)에서도 총괄로 날짜 겹침
  4. org_duplicate       - 동일 기관 사업과 날짜 겹침 (감리↔제안, 제안↔제안)
"""
import logging
from datetime import date
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.projects import Projects
from models.phases import Phases
from models.staffing import Staffing
from models.people import People

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/proposal-risk", tags=["proposal-risk"])

CHIEF_OVERLOAD_THRESHOLD = 3  # 총괄 N명 이상이면 과다 투입


# ── 날짜 겹침 헬퍼 ────────────────────────────────────────────────────────────
def _dates_overlap(s1: Optional[date], e1: Optional[date],
                   s2: Optional[date], e2: Optional[date]) -> bool:
    """두 날짜 구간이 1일이라도 겹치면 True. None이 있으면 False."""
    if not all([s1, e1, s2, e2]):
        return False
    return s1 <= e2 and s2 <= e1


def _overlap_range(s1: date, e1: date, s2: date, e2: date):
    """겹치는 구간 반환 (start, end)"""
    start = max(s1, s2)
    end = min(e1, e2)
    return start, end


# ── 공통 데이터 로드 ──────────────────────────────────────────────────────────
async def _load_all(db: AsyncSession):
    projects_res = await db.execute(
        select(Projects).where(Projects.deleted_at.is_(None))
    )
    projects = projects_res.scalars().all()

    phases_res = await db.execute(
        select(Phases).where(Phases.deleted_at.is_(None))
    )
    phases = phases_res.scalars().all()

    staffing_res = await db.execute(
        select(Staffing).where(Staffing.deleted_at.is_(None))
    )
    staffings = staffing_res.scalars().all()

    people_res = await db.execute(
        select(People).where(People.deleted_at.is_(None))
    )
    peoples = people_res.scalars().all()

    return projects, phases, staffings, peoples


def _project_date_range(project_id: int, phases: list):
    """프로젝트의 전체 날짜 범위 (phases 중 가장 빠른 start ~ 가장 늦은 end)"""
    proj_phases = [p for p in phases if p.project_id == project_id
                   and p.start_date and p.end_date]
    if not proj_phases:
        return None, None
    return min(p.start_date for p in proj_phases), max(p.end_date for p in proj_phases)


def _person_display(person_id: Optional[int], person_name_text: Optional[str],
                    people_map: Dict[int, Any]) -> str:
    if person_id and person_id in people_map:
        return people_map[person_id].person_name
    return person_name_text or "미배정"


# ── 리스크 분석 핵심 로직 ─────────────────────────────────────────────────────
def _analyze_risks(
    target_project: Projects,
    all_projects: list,
    phases: list,
    staffings: list,
    people_map: Dict[int, Any],
) -> List[Dict]:
    risks = []

    # 대상 제안사업의 날짜 범위
    t_start, t_end = _project_date_range(target_project.id, phases)

    # 대상 사업의 staffing
    t_staffings = [s for s in staffings if s.project_id == target_project.id]

    # 대상 사업의 person_id 목록 (배정된 인력)
    t_person_ids = {s.person_id for s in t_staffings if s.person_id}

    # ── 리스크 ① 인력 일정 중복 (전체) ──────────────────────────────────────
    conflict_items = []
    for person_id in t_person_ids:
        person = people_map.get(person_id)
        person_name = person.person_name if person else f"ID:{person_id}"

        # 이 인력이 배정된 다른 모든 사업 확인 (감리+제안 구분 없이)
        for other_proj in all_projects:
            if other_proj.id == target_project.id:
                continue

            # 다른 사업에 이 인력이 있는지
            other_staffings_with_person = [
                s for s in staffings
                if s.project_id == other_proj.id and s.person_id == person_id
            ]
            if not other_staffings_with_person:
                continue

            # 날짜 범위 겹침 확인
            o_start, o_end = _project_date_range(other_proj.id, phases)
            if _dates_overlap(t_start, t_end, o_start, o_end):
                ov_start, ov_end = _overlap_range(t_start, t_end, o_start, o_end)
                conflict_items.append({
                    "person_name": person_name,
                    "is_chief": person.is_chief if person else False,
                    "other_project_id": other_proj.id,
                    "other_project_name": other_proj.project_name,
                    "other_project_status": other_proj.status,
                    "overlap_start": str(ov_start),
                    "overlap_end": str(ov_end),
                })

    if conflict_items:
        # 중복 제거 (같은 인력-사업 조합)
        seen = set()
        unique_conflicts = []
        for c in conflict_items:
            key = (c["person_name"], c["other_project_id"])
            if key not in seen:
                seen.add(key)
                unique_conflicts.append(c)

        chief_conflicts = [c for c in unique_conflicts if c["is_chief"]]
        normal_conflicts = [c for c in unique_conflicts if not c["is_chief"]]

        # 심각도: 총괄 인력 중복이면 danger, 일반이면 warning
        severity = "danger" if chief_conflicts else "warning"
        count = len(unique_conflicts)

        reasons = []
        suggestions = []
        for c in unique_conflicts[:5]:  # 최대 5건 표시
            role_tag = " [총괄]" if c["is_chief"] else ""
            reasons.append(
                f"{c['person_name']}{role_tag} → '{c['other_project_name']}'({c['other_project_status']}) "
                f"{c['overlap_start']} ~ {c['overlap_end']} 겹침"
            )
        if count > 5:
            reasons.append(f"외 {count - 5}건 추가 중복")

        suggestions.append("중복 인력을 대체 가능한 인력으로 교체 검토")
        if t_start and t_end:
            suggestions.append(f"본 사업 일정을 타 사업 종료 후로 조정 검토")
        if chief_conflicts:
            suggestions.append("총괄감리원 중복은 수행 품질에 직접 영향 — 최우선 해소 필요")

        risks.append({
            "type": "schedule_conflict",
            "severity": severity,
            "title": "인력 일정 중복",
            "count": count,
            "reasons": reasons,
            "suggestions": suggestions,
            "items": unique_conflicts,
        })

    # ── 리스크 ② 총괄감리원 과다 투입 ───────────────────────────────────────
    chief_in_project = []
    for s in t_staffings:
        if not s.person_id:
            continue
        person = people_map.get(s.person_id)
        if person and person.is_chief:
            # 중복 인력 제거
            if not any(c["person_id"] == s.person_id for c in chief_in_project):
                chief_in_project.append({
                    "person_id": s.person_id,
                    "person_name": person.person_name,
                    "grade": person.grade or "",
                })

    if len(chief_in_project) >= CHIEF_OVERLOAD_THRESHOLD:
        names = ", ".join(c["person_name"] for c in chief_in_project)
        risks.append({
            "type": "chief_overload",
            "severity": "warning",
            "title": "총괄감리원 과다 투입",
            "count": len(chief_in_project),
            "reasons": [
                f"총괄감리원 {len(chief_in_project)}명 배정: {names}",
                f"기준: {CHIEF_OVERLOAD_THRESHOLD}명 이상 시 과다 투입으로 판단",
            ],
            "suggestions": [
                "총괄감리원은 통상 1~2명 적정 — 역할 분담 재검토",
                "일부 인력을 분야별 감리원으로 역할 전환 검토",
            ],
            "items": chief_in_project,
        })

    # ── 리스크 ③ 총괄-총괄 역할 중복 ────────────────────────────────────────
    # 대상 제안사업의 총괄 인력 → 다른 사업에서도 총괄(is_chief)로 날짜 겹침
    chief_role_conflicts = []
    t_chief_ids = {s.person_id for s in t_staffings
                   if s.person_id and people_map.get(s.person_id) and people_map[s.person_id].is_chief}

    for person_id in t_chief_ids:
        person = people_map[person_id]
        for other_proj in all_projects:
            if other_proj.id == target_project.id:
                continue
            # 다른 사업에서도 총괄로 배정됐는지
            other_chief_staffings = [
                s for s in staffings
                if s.project_id == other_proj.id
                and s.person_id == person_id
            ]
            if not other_chief_staffings:
                continue

            o_start, o_end = _project_date_range(other_proj.id, phases)
            if _dates_overlap(t_start, t_end, o_start, o_end):
                ov_start, ov_end = _overlap_range(t_start, t_end, o_start, o_end)
                chief_role_conflicts.append({
                    "person_name": person.person_name,
                    "other_project_id": other_proj.id,
                    "other_project_name": other_proj.project_name,
                    "other_project_status": other_proj.status,
                    "overlap_start": str(ov_start),
                    "overlap_end": str(ov_end),
                })

    if chief_role_conflicts:
        seen = set()
        unique_crc = []
        for c in chief_role_conflicts:
            key = (c["person_name"], c["other_project_id"])
            if key not in seen:
                seen.add(key)
                unique_crc.append(c)

        reasons = []
        for c in unique_crc[:5]:
            reasons.append(
                f"{c['person_name']} [총괄] → '{c['other_project_name']}'({c['other_project_status']})에서도 총괄 역할, "
                f"{c['overlap_start']} ~ {c['overlap_end']} 겹침"
            )
        if len(unique_crc) > 5:
            reasons.append(f"외 {len(unique_crc) - 5}건 추가")

        risks.append({
            "type": "chief_role_conflict",
            "severity": "danger",
            "title": "총괄감리원 역할 중복",
            "count": len(unique_crc),
            "reasons": reasons,
            "suggestions": [
                "총괄감리원은 동시에 복수 사업 총괄 불가 — 인력 교체 또는 일정 조정 필수",
                "대체 총괄감리원 확보 우선 검토",
            ],
            "items": unique_crc,
        })

    # ── 리스크 ④ 동일 기관 일정 중복 ────────────────────────────────────────
    org = (target_project.organization or "").strip()
    org_conflicts = []
    if org:
        for other_proj in all_projects:
            if other_proj.id == target_project.id:
                continue
            other_org = (other_proj.organization or "").strip()
            if other_org != org:
                continue
            o_start, o_end = _project_date_range(other_proj.id, phases)
            if _dates_overlap(t_start, t_end, o_start, o_end):
                ov_start, ov_end = _overlap_range(t_start, t_end, o_start, o_end)
                org_conflicts.append({
                    "other_project_id": other_proj.id,
                    "other_project_name": other_proj.project_name,
                    "other_project_status": other_proj.status,
                    "overlap_start": str(ov_start),
                    "overlap_end": str(ov_end),
                })

    if org_conflicts:
        reasons = []
        for c in org_conflicts[:5]:
            reasons.append(
                f"'{c['other_project_name']}'({c['other_project_status']})와 동일 기관({org}), "
                f"{c['overlap_start']} ~ {c['overlap_end']} 일정 겹침"
            )
        if len(org_conflicts) > 5:
            reasons.append(f"외 {len(org_conflicts) - 5}건 추가")

        risks.append({
            "type": "org_duplicate",
            "severity": "warning",
            "title": "동일 기관 일정 중복",
            "count": len(org_conflicts),
            "reasons": reasons,
            "suggestions": [
                f"{org} 담당 인력 중복 배정 여부 추가 확인",
                "동일 기관 복수 사업 수행 시 담당 인력 분리 원칙 적용",
                "기관 측 일정 조율 가능 여부 사전 확인 권고",
            ],
            "items": org_conflicts,
        })

    return risks


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────
@router.get("/list")
async def get_proposal_risk_list(db: AsyncSession = Depends(get_db)):
    """제안사업 목록 + 각 사업의 리스크 요약 (건수/심각도)"""
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}

    # 제안 상태인 사업만
    proposal_projects = [p for p in all_projects if p.status == "제안"]

    result = []
    for proj in proposal_projects:
        risks = _analyze_risks(proj, all_projects, phases, staffings, people_map)

        danger_count = sum(1 for r in risks if r["severity"] == "danger")
        warning_count = sum(1 for r in risks if r["severity"] == "warning")

        p_start, p_end = _project_date_range(proj.id, phases)

        result.append({
            "id": proj.id,
            "project_name": proj.project_name,
            "organization": proj.organization,
            "status": proj.status,
            "is_won": proj.is_won,
            "start_date": str(p_start) if p_start else None,
            "end_date": str(p_end) if p_end else None,
            "risk_summary": {
                "danger": danger_count,
                "warning": warning_count,
                "total": danger_count + warning_count,
            },
            "risk_types": [r["type"] for r in risks],
        })

    # 위험 많은 순 정렬
    result.sort(key=lambda x: (
        -x["risk_summary"]["danger"],
        -x["risk_summary"]["warning"],
    ))

    return {"proposals": result, "total": len(result)}


@router.get("/{project_id}")
async def get_proposal_risk_detail(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """특정 제안사업의 상세 리스크 분석"""
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    risks = _analyze_risks(target, all_projects, phases, staffings, people_map)

    p_start, p_end = _project_date_range(project_id, phases)

    # 배정 인력 목록
    t_staffings = [s for s in staffings if s.project_id == project_id]
    assigned_people = []
    seen_ids = set()
    for s in t_staffings:
        if s.person_id and s.person_id not in seen_ids:
            seen_ids.add(s.person_id)
            person = people_map.get(s.person_id)
            if person:
                assigned_people.append({
                    "person_id": person.id,
                    "person_name": person.person_name,
                    "is_chief": person.is_chief or False,
                    "grade": person.grade or "",
                    "can_travel": person.can_travel,
                    "region": person.region or "",
                })

    return {
        "id": target.id,
        "project_name": target.project_name,
        "organization": target.organization,
        "status": target.status,
        "is_won": target.is_won,
        "start_date": str(p_start) if p_start else None,
        "end_date": str(p_end) if p_end else None,
        "assigned_people": assigned_people,
        "risks": risks,
        "risk_summary": {
            "danger": sum(1 for r in risks if r["severity"] == "danger"),
            "warning": sum(1 for r in risks if r["severity"] == "warning"),
            "total": len(risks),
        },
    }
