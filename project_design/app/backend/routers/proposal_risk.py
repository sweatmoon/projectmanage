"""
제안일정 리스크 분석 API
GET /api/v1/proposal-risk/list   → 제안사업 목록 + 리스크 요약
GET /api/v1/proposal-risk/{id}   → 특정 제안사업 상세 리스크 분석

리스크 유형:
  1. schedule_conflict   - 인력 일정 중복 (전체, 감리/제안 구분 없이)
                           * person_id 기반 + person_name_text 이름 매칭 둘 다 탐지
                           * phase 단위 날짜로 상세 겹침 계산
  2. chief_overload      - 총괄감리원(is_chief=True) 동일 제안사업에 3명 이상
  3. chief_role_conflict - is_chief 인력이 다른 사업(감리/제안)에서도 총괄로 날짜 겹침
  4. org_duplicate       - 동일 기관 사업과 날짜 겹침 (감리↔제안, 제안↔제안)
"""
import logging
import re
from datetime import date
from typing import List, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy import select
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


def _overlap_range(s1: date, e1: date, s2: date, e2: date) -> Tuple[date, date]:
    """겹치는 구간 반환 (start, end)"""
    return max(s1, s2), min(e1, e2)


def _overlap_days(s1: date, e1: date, s2: date, e2: date) -> int:
    """겹치는 일수 반환"""
    ov_s, ov_e = _overlap_range(s1, e1, s2, e2)
    return max(0, (ov_e - ov_s).days + 1)


def _norm_name(name: Optional[str]) -> str:
    """이름 정규화: 공백/특수문자 제거, 소문자"""
    if not name:
        return ""
    return re.sub(r"[\s\u200b\u00a0]", "", name).strip()


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


def _project_date_range(project_id: int, phases: list) -> Tuple[Optional[date], Optional[date]]:
    """프로젝트의 전체 날짜 범위 (phases 중 가장 빠른 start ~ 가장 늦은 end)"""
    proj_phases = [p for p in phases if p.project_id == project_id
                   and p.start_date and p.end_date]
    if not proj_phases:
        return None, None
    return min(p.start_date for p in proj_phases), max(p.end_date for p in proj_phases)


def _phase_map(phases: list) -> Dict[int, Any]:
    """phase_id → phase 객체 맵"""
    return {p.id: p for p in phases}


def _resolve_person_key(s: Any, people_map: Dict[int, Any]) -> Tuple[Optional[str], str, bool]:
    """
    staffing 레코드에서 (person_key, display_name, is_chief) 반환.
    person_key: person_id 기반이면 "id:123", 이름 기반이면 "name:홍길동"
    """
    if s.person_id and s.person_id in people_map:
        p = people_map[s.person_id]
        return f"id:{s.person_id}", p.person_name, bool(p.is_chief)
    name_text = (s.person_name_text or "").strip()
    if name_text:
        norm = _norm_name(name_text)
        return f"name:{norm}", name_text, False
    return None, "미배정", False


# ── 인력별 phase 목록 수집 ────────────────────────────────────────────────────
def _build_person_phase_index(
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
    project_map: Dict[int, Any],
) -> Dict[str, List[Dict]]:
    """
    person_key → [
      {
        project_id, project_name, project_status,
        phase_id, phase_name,
        start_date, end_date,
        is_chief, person_name
      }, ...
    ]
    날짜가 있는 phase에 배정된 인력만 수집.
    """
    ph_map = {p.id: p for p in phases}
    index: Dict[str, List[Dict]] = {}

    for s in staffings:
        phase = ph_map.get(s.phase_id)
        if not phase or not phase.start_date or not phase.end_date:
            continue  # 날짜 없는 phase는 스킵

        person_key, person_name, is_chief = _resolve_person_key(s, people_map)
        if not person_key:
            continue

        proj = project_map.get(s.project_id)
        if not proj:
            continue

        entry = {
            "project_id":     proj.id,
            "project_name":   proj.project_name,
            "project_status": proj.status,
            "phase_id":       phase.id,
            "phase_name":     phase.phase_name,
            "start_date":     phase.start_date,
            "end_date":       phase.end_date,
            "is_chief":       is_chief,
            "person_name":    person_name,
        }
        index.setdefault(person_key, []).append(entry)

    return index


# ── 리스크 분석 핵심 로직 ─────────────────────────────────────────────────────
def _analyze_risks(
    target_project: Projects,
    all_projects: list,
    phases: list,
    staffings: list,
    people_map: Dict[int, Any],
) -> List[Dict]:
    risks = []
    project_map = {p.id: p for p in all_projects}

    # 인력별 phase 인덱스 (전체 사업 기준)
    person_phase_index = _build_person_phase_index(
        staffings, phases, people_map, project_map
    )

    # 대상 사업의 phase 목록
    t_phases = [p for p in phases
                if p.project_id == target_project.id
                and p.start_date and p.end_date]

    # 대상 사업의 전체 날짜 범위
    t_start, t_end = _project_date_range(target_project.id, phases)

    # 대상 사업에 배정된 인력 key 목록 수집 (person_id + name_text 모두)
    t_staffings = [s for s in staffings if s.project_id == target_project.id]
    t_person_keys: Dict[str, str] = {}   # key → display_name
    t_person_is_chief: Dict[str, bool] = {}
    for s in t_staffings:
        key, name, is_chief = _resolve_person_key(s, people_map)
        if key:
            t_person_keys[key] = name
            t_person_is_chief[key] = is_chief

    # ── 리스크 ① 인력 일정 중복 (phase 단위 상세) ────────────────────────────
    conflict_items = []   # 상세 중복 정보
    seen_conflict = set() # (person_key, other_project_id, t_phase_id, o_phase_id) 중복 방지

    for person_key, person_name in t_person_keys.items():
        is_chief = t_person_is_chief.get(person_key, False)
        all_entries = person_phase_index.get(person_key, [])

        # 이 인력의 대상 사업 내 phase 들
        my_phases_in_target = [e for e in all_entries
                               if e["project_id"] == target_project.id]
        # 이 인력의 다른 사업 phase 들
        other_phases = [e for e in all_entries
                       if e["project_id"] != target_project.id]

        for t_ph in my_phases_in_target:
            for o_ph in other_phases:
                if not _dates_overlap(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                ):
                    continue

                dedup_key = (person_key, o_ph["project_id"],
                             t_ph["phase_id"], o_ph["phase_id"])
                if dedup_key in seen_conflict:
                    continue
                seen_conflict.add(dedup_key)

                ov_s, ov_e = _overlap_range(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )
                days = _overlap_days(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )

                conflict_items.append({
                    "person_name":          person_name,
                    "is_chief":             is_chief,
                    # 대상 사업 phase 정보
                    "my_phase_name":        t_ph["phase_name"],
                    "my_phase_start":       str(t_ph["start_date"]),
                    "my_phase_end":         str(t_ph["end_date"]),
                    # 충돌 사업 정보
                    "other_project_id":     o_ph["project_id"],
                    "other_project_name":   o_ph["project_name"],
                    "other_project_status": o_ph["project_status"],
                    "other_phase_name":     o_ph["phase_name"],
                    "other_phase_start":    str(o_ph["start_date"]),
                    "other_phase_end":      str(o_ph["end_date"]),
                    # 겹치는 구간
                    "overlap_start":        str(ov_s),
                    "overlap_end":          str(ov_e),
                    "overlap_days":         days,
                })

    if conflict_items:
        chief_conflicts = [c for c in conflict_items if c["is_chief"]]
        severity = "danger" if chief_conflicts else "warning"

        # 인력별로 그룹핑하여 reasons 생성
        by_person: Dict[str, List] = {}
        for c in conflict_items:
            by_person.setdefault(c["person_name"], []).append(c)

        reasons = []
        for pname, items in list(by_person.items())[:5]:
            role_tag = " [총괄]" if items[0]["is_chief"] else ""
            # 같은 인력의 충돌을 사업별로 요약
            by_other: Dict[str, List] = {}
            for it in items:
                by_other.setdefault(it["other_project_name"], []).append(it)
            for other_name, oit in list(by_other.items())[:3]:
                total_days = sum(x["overlap_days"] for x in oit)
                phase_desc = ", ".join(
                    f"{x['my_phase_name']}↔{x['other_phase_name']}" for x in oit[:2]
                )
                if len(oit) > 2:
                    phase_desc += f" 외 {len(oit)-2}건"
                reasons.append(
                    f"{pname}{role_tag} · '{other_name}'({oit[0]['other_project_status']}) "
                    f"[{phase_desc}] {oit[0]['overlap_start']}~{oit[-1]['overlap_end']} ({total_days}일 중복)"
                )
        if len(by_person) > 5:
            reasons.append(f"외 {len(by_person)-5}명 추가 중복")

        suggestions = ["중복 인력을 대체 가능한 인력으로 교체 검토"]
        if t_start and t_end:
            suggestions.append("본 사업 일정을 타 사업 종료 후로 조정 검토")
        if chief_conflicts:
            suggestions.append("총괄감리원 중복은 수행 품질에 직접 영향 — 최우선 해소 필요")

        risks.append({
            "type":        "schedule_conflict",
            "severity":    severity,
            "title":       "인력 일정 중복",
            "count":       len(by_person),   # 중복 인원 수
            "reasons":     reasons,
            "suggestions": suggestions,
            "items":       conflict_items,   # phase 단위 상세 목록
        })

    # ── 리스크 ② 총괄감리원 과다 투입 ───────────────────────────────────────
    chief_in_project = []
    seen_chief = set()
    for s in t_staffings:
        if not s.person_id:
            continue
        person = people_map.get(s.person_id)
        if person and person.is_chief and s.person_id not in seen_chief:
            seen_chief.add(s.person_id)
            chief_in_project.append({
                "person_id":   s.person_id,
                "person_name": person.person_name,
                "grade":       person.grade or "",
            })

    if len(chief_in_project) >= CHIEF_OVERLOAD_THRESHOLD:
        names = ", ".join(c["person_name"] for c in chief_in_project)
        risks.append({
            "type":     "chief_overload",
            "severity": "warning",
            "title":    "총괄감리원 과다 투입",
            "count":    len(chief_in_project),
            "reasons":  [
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
    t_chief_keys = {
        key for key, is_chief in t_person_is_chief.items() if is_chief
    }
    chief_role_conflicts = []
    seen_crc = set()

    for person_key in t_chief_keys:
        person_name = t_person_keys[person_key]
        all_entries = person_phase_index.get(person_key, [])
        my_phases = [e for e in all_entries if e["project_id"] == target_project.id]
        other_phases = [e for e in all_entries if e["project_id"] != target_project.id]

        for t_ph in my_phases:
            for o_ph in other_phases:
                if not _dates_overlap(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                ):
                    continue
                dedup_key = (person_key, o_ph["project_id"],
                             t_ph["phase_id"], o_ph["phase_id"])
                if dedup_key in seen_crc:
                    continue
                seen_crc.add(dedup_key)

                ov_s, ov_e = _overlap_range(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )
                chief_role_conflicts.append({
                    "person_name":          person_name,
                    "other_project_id":     o_ph["project_id"],
                    "other_project_name":   o_ph["project_name"],
                    "other_project_status": o_ph["project_status"],
                    "my_phase_name":        t_ph["phase_name"],
                    "other_phase_name":     o_ph["phase_name"],
                    "overlap_start":        str(ov_s),
                    "overlap_end":          str(ov_e),
                    "overlap_days":         _overlap_days(
                        t_ph["start_date"], t_ph["end_date"],
                        o_ph["start_date"], o_ph["end_date"]
                    ),
                })

    if chief_role_conflicts:
        reasons = []
        by_person: Dict[str, List] = {}
        for c in chief_role_conflicts:
            by_person.setdefault(c["person_name"], []).append(c)
        for pname, items in list(by_person.items())[:5]:
            by_other: Dict[str, List] = {}
            for it in items:
                by_other.setdefault(it["other_project_name"], []).append(it)
            for oname, oit in list(by_other.items())[:3]:
                total_days = sum(x["overlap_days"] for x in oit)
                reasons.append(
                    f"{pname} [총괄] · '{oname}'({oit[0]['other_project_status']}) "
                    f"{oit[0]['overlap_start']}~{oit[-1]['overlap_end']} ({total_days}일 총괄 역할 겹침)"
                )

        risks.append({
            "type":     "chief_role_conflict",
            "severity": "danger",
            "title":    "총괄감리원 역할 중복",
            "count":    len(by_person),
            "reasons":  reasons,
            "suggestions": [
                "총괄감리원은 동시에 복수 사업 총괄 불가 — 인력 교체 또는 일정 조정 필수",
                "대체 총괄감리원 확보 우선 검토",
            ],
            "items": chief_role_conflicts,
        })

    # ── 리스크 ④ 동일 기관 일정 중복 ────────────────────────────────────────
    org = (target_project.organization or "").strip()
    org_conflicts = []
    if org and t_start and t_end:
        for other_proj in all_projects:
            if other_proj.id == target_project.id:
                continue
            other_org = (other_proj.organization or "").strip()
            if other_org != org:
                continue
            o_start, o_end = _project_date_range(other_proj.id, phases)
            if _dates_overlap(t_start, t_end, o_start, o_end):
                ov_s, ov_e = _overlap_range(t_start, t_end, o_start, o_end)
                days = _overlap_days(t_start, t_end, o_start, o_end)
                org_conflicts.append({
                    "other_project_id":     other_proj.id,
                    "other_project_name":   other_proj.project_name,
                    "other_project_status": other_proj.status,
                    "overlap_start":        str(ov_s),
                    "overlap_end":          str(ov_e),
                    "overlap_days":         days,
                })

    if org_conflicts:
        reasons = [
            f"'{c['other_project_name']}'({c['other_project_status']})와 동일 기관({org}), "
            f"{c['overlap_start']}~{c['overlap_end']} ({c['overlap_days']}일 겹침)"
            for c in org_conflicts[:5]
        ]
        if len(org_conflicts) > 5:
            reasons.append(f"외 {len(org_conflicts)-5}건 추가")

        risks.append({
            "type":     "org_duplicate",
            "severity": "warning",
            "title":    "동일 기관 일정 중복",
            "count":    len(org_conflicts),
            "reasons":  reasons,
            "suggestions": [
                f"{org} 담당 인력 중복 배정 여부 추가 확인",
                "동일 기관 복수 사업 수행 시 담당 인력 분리 원칙 적용",
                "기관 측 일정 조율 가능 여부 사전 확인 권고",
            ],
            "items": org_conflicts,
        })

    return risks


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────
@router.get("/debug")
async def get_proposal_risk_debug(db: AsyncSession = Depends(get_db)):
    """디버그: DB 실제 데이터 현황 확인"""
    all_projects, phases, staffings, peoples = await _load_all(db)

    status_counts: Dict[str, int] = {}
    for p in all_projects:
        status_counts[p.status] = status_counts.get(p.status, 0) + 1

    proposal_projects = [p for p in all_projects if p.status == "제안"]

    proposal_detail = []
    for proj in proposal_projects:
        proj_phases = [ph for ph in phases if ph.project_id == proj.id]
        phases_with_dates = [ph for ph in proj_phases if ph.start_date and ph.end_date]
        proj_staffings = [s for s in staffings if s.project_id == proj.id]
        staffings_with_person = [s for s in proj_staffings if s.person_id or s.person_name_text]

        proposal_detail.append({
            "id": proj.id,
            "project_name": proj.project_name,
            "status": proj.status,
            "total_phases": len(proj_phases),
            "phases_with_dates": len(phases_with_dates),
            "total_staffings": len(proj_staffings),
            "staffings_with_person": len(staffings_with_person),
            "phase_list": [
                {
                    "phase_name": ph.phase_name,
                    "start_date": str(ph.start_date) if ph.start_date else None,
                    "end_date": str(ph.end_date) if ph.end_date else None,
                }
                for ph in proj_phases[:5]
            ],
        })

    return {
        "total_projects": len(all_projects),
        "status_breakdown": status_counts,
        "proposal_count": len(proposal_projects),
        "total_phases": len(phases),
        "total_staffings": len(staffings),
        "total_people": len(peoples),
        "proposals": proposal_detail,
    }


@router.get("/list")
async def get_proposal_risk_list(db: AsyncSession = Depends(get_db)):
    """제안사업 목록 + 각 사업의 리스크 요약 (건수/심각도)"""
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}

    proposal_projects = [p for p in all_projects if p.status == "제안"]

    result = []
    for proj in proposal_projects:
        risks = _analyze_risks(proj, all_projects, phases, staffings, people_map)

        danger_count  = sum(1 for r in risks if r["severity"] == "danger")
        warning_count = sum(1 for r in risks if r["severity"] == "warning")
        p_start, p_end = _project_date_range(proj.id, phases)

        result.append({
            "id":           proj.id,
            "project_name": proj.project_name,
            "organization": proj.organization,
            "status":       proj.status,
            "is_won":       proj.is_won,
            "start_date":   str(p_start) if p_start else None,
            "end_date":     str(p_end)   if p_end   else None,
            "risk_summary": {
                "danger":  danger_count,
                "warning": warning_count,
                "total":   danger_count + warning_count,
            },
            "risk_types": [r["type"] for r in risks],
        })

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

    # 배정 인력 목록 (person_id + name_text 통합)
    t_staffings = [s for s in staffings if s.project_id == project_id]
    assigned_people = []
    seen_keys: set = set()
    for s in t_staffings:
        key, name, is_chief = _resolve_person_key(s, people_map)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        person = people_map.get(s.person_id) if s.person_id else None
        assigned_people.append({
            "person_id":   s.person_id,
            "person_name": name,
            "is_chief":    is_chief,
            "grade":       (person.grade  if person else None) or "",
            "can_travel":  (person.can_travel if person else None),
            "region":      (person.region if person else None) or "",
        })

    return {
        "id":              target.id,
        "project_name":    target.project_name,
        "organization":    target.organization,
        "status":          target.status,
        "is_won":          target.is_won,
        "start_date":      str(p_start) if p_start else None,
        "end_date":        str(p_end)   if p_end   else None,
        "assigned_people": assigned_people,
        "risks":           risks,
        "risk_summary": {
            "danger":  sum(1 for r in risks if r["severity"] == "danger"),
            "warning": sum(1 for r in risks if r["severity"] == "warning"),
            "total":   len(risks),
        },
    }
