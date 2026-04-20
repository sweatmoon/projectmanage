"""
제안일정 리스크 분석 API
GET /api/v1/proposal-risk/list          → 제안사업 목록 + 리스크 요약
GET /api/v1/proposal-risk/{id}          → 특정 제안사업 상세 리스크 분석
GET /api/v1/proposal-risk/{id}/schedule → 인력 일정 중복 상세 (본사업 인력 × 비교사업)

리스크 유형:
  1. schedule_conflict   - 인력 일정 중복
  2. chief_overload      - 총괄감리원 동일 제안사업에 N명 이상
  3. chief_role_conflict - 총괄급 인력이 다른 사업에서도 총괄로 날짜 겹침
  4. org_duplicate       - 동일 기관 사업과 날짜 겹침
"""
import logging
import re
from datetime import date
from typing import List, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Depends, Body
from pydantic import BaseModel
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

# 강조 표시할 분야 키워드 (사업관리, 품질보증)
HIGHLIGHT_FIELDS = ["사업관리", "품질보증"]

# ScheduleTab의 TEAM_FIELD_ORDER와 동기화
# 단계감리팀 내 field 정렬 순서
_STAGE_FIELD_ORDER = [
    (re.compile(r"사업관리"), 0),
    (re.compile(r"응용시스템"), 1),
    (re.compile(r"데이터베이스"), 2),
    (re.compile(r"시스템\s*구조.*보안|시스템구조"), 3),
]

_STAGE_CATEGORIES = {"단계감리팀", "감리팀"}
_EXPERT_CATEGORIES = {"전문가팀", "핵심기술", "필수기술", "보안진단", "테스트"}

# 제안사업 전문가팀 카테고리 정렬 순서 (프론트 EXPERT_CATEGORY_ORDER와 동일)
_EXPERT_CATEGORY_ORDER = {
    "핵심기술": 0,
    "필수기술": 1,
    "보안진단": 2,
    "테스트":   3,
}


def _get_sort_key(category: str, field: str, is_proposal: bool = False) -> Tuple[int, int]:
    """
    ScheduleTab resolveTeamInfo 와 동일한 정렬 키 반환.
    반환: (sortGroup, sortOrder)
      단계감리팀 → sortGroup=0,
                   is_proposal=True: sortOrder=0 (staffing.id 로만 결정 → 입력 순서 보존)
                   is_proposal=False: sortOrder= field 순서(0~3, 나머지 4)
      전문가팀   → sortGroup=1, sortOrder= 카테고리 순서(핵심기술=0,필수기술=1,보안진단=2,테스트=3,기타=4)
                   (동일 카테고리 내 id 정렬은 sort_key 4번째 인자 s.id 로 보장)
    """
    cat = (category or "").strip()
    fld = (field or "").strip()

    if cat in _STAGE_CATEGORIES:
        if is_proposal:
            # 제안사업: field 순서 무시, staffing.id 로만 정렬 (sortOrder=0 고정)
            return (0, 0)
        for pattern, order in _STAGE_FIELD_ORDER:
            if pattern.search(fld):
                return (0, order)
        return (0, 4)

    if cat in _EXPERT_CATEGORIES:
        cat_order = _EXPERT_CATEGORY_ORDER.get(cat, 4)
        return (1, cat_order)

    # category 미설정: field로 판단
    if is_proposal:
        return (0, 0)
    for pattern, order in _STAGE_FIELD_ORDER:
        if pattern.search(fld):
            return (0, order)
    return (1, 4)


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
    """이름 정규화: 공백/특수문자 제거"""
    if not name:
        return ""
    return re.sub(r"[\s\u200b\u00a0]", "", name).strip()


def _is_highlight_field(field: Optional[str]) -> bool:
    """사업관리 또는 품질보증 분야 여부"""
    if not field:
        return False
    for kw in HIGHLIGHT_FIELDS:
        if kw in field:
            return True
    return False


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


def _resolve_person_key(s: Any, people_map: Dict[int, Any]) -> Tuple[Optional[str], str, bool, Optional[Any]]:
    """
    staffing 레코드에서 (person_key, display_name, is_chief, people_obj) 반환.
    person_key: person_id 기반이면 "id:123", 이름 기반이면 "name:홍길동"
    """
    if s.person_id and s.person_id in people_map:
        p = people_map[s.person_id]
        return f"id:{s.person_id}", p.person_name, bool(p.is_chief), p
    name_text = (s.person_name_text or "").strip()
    if name_text:
        norm = _norm_name(name_text)
        return f"name:{norm}", name_text, False, None
    return None, "미배정", False, None


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
        is_chief, person_name,
        field, sub_field, category, md,
        staffing_id,
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

        person_key, person_name, is_chief, _ = _resolve_person_key(s, people_map)
        if not person_key:
            continue

        proj = project_map.get(s.project_id)
        if not proj:
            continue

        entry = {
            "staffing_id":    s.id,
            "project_id":     proj.id,
            "project_name":   proj.project_name,
            "project_status": proj.status,
            "organization":   proj.organization or "",
            "phase_id":       phase.id,
            "phase_name":     phase.phase_name,
            "start_date":     phase.start_date,
            "end_date":       phase.end_date,
            "is_chief":       is_chief,
            "person_name":    person_name,
            "field":          s.field or "",
            "sub_field":      s.sub_field or "",
            "category":       s.category or "",
            "md":             s.md,
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
    excluded_keys: Optional[set] = None,   # 시뮬레이션용: 제외할 person_key 집합
) -> List[Dict]:
    """
    excluded_keys: 이 person_key들을 본사업 인력에서 제외하고 리스크 재계산
    """
    excluded = excluded_keys or set()
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

    # 대상 사업에 배정된 인력 key 목록 수집 (excluded 제외)
    t_staffings = [s for s in staffings if s.project_id == target_project.id]
    t_person_keys: Dict[str, str] = {}   # key → display_name
    t_person_is_chief: Dict[str, bool] = {}
    for s in t_staffings:
        key, name, is_chief, _ = _resolve_person_key(s, people_map)
        if key and key not in excluded:
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
        # 이 인력의 다른 사업 phase 들 (A/P 모두 비교)
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
                    "person_name":            person_name,
                    "is_chief":               is_chief,
                    # 본사업(제안) phase 정보
                    "my_phase_name":          t_ph["phase_name"],
                    "my_phase_start":         str(t_ph["start_date"]),
                    "my_phase_end":           str(t_ph["end_date"]),
                    "my_field":               t_ph["field"],
                    "my_sub_field":           t_ph["sub_field"],
                    # 충돌 사업 정보
                    "other_project_id":       o_ph["project_id"],
                    "other_project_name":     o_ph["project_name"],
                    "other_project_status":   o_ph["project_status"],
                    "other_phase_name":       o_ph["phase_name"],
                    "other_phase_start":      str(o_ph["start_date"]),
                    "other_phase_end":        str(o_ph["end_date"]),
                    "other_field":            o_ph["field"],        # 비교사업에서의 분야
                    "other_sub_field":        o_ph["sub_field"],
                    "other_field_highlight":  _is_highlight_field(o_ph["field"]),  # 사업관리/품질보증 여부
                    # 겹치는 구간
                    "overlap_start":          str(ov_s),
                    "overlap_end":            str(ov_e),
                    "overlap_days":           days,
                    # 중복 공수 (md 기반)
                    "my_md":                  t_ph["md"],
                    "other_md":               o_ph["md"],
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

        # ── 데이터 기반 구체적 해결 제안 생성 ────────────────────────
        suggestions = _build_conflict_suggestions(
            by_person, chief_conflicts, t_start, t_end, target_project
        )

        risks.append({
            "type":        "schedule_conflict",
            "severity":    severity,
            "title":       "인력 일정 중복",
            "count":       len(by_person),
            "reasons":     reasons,
            "suggestions": suggestions,
            "items":       conflict_items,
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
        # A/P 모두 비교
        other_phases = [e for e in all_entries
                       if e["project_id"] != target_project.id]

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


# ── 본사업 인력 배치 목록 (ScheduleTab 정렬 기준) ─────────────────────────────
def _get_target_staffing_people(
    target_project_id: int,
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
    project_map: Optional[Dict[int, Any]] = None,
) -> List[Dict]:
    """
    본사업(제안) 인력을 ScheduleTab과 동일한 순서로 반환.
    정렬: (sortGroup, sortOrder, phase.sort_order, staffing.id)
      - sortGroup: 단계감리팀=0, 전문가팀=1
      - 제안사업 단계감리팀: sortOrder=0 고정 (staffing.id 입력순 보존)
      - 감리사업 단계감리팀: sortOrder= field 순서(사업관리=0, 응용시스템=1, ...)
      - 전문가팀: sortOrder= 카테고리 순서(핵심기술=0,...)
    """
    ph_map = {p.id: p for p in phases}
    t_staffings = [s for s in staffings if s.project_id == target_project_id]

    # 제안사업 여부 판단
    target_proj = (project_map or {}).get(target_project_id)
    is_proposal = (target_proj is not None and getattr(target_proj, 'status', '') == '제안')

    # 인력별 첫 번째 staffing 레코드 수집 (정렬 키 계산용)
    # 동일 인력이 여러 phase에 있을 경우, 가장 우선순위 높은(sort_key 작은) 것 사용
    person_best: Dict[str, Dict] = {}  # key → {sort_key, staffing, person_obj}

    for s in t_staffings:
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key:
            continue
        phase = ph_map.get(s.phase_id)
        phase_sort = phase.sort_order if phase and hasattr(phase, 'sort_order') else 9999
        sg, so = _get_sort_key(s.category or "", s.field or "", is_proposal=is_proposal)
        sort_key = (sg, so, phase_sort, s.id)

        if key not in person_best or sort_key < person_best[key]["sort_key"]:
            person_best[key] = {
                "sort_key":   sort_key,
                "staffing":   s,
                "person_obj": person_obj,
                "person_name": name,
                "is_chief":   is_chief,
            }

    # sort_key 기준으로 정렬
    sorted_items = sorted(person_best.items(), key=lambda kv: kv[1]["sort_key"])

    result = []
    for key, info in sorted_items:
        s = info["staffing"]
        person_obj = info["person_obj"]
        result.append({
            "person_key":  key,
            "person_id":   s.person_id,
            "person_name": info["person_name"],
            "is_chief":    info["is_chief"],
            "grade":       (person_obj.grade if person_obj else None) or "",
            "position":    (person_obj.position if person_obj else None) or "",
            "field":       s.field or "",
            "sub_field":   s.sub_field or "",
            "category":    s.category or "",
        })

    return result


# ── 인력별 일정 중복 상세 ─────────────────────────────────────────────────────
def _build_schedule_overlap(
    target_project_id: int,
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
    project_map: Dict[int, Any],
    excluded_keys: Optional[set] = None,   # 시뮬레이션용: 제외할 person_key 집합
) -> List[Dict]:
    """
    본사업 인력을 배치 순서(staffing.id 순)로 나열하고,
    각 인력에 대해 감리사업(A) / 타제안(P) 충돌 목록 반환.

    반환값 (인력 1명 단위):
    {
      person_key, person_name, is_chief, grade,
      my_field, my_sub_field,           ← 본사업에서의 분야
      total_overlap_days,               ← 모든 충돌의 합산 중복일수
      total_overlap_md,                 ← 합산 공수(md)
      conflicts: [
        {
          other_project_id, other_project_name,
          other_project_status,           ← '감리' or '제안'
          type_label,                     ← 'A' (감리) or 'P' (제안)
          other_phase_name,
          other_phase_start, other_phase_end,
          other_field, other_sub_field,
          other_field_highlight,          ← 사업관리/품질보증 여부
          my_phase_name, my_phase_start, my_phase_end,
          overlap_start, overlap_end,
          overlap_days,
          overlap_md,                     ← 해당 충돌의 공수
        }, ...
      ]
    }
    """
    ph_map = {p.id: p for p in phases}

    # 인력별 phase 인덱스 빌드
    person_phase_index = _build_person_phase_index(
        staffings, phases, people_map, project_map
    )

    # 본사업 인력 (ScheduleTab 정렬 기준)
    t_staffings = [s for s in staffings if s.project_id == target_project_id]
    ph_map = {p.id: p for p in phases}

    _excluded = excluded_keys or set()

    # 제안사업 여부 판단 (단계감리팀 정렬 방식 결정)
    _target_proj = project_map.get(target_project_id)
    _is_proposal = (_target_proj is not None and getattr(_target_proj, 'status', '') == '제안')

    # 인력별로 가장 우선순위 높은 staffing 레코드로 분야/정렬키 결정 (excluded 제외)
    person_best: Dict[str, Dict] = {}
    for s in t_staffings:
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key or key in _excluded:
            continue
        phase = ph_map.get(s.phase_id)
        phase_sort = phase.sort_order if phase and hasattr(phase, 'sort_order') else 9999
        sg, so = _get_sort_key(s.category or "", s.field or "", is_proposal=_is_proposal)
        # 가상 staffing(음수 id)은 orig_id(원본 id)를 sort_key에 사용 → 정렬 순서 유지
        sort_id = getattr(s, 'orig_id', None) or abs(s.id)
        sort_key = (sg, so, phase_sort, sort_id)
        # 교체 전 원본 person_key (있으면 드롭다운 연결용)
        orig_person_key = getattr(s, 'orig_person_key', None)

        if key not in person_best or sort_key < person_best[key]["sort_key"]:
            person_best[key] = {
                "sort_key":      sort_key,
                "staffing":      s,
                "person_obj":    person_obj,
                "person_name":   name,
                "is_chief":      is_chief,
                "orig_person_key": orig_person_key,
            }

    # ScheduleTab과 동일한 정렬 순서 유지
    sorted_people = sorted(person_best.items(), key=lambda kv: kv[1]["sort_key"])

    person_field_map: Dict[str, Dict] = {}
    for key, info in sorted_people:
        s = info["staffing"]
        person_obj = info["person_obj"]
        person_field_map[key] = {
            "person_key":      key,
            "orig_person_key": info.get("orig_person_key"),  # 교체 전 원본 key (프론트 드롭다운 연결용)
            "person_id":       s.person_id,
            "person_name":     info["person_name"],
            "is_chief":        info["is_chief"],
            "grade":           (person_obj.grade if person_obj else None) or "",
            "position":        (person_obj.position if person_obj else None) or "",
            "my_field":        s.field or "",
            "my_sub_field":    s.sub_field or "",
            "my_category":     s.category or "",
            "can_travel":      (person_obj.can_travel if person_obj and person_obj.can_travel is not None else True),
        }

    # 각 인력의 충돌 수집 (정렬 순서 유지)
    result = []
    seen_order = list(person_field_map.keys())  # 이미 정렬된 순서

    for person_key in seen_order:
        pinfo = person_field_map[person_key]
        all_entries = person_phase_index.get(person_key, [])

        my_phases = [e for e in all_entries if e["project_id"] == target_project_id]
        # A/P 모두 비교
        other_phases = [e for e in all_entries
                       if e["project_id"] != target_project_id]

        conflicts = []
        seen_conf = set()

        for t_ph in my_phases:
            for o_ph in other_phases:
                if not _dates_overlap(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                ):
                    continue
                dedup = (o_ph["project_id"], t_ph["phase_id"], o_ph["phase_id"])
                if dedup in seen_conf:
                    continue
                seen_conf.add(dedup)

                ov_s, ov_e = _overlap_range(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )
                days = _overlap_days(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )

                # 감리(A) / 제안(P) 구분
                status = o_ph["project_status"]
                type_label = "A" if status == "감리" else "P"

                # 공수: md가 있으면 md, 없으면 overlap_days
                overlap_md = o_ph["md"] if o_ph["md"] else days

                conflicts.append({
                    "other_project_id":      o_ph["project_id"],
                    "other_project_name":    o_ph["project_name"],
                    "other_project_status":  status,
                    "other_organization":    o_ph["organization"],
                    "type_label":            type_label,
                    "other_phase_name":      o_ph["phase_name"],
                    "other_phase_start":     str(o_ph["start_date"]),
                    "other_phase_end":       str(o_ph["end_date"]),
                    "other_field":           o_ph["field"],
                    "other_sub_field":       o_ph["sub_field"],
                    "other_field_highlight": _is_highlight_field(o_ph["field"]),
                    "my_phase_name":         t_ph["phase_name"],
                    "my_phase_start":        str(t_ph["start_date"]),
                    "my_phase_end":          str(t_ph["end_date"]),
                    "overlap_start":         str(ov_s),
                    "overlap_end":           str(ov_e),
                    "overlap_days":          days,
                    "overlap_md":            overlap_md,
                })

        # 감리 먼저, 그 다음 제안 순으로 정렬
        conflicts.sort(key=lambda c: (0 if c["type_label"] == "A" else 1, c["other_project_name"]))

        total_days = sum(c["overlap_days"] for c in conflicts)
        total_md = sum(c["overlap_md"] for c in conflicts)

        # ── 단계별 상세 (my_phases): 중복 여부와 무관하게 모든 phase 포함 ──
        my_phases_detail = []
        for t_ph in sorted(my_phases, key=lambda p: p["start_date"]):
            phase_others = []
            for o_ph in other_phases:
                if not _dates_overlap(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                ):
                    continue
                ov_s, ov_e = _overlap_range(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )
                days_ph = _overlap_days(
                    t_ph["start_date"], t_ph["end_date"],
                    o_ph["start_date"], o_ph["end_date"]
                )
                overlap_md_ph = o_ph["md"] if o_ph["md"] else days_ph
                status_ph = o_ph["project_status"]
                phase_others.append({
                    "type_label":            "A" if status_ph == "감리" else "P",
                    "other_project_id":      o_ph["project_id"],
                    "other_project_name":    o_ph["project_name"],
                    "other_project_status":  status_ph,
                    "other_organization":    o_ph["organization"],
                    "other_phase_name":      o_ph["phase_name"],
                    "other_phase_start":     str(o_ph["start_date"]),
                    "other_phase_end":       str(o_ph["end_date"]),
                    "other_field":           o_ph["field"],
                    "other_sub_field":       o_ph["sub_field"],
                    "other_field_highlight": _is_highlight_field(o_ph["field"]),
                    "overlap_start":         str(ov_s),
                    "overlap_end":           str(ov_e),
                    "overlap_days":          days_ph,
                    "overlap_md":            overlap_md_ph,
                })
            phase_others.sort(key=lambda x: (0 if x["type_label"] == "A" else 1, x["other_project_name"]))
            my_phases_detail.append({
                "phase_id":       t_ph["phase_id"],
                "phase_name":     t_ph["phase_name"],
                "start_date":     str(t_ph["start_date"]),
                "end_date":       str(t_ph["end_date"]),
                "has_overlap":    len(phase_others) > 0,
                "overlap_days":   sum(x["overlap_days"] for x in phase_others),
                "overlap_md":     sum(x["overlap_md"]   for x in phase_others),
                "other_projects": phase_others,
            })

        result.append({
            **pinfo,
            "total_overlap_days": total_days,
            "total_overlap_md":   total_md,
            "has_conflict":       len(conflicts) > 0,
            "conflicts":          conflicts,
            "my_phases":          my_phases_detail,
        })

    return result


# ── 엔드포인트 ─────────────────────────────────────────────────────────────────
@router.get("/debug")
async def get_proposal_risk_debug(db: AsyncSession = Depends(get_db)):
    """디버그: DB 실제 데이터 현황"""
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    status_counts: Dict[str, int] = {}
    for p in all_projects:
        status_counts[p.status] = status_counts.get(p.status, 0) + 1

    proposal_projects = [p for p in all_projects if p.status == "제안"]
    person_phase_index = _build_person_phase_index(staffings, phases, people_map, project_map)

    proposal_detail = []
    for proj in proposal_projects:
        proj_phases = [ph for ph in phases if ph.project_id == proj.id]
        phases_with_dates = [ph for ph in proj_phases if ph.start_date and ph.end_date]
        proj_staffings = [s for s in staffings if s.project_id == proj.id]

        with_pid = [s for s in proj_staffings if s.person_id]
        with_name_only = [s for s in proj_staffings if not s.person_id and s.person_name_text]
        unassigned = [s for s in proj_staffings if not s.person_id and not s.person_name_text]

        t_person_keys: Dict[str, str] = {}
        for s in proj_staffings:
            key, name, _, _ = _resolve_person_key(s, people_map)
            if key:
                t_person_keys[key] = name

        conflict_check = []
        for key, name in list(t_person_keys.items())[:20]:
            entries = person_phase_index.get(key, [])
            other_projects = list({e["project_id"] for e in entries if e["project_id"] != proj.id})
            other_proj_names = [project_map[pid].project_name for pid in other_projects if pid in project_map]
            conflict_check.append({
                "person_name": name,
                "person_key": key,
                "total_phase_entries": len(entries),
                "in_other_projects": len(other_projects),
                "other_project_names": other_proj_names[:5],
            })

        risks = _analyze_risks(proj, all_projects, phases, staffings, people_map)

        proposal_detail.append({
            "id": proj.id,
            "project_name": proj.project_name,
            "status": proj.status,
            "phases_with_dates": len(phases_with_dates),
            "staffings_with_person_id": len(with_pid),
            "staffings_with_name_only": len(with_name_only),
            "staffings_unassigned": len(unassigned),
            "unique_person_keys": len(t_person_keys),
            "conflict_check": conflict_check,
            "risks_detected": len(risks),
            "risk_types": [r["type"] for r in risks],
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


class TextOutputRequest(BaseModel):
    """시뮬레이션 결과 → 이미지 속 텍스트 형식(감리 일정 / 감리원) 변환 요청
    
    세 가지 시뮬레이션 조합을 모두 반영하여 텍스트 출력:
    1. excluded_person_keys : 제외만 (대체 없음)
    2. person_replacements  : {old_person_key: new_person_id} 인력 교체
    3. phase_shifts         : {phase_id: {start_date, end_date}} 일정 이동
    """
    excluded_person_keys: List[str] = []        # 제외할 person_key 목록 (대체 없음)
    person_replacements: Dict[str, Optional[int]] = {}  # {old_key: new_person_id} 인력 교체
    phase_shifts: Dict[int, Dict[str, str]] = {}        # {phase_id: {start_date, end_date}}


@router.post("/{project_id}/text-output")
async def get_text_output(
    project_id: int,
    body: TextOutputRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    [DB 격리 보장] 이 엔드포인트는 DB에 어떠한 쓰기도 수행하지 않습니다.
    - DB에서 데이터를 읽기(SELECT)만 수행한 후 메모리에서 가공합니다.
    - excluded_person_keys, person_replacements, phase_shifts 모두
      메모리 내 가상 조작에만 사용되며 원본 DB에 반영되지 않습니다.

    제안 사업의 인력 배치를 이미지 속 텍스트 형식으로 변환.
    시뮬레이션 조합(제외 / 인력교체 / 일정이동)을 반영하여 출력.

    출력 형식:
    [감리 일정]
    단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:MD, ...

    [감리원]
    이름, 분야

    [전문가 - 핵심기술]
    이름, 분야
    ...
    """
    from fastapi import HTTPException
    from types import SimpleNamespace

    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Project not found")

    # ── person_replacements 에서 excluded 도 함께 수집 ───────────────────
    # excluded_person_keys 와 person_replacements 의 키(old_key) 모두 제거 대상
    excluded = set(body.excluded_person_keys) | set(body.person_replacements.keys())

    # ── phase_shifts 적용: 가상 phase 객체 생성 ──────────────────────────
    phase_shift_map: Dict[int, tuple] = {}
    for phase_id_str, dates in body.phase_shifts.items():
        try:
            pid_int = int(phase_id_str)
            ns = date.fromisoformat(dates["start_date"])
            ne = date.fromisoformat(dates["end_date"])
            phase_shift_map[pid_int] = (ns, ne)
        except Exception:
            continue

    virtual_phases = []
    for ph in phases:
        if ph.id in phase_shift_map:
            ns_date, ne_date = phase_shift_map[ph.id]
            vph = SimpleNamespace(
                id=ph.id,
                project_id=ph.project_id,
                phase_name=ph.phase_name,
                start_date=ns_date,
                end_date=ne_date,
                sort_order=getattr(ph, "sort_order", 9999),
                deleted_at=ph.deleted_at,
            )
        else:
            vph = ph
        virtual_phases.append(vph)

    ph_map = {p.id: p for p in virtual_phases}

    # ── 본사업 staffing 목록: old_key 제거 + 교체 인력 가상 추가 ────────
    t_staffings = [s for s in staffings if s.project_id == project_id]

    # old_key 제거
    filtered_staffings = []
    for s in t_staffings:
        key, _, _, _ = _resolve_person_key(s, people_map)
        if key and key not in excluded:
            filtered_staffings.append(s)
        elif not key:
            filtered_staffings.append(s)

    # 교체 인력 가상 staffing 추가
    for old_key, new_pid in body.person_replacements.items():
        if not new_pid or new_pid not in people_map:
            continue
        # old_key 가 배정된 본사업 staffing 레코드를 찾아 new_pid 로 교체한 가상 레코드 생성
        for s in t_staffings:
            s_key, _, _, _ = _resolve_person_key(s, people_map)
            if s_key != old_key:
                continue
            vs = SimpleNamespace(
                id=-s.id,
                project_id=s.project_id,
                phase_id=s.phase_id,
                person_id=new_pid,
                person_name_text=None,
                field=s.field,
                sub_field=s.sub_field,
                category=s.category,
                md=s.md,
                deleted_at=None,
            )
            filtered_staffings.append(vs)

    # ── 단계별로 그룹핑 ──────────────────────────────────────────────────
    # phase_id → 인력 목록 매핑
    phase_people: Dict[int, List[Dict]] = {}
    for s in filtered_staffings:
        ph = ph_map.get(s.phase_id)
        if not ph:
            continue
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key and not name:
            continue
        entry = {
            "name":     name,
            "field":    s.field or "",
            "sub_field":s.sub_field or "",
            "category": s.category or "",
            "md":       s.md,
        }
        phase_people.setdefault(s.phase_id, []).append(entry)

    # ── 인력 정보 수집 (감리원 / 전문가 섹션) ────────────────────────────
    # 배치 순서에 따라 인력 분류
    _STAGE_CATS = {"단계감리팀", "감리팀"}
    _EXPERT_CAT_MAP = {
        "핵심기술":   "전문가 - 핵심기술",
        "필수기술":   "전문가 - 필수기술",
        "보안진단":   "전문가 - 보안진단",
        "테스트":     "전문가 - 테스트",
        "전문가팀":   "전문가 - 핵심기술",  # 레거시 통합
    }

    # 인력별 대표 정보 (정렬 기준: _get_sort_key)
    _is_proposal_text = (getattr(target, 'status', '') == '제안')
    person_best: Dict[str, Dict] = {}
    for s in filtered_staffings:
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key:
            continue
        ph = ph_map.get(s.phase_id)
        phase_sort = ph.sort_order if ph and hasattr(ph, 'sort_order') else 9999
        sg, so = _get_sort_key(s.category or "", s.field or "", is_proposal=_is_proposal_text)
        sort_key = (sg, so, phase_sort, s.id)
        if key not in person_best or sort_key < person_best[key]["sort_key"]:
            person_best[key] = {
                "sort_key": sort_key, "name": name,
                "field": s.field or "", "sub_field": s.sub_field or "",
                "category": s.category or "", "is_chief": is_chief,
            }

    sorted_people = sorted(person_best.items(), key=lambda kv: kv[1]["sort_key"])

    # 섹션 분류
    auditors: List[Dict] = []           # 감리원 (단계감리팀)
    experts: Dict[str, List[Dict]] = {} # 전문가 섹션별

    for key, info in sorted_people:
        cat = info["category"].strip()
        field = info["field"].strip()
        sf = info["sub_field"].strip()
        display_field = sf if (sf and sf != field) else field

        if cat in _STAGE_CATS or (not cat and _get_sort_key(cat, field)[0] == 0):
            auditors.append({"name": info["name"], "field": display_field})
        else:
            # 전문가 섹션 결정
            section_label = _EXPERT_CAT_MAP.get(cat, "전문가 - 핵심기술")
            experts.setdefault(section_label, []).append(
                {"name": info["name"], "field": display_field}
            )

    # ── 감리 일정 텍스트 생성 ────────────────────────────────────────────
    # phase를 sort_order 순으로 정렬 (가상 phase 포함 — 일정 이동 반영)
    t_phases_sorted = sorted(
        [ph for ph in virtual_phases if ph.project_id == project_id and ph.start_date and ph.end_date],
        key=lambda p: getattr(p, 'sort_order', 9999)
    )

    schedule_lines = []
    for ph in t_phases_sorted:
        # 날짜 포맷: YYYY-MM-DD → YYYYMMDD
        start_str = str(ph.start_date).replace("-", "")
        end_str   = str(ph.end_date).replace("-", "")

        people_in_phase = phase_people.get(ph.id, [])
        people_parts = []
        for p in people_in_phase:
            part = p["name"]
            if p["md"]:
                part += f":{p['md']}"
            people_parts.append(part)

        parts = [ph.phase_name, start_str, end_str] + people_parts
        schedule_lines.append(", ".join(parts))

    # ── 텍스트 조합 ──────────────────────────────────────────────────────
    sections: List[Dict] = []

    # 감리 일정
    sections.append({
        "label":   "감리 일정",
        "format":  "형식: 단계명, YYYYMMDD, YYYYMMDD, 이름A, 이름B:MD",
        "content": "\n".join(schedule_lines) if schedule_lines else "(단계 정보 없음)",
    })

    # 감리원
    sections.append({
        "label":   "감리원",
        "format":  "형식: 이름, 분야",
        "content": "\n".join(f"{a['name']}, {a['field']}" for a in auditors) if auditors else "",
    })

    # 전문가 섹션 (핵심기술/필수기술/보안진단/테스트 순서 고정)
    for sec_label in ["전문가 - 핵심기술", "전문가 - 필수기술", "전문가 - 보안진단", "전문가 - 테스트"]:
        members = experts.get(sec_label, [])
        sections.append({
            "label":   sec_label,
            "format":  "형식: 이름, 분야",
            "content": "\n".join(f"{m['name']}, {m['field']}" for m in members),
        })

    # 시뮬레이션 적용 요약 (프론트 안내용)
    replacements_applied = {
        k: v for k, v in body.person_replacements.items() if v is not None
    }
    excluded_only = set(body.excluded_person_keys) - set(body.person_replacements.keys())

    return {
        "project_id":   project_id,
        "project_name": target.project_name,
        "organization": target.organization,
        "excluded_keys": list(excluded),
        "excluded_count": len(excluded),
        "replacements_count": len(replacements_applied),
        "phase_shifts_count": len(phase_shift_map),
        "sections":     sections,
    }


@router.get("/{project_id}/all-people")
async def get_all_people_for_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    [DB 격리 보장] 읽기 전용.

    프로젝트에 배정된 인력 목록 + 전체 인력 풀을 반환.
    - assigned: 현재 배정 인력 (person_key, 충돌일수, 분야 등)
    - all_people: 전체 인력 목록 (가용 여부, 충돌일수 정렬)
    시뮬레이션에서 인력 교체 드롭다운에 사용.
    """
    from fastapi import HTTPException

    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Project not found")

    t_start, t_end = _project_date_range(project_id, phases)

    # 현재 배정 인력 및 중복 현황
    schedule_data = _build_schedule_overlap(project_id, staffings, phases, people_map, project_map)
    assigned_keys = {p["person_key"] for p in schedule_data}

    # 배정 인력의 분야 목록 수집 (field_match 계산용)
    # staffing에서 이 프로젝트에 배정된 인력의 field 직접 추출
    target_phase_ids = {
        ph.id for ph in phases
        if hasattr(ph, 'project_id') and ph.project_id == project_id
    }
    assigned_fields: set = set()
    assigned_sub_fields: set = set()
    for s in staffings:
        if s.phase_id in target_phase_ids:
            if s.field:
                assigned_fields.add(s.field.strip())
            if s.sub_field:
                assigned_sub_fields.add(s.sub_field.strip())

    # 전체 인력 busy 기간 계산 (target 프로젝트 자신의 배정은 제외 — 교체 후보 용도)
    # target 프로젝트에 이미 배정된 인력도 '가용' 여부를 다른 프로젝트 기준으로 판단해야 함
    ph_map = {p.id: p for p in phases}
    person_busy: Dict[str, List[Tuple[date, date]]] = {}
    for s in staffings:
        if s.project_id == project_id:
            continue  # target 프로젝트 자신의 배정은 busy 계산에서 제외
        ph = ph_map.get(s.phase_id)
        if not ph or not ph.start_date or not ph.end_date:
            continue
        key, _, _, _ = _resolve_person_key(s, people_map)
        if not key:
            continue
        person_busy.setdefault(key, []).append((ph.start_date, ph.end_date))

    # 전체 인력 목록 빌드 (삭제되지 않은 인력)
    all_people_list = []
    for person in people_map.values():
        if person.deleted_at:
            continue
        p_key = f"id:{person.id}"
        is_assigned = p_key in assigned_keys

        # 이 인력의 해당 기간 중복일수
        conflict_days = 0
        is_available = True
        if t_start and t_end:
            for bs, be in person_busy.get(p_key, []):
                od = _overlap_days(t_start, t_end, bs, be)
                conflict_days += od
            is_available = conflict_days == 0

        # 이 인력이 다른 프로젝트에서 주로 맡은 분야 (staffing에서 추출)
        person_fields_in_staffings: set = set()
        for s in staffings:
            s_key, _, _, _ = _resolve_person_key(s, people_map)
            if s_key == p_key and s.field:
                person_fields_in_staffings.add(s.field.strip())

        person_main_field = next(iter(person_fields_in_staffings), "")

        # 분야 매칭 여부: 이 인력의 분야가 현재 프로젝트 배정 인력 분야 중 하나와 일치
        field_match = bool(
            person_fields_in_staffings & assigned_fields
        )

        all_people_list.append({
            "person_id":    person.id,
            "person_key":   p_key,
            "person_name":  person.person_name,
            "grade":        person.grade or "",
            "position":     person.position or "",
            "company":      person.company or "",
            "is_chief":     bool(person.is_chief),
            "is_assigned":  is_assigned,
            "is_available": is_available,
            "conflict_days": conflict_days,
            "my_field":     person_main_field,
            "field_match":  field_match,
            "can_travel":   person.can_travel if person.can_travel is not None else True,
        })

    # 정렬: 본사업 배정중 최하위 → 가용 먼저 → 분야매칭 먼저 → 중복 적은 순 → 이름 순
    all_people_list.sort(key=lambda p: (
        1 if p["is_assigned"] else 0,   # 본사업 배정중 인력은 최하위
        0 if p["is_available"] else 1,
        0 if p["field_match"] else 1,
        p["conflict_days"],
        p["person_name"],
    ))

    return {
        "project_id": project_id,
        "assigned": schedule_data,
        "all_people": all_people_list,
        "project_start": str(t_start) if t_start else None,
        "project_end": str(t_end) if t_end else None,
    }


@router.get("/{project_id}/schedule")
async def get_proposal_schedule_overlap(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    본사업 인력별 일정 중복 상세
    - 본사업 인력을 배치 순서(staffing.id 기준)로 나열
    - 각 인력의 본사업 분야(field) 표시
    - 감리사업(A) / 타제안(P) 충돌 항목 포함
    - 충돌 사업의 분야가 사업관리/품질보증이면 highlight=true
    """
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    p_start, p_end = _project_date_range(project_id, phases)
    schedule_data = _build_schedule_overlap(
        project_id, staffings, phases, people_map, project_map
    )

    # 전체 통계
    total_people = len(schedule_data)
    conflict_people = sum(1 for p in schedule_data if p["has_conflict"])
    total_conflict_days = sum(p["total_overlap_days"] for p in schedule_data)
    total_conflict_md = sum(p["total_overlap_md"] for p in schedule_data)

    return {
        "id":            target.id,
        "project_name":  target.project_name,
        "organization":  target.organization,
        "start_date":    str(p_start) if p_start else None,
        "end_date":      str(p_end) if p_end else None,
        "summary": {
            "total_people":       total_people,
            "conflict_people":    conflict_people,
            "total_overlap_days": total_conflict_days,
            "total_overlap_md":   total_conflict_md,
        },
        "people": schedule_data,
    }


@router.get("/{project_id}")
async def get_proposal_risk_detail(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """특정 제안사업의 상세 리스크 분석"""
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    risks = _analyze_risks(target, all_projects, phases, staffings, people_map)
    p_start, p_end = _project_date_range(project_id, phases)

    assigned_people = _get_target_staffing_people(
        project_id, staffings, phases, people_map, project_map=project_map
    )

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


# ── 대체 인력 추천 헬퍼 ──────────────────────────────────────────────────────
def _find_replacement_candidates(
    person_key: str,
    target_project_id: int,
    t_start: Optional[date],
    t_end: Optional[date],
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
    need_field: str,
    need_is_chief: bool,
) -> List[Dict]:
    """
    제외 인력의 대체 후보를 찾는다.
    - 동일 분야(field)에서 현재 사업 기간과 겹치지 않는 인력 추천
    - 총괄급 필요 시 is_chief=True 인력만, 아니면 일반 인력 중 추천
    - 최대 3명 반환
    """
    if not t_start or not t_end:
        return []

    ph_map = {p.id: p for p in phases}

    # 이미 배정된 인력 키 수집 (본사업)
    assigned_keys: set = set()
    for s in staffings:
        if s.project_id == target_project_id:
            key, _, _, _ = _resolve_person_key(s, people_map)
            if key:
                assigned_keys.add(key)

    # 각 인력의 바쁜 기간 계산
    person_busy: Dict[str, List[Tuple[date, date]]] = {}
    for s in staffings:
        ph = ph_map.get(s.phase_id)
        if not ph or not ph.start_date or not ph.end_date:
            continue
        key, _, _, _ = _resolve_person_key(s, people_map)
        if not key:
            continue
        person_busy.setdefault(key, []).append((ph.start_date, ph.end_date))

    candidates = []
    for person in people_map.values():
        if person.deleted_at:
            continue
        p_key = f"id:{person.id}"
        if p_key == person_key or p_key in assigned_keys:
            continue
        if need_is_chief and not person.is_chief:
            continue

        # 분야 매칭 (유사 field 가진 인력)
        field_match = False
        if need_field:
            for s in staffings:
                if s.person_id == person.id:
                    s_field = (s.field or "").strip()
                    if need_field and (need_field in s_field or s_field in need_field):
                        field_match = True
                        break
        # 분야 미지정이거나 매칭 안 되면 같은 직급으로라도 후보로 고려
        if not field_match and need_field:
            continue

        # 해당 기간 가용 여부 확인
        busy_periods = person_busy.get(p_key, [])
        is_available = True
        for bs, be in busy_periods:
            if _dates_overlap(t_start, t_end, bs, be):
                is_available = False
                break

        candidates.append({
            "person_id":    person.id,
            "person_name":  person.person_name,
            "is_chief":     bool(person.is_chief),
            "grade":        person.grade or "",
            "position":     person.position or "",
            "is_available": is_available,
            "company":      person.company or "",
        })

    # 가용 인력 우선, 이름순 정렬
    candidates.sort(key=lambda c: (0 if c["is_available"] else 1, c["person_name"]))
    return candidates[:3]


def _build_conflict_suggestions(
    by_person: Dict[str, List],
    chief_conflicts: List,
    t_start: Optional[date],
    t_end: Optional[date],
    target_project: Any,
) -> List[str]:
    """
    데이터 기반 구체적 해결 제안 생성.
    단순 일반 문구 대신 실제 인력명, 날짜, 대체 방안을 포함.
    """
    suggestions = []

    # ① 총괄급 중복이 있으면 최우선 경고
    if chief_conflicts:
        chief_names = list({c["person_name"] for c in chief_conflicts})
        suggestions.append(
            f"⚠️ 총괄급 인력({', '.join(chief_names)}) 일정 중복 — 품질 직결 사안, 최우선 해소 필요"
        )

    # ② 중복 인원이 많으면 중복 수 기반 조언
    conflict_count = len(by_person)
    if conflict_count >= 3:
        suggestions.append(
            f"중복 인력 {conflict_count}명 — 절반 이상을 교체하거나 단계별 분리 배정 권고"
        )
    elif conflict_count > 0:
        names_str = ", ".join(list(by_person.keys())[:3])
        suggestions.append(
            f"{names_str} 등 중복 인력을 타 사업 일정이 종료된 후 투입하거나 대체 인력 확보"
        )

    # ③ 날짜 기반 제안 (사업 시작을 미룰 수 있는지)
    if t_start and t_end:
        duration_days = (t_end - t_start).days
        # 각 중복 기간의 종료일 수집
        all_overlap_ends = []
        for items in by_person.values():
            for it in items:
                try:
                    from datetime import date as _date
                    oe = _date.fromisoformat(it["overlap_end"])
                    all_overlap_ends.append(oe)
                except Exception:
                    pass
        if all_overlap_ends:
            max_overlap_end = max(all_overlap_ends)
            delay_days = (max_overlap_end - t_start).days + 1
            if 0 < delay_days < 60:
                suggestions.append(
                    f"사업 착수를 {delay_days}일 연기하면 현재 중복 인력의 타 사업 일정과 겹치지 않음"
                    f" (착수 기준일 변경: {t_start} → {max_overlap_end})"
                )

    # ④ 분야별 중복이 사업관리/품질보증이면 감리 품질 위험 명시
    highlight_persons = []
    for pname, items in by_person.items():
        for it in items:
            if it.get("other_field_highlight"):
                highlight_persons.append(pname)
                break
    if highlight_persons:
        suggestions.append(
            f"사업관리/품질보증 분야 중복({', '.join(highlight_persons[:2])})은 감리 독립성 훼손 위험 — "
            f"해당 인력 교체 또는 역할 분리 검토"
        )

    # ⑤ 중복 공수(MD) 기반 제안
    total_md = sum(
        it.get("my_md") or it.get("overlap_days", 0)
        for items in by_person.values()
        for it in items
    )
    if total_md > 20:
        suggestions.append(
            f"총 중복 공수 {total_md}MD — 실제 투입 가능 공수 재검토 및 업무 분장 조정 필요"
        )

    if not suggestions:
        suggestions.append("현재 배정 인력 중 타 사업 종료 시점을 고려해 단계별 투입 계획 수립 권고")

    return suggestions


# ── 시뮬레이션 요청 스키마 ────────────────────────────────────────────────────
class SimulateRequest(BaseModel):
    excluded_person_keys: List[str] = []   # 제외할 person_key 목록


@router.post("/{project_id}/simulate")
async def simulate_risk(
    project_id: int,
    body: SimulateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    [DB 격리 보장] 이 엔드포인트는 DB에 어떠한 쓰기도 수행하지 않습니다.
    - _load_all()로 데이터를 읽어온 후 메모리에서만 계산합니다.
    - _analyze_risks() / _build_schedule_overlap() 은 DB에 쓰기가 없는 순수 계산 함수입니다.
    - excluded_person_keys 는 메모리 내 필터링에만 사용되며, DB의 staffing 레코드는 변경되지 않습니다.

    인력 제외 시뮬레이션:
    - excluded_person_keys 에 포함된 인력을 본사업 배정에서 제외한 것처럼 리스크 재계산
    - 원본 리스크 대비 개선 효과(delta) 함께 반환
    - 제외 인력별 대체 후보 추천
    """
    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    excluded = set(body.excluded_person_keys)
    t_start, t_end = _project_date_range(project_id, phases)

    # 원본 스케줄 & 리스크
    orig_schedule = _build_schedule_overlap(
        project_id, staffings, phases, people_map, project_map
    )
    orig_risks = _analyze_risks(target, all_projects, phases, staffings, people_map)
    orig_danger  = sum(1 for r in orig_risks if r["severity"] == "danger")
    orig_warning = sum(1 for r in orig_risks if r["severity"] == "warning")
    orig_conflict_people = sum(1 for p in orig_schedule if p["has_conflict"])
    orig_overlap_days    = sum(p["total_overlap_days"] for p in orig_schedule)
    orig_overlap_md      = sum(p["total_overlap_md"] for p in orig_schedule)

    # 시뮬레이션 리스크 (제외 인력 빼고 재계산)
    sim_risks = _analyze_risks(
        target, all_projects, phases, staffings, people_map,
        excluded_keys=excluded
    )
    sim_danger  = sum(1 for r in sim_risks if r["severity"] == "danger")
    sim_warning = sum(1 for r in sim_risks if r["severity"] == "warning")

    # 스케줄 오버랩 시뮬레이션 (제외 인력 반영)
    sim_schedule = _build_schedule_overlap(
        project_id, staffings, phases, people_map, project_map,
        excluded_keys=excluded
    )
    sim_conflict_people = sum(1 for p in sim_schedule if p["has_conflict"])
    sim_overlap_days    = sum(p["total_overlap_days"] for p in sim_schedule)
    sim_overlap_md      = sum(p["total_overlap_md"] for p in sim_schedule)

    # ── 제외 인력별 상세 정보 + 대체 후보 추천 ──────────────────────────────
    excluded_detail = []
    for ex_key in excluded:
        # 원본 schedule에서 해당 인력 정보 찾기
        orig_person = next((p for p in orig_schedule if p["person_key"] == ex_key), None)
        if not orig_person:
            continue

        # 중복 해소 효과: 원본의 overlap_days/md
        resolved_days = orig_person["total_overlap_days"]
        resolved_md   = orig_person["total_overlap_md"]
        conflict_count = len(orig_person["conflicts"])

        # 대체 후보 탐색
        candidates = _find_replacement_candidates(
            ex_key,
            project_id,
            t_start, t_end,
            staffings, phases, people_map,
            need_field    = orig_person.get("my_field", ""),
            need_is_chief = orig_person.get("is_chief", False),
        )

        # 이 인력을 제외했을 때 남은 충돌 요약
        remaining_conflicts = [
            c for p in sim_schedule
            for c in p.get("conflicts", [])
            if p["person_key"] != ex_key
        ]

        excluded_detail.append({
            "person_key":        ex_key,
            "person_name":       orig_person["person_name"],
            "is_chief":          orig_person["is_chief"],
            "grade":             orig_person.get("grade", ""),
            "my_field":          orig_person.get("my_field", ""),
            "my_category":       orig_person.get("my_category", ""),
            "resolved_days":     resolved_days,
            "resolved_md":       resolved_md,
            "conflict_count":    conflict_count,
            "replacement_candidates": candidates,
            "conflicts_summary": [
                {
                    "other_project_name": c["other_project_name"],
                    "type_label":         c["type_label"],
                    "overlap_days":       c["overlap_days"],
                }
                for c in orig_person["conflicts"][:5]
            ],
        })

    # ── 시뮬레이션 기반 제안 사항 생성 ─────────────────────────────────────
    sim_suggestions = []
    if excluded:
        removed_days = orig_overlap_days - sim_overlap_days
        removed_ppl  = orig_conflict_people - sim_conflict_people
        removed_risk = (orig_danger - sim_danger) + (orig_warning - sim_warning)

        if removed_days > 0:
            sim_suggestions.append(
                f"선택한 {len(excluded)}명 제외 시 중복일수 {removed_days}일 감소 "
                f"({orig_overlap_days}일 → {sim_overlap_days}일)"
            )
        if removed_ppl > 0:
            sim_suggestions.append(
                f"중복 인력 {removed_ppl}명 해소 "
                f"({orig_conflict_people}명 → {sim_conflict_people}명)"
            )
        if removed_risk > 0:
            sim_suggestions.append(
                f"리스크 건수 {removed_risk}건 감소 "
                f"({orig_danger + orig_warning}건 → {sim_danger + sim_warning}건)"
            )
        if sim_conflict_people == 0:
            sim_suggestions.append("✅ 선택 인력 제외 시 일정 중복 완전 해소 가능")
        elif sim_conflict_people > 0:
            sim_suggestions.append(
                f"제외 후에도 {sim_conflict_people}명 중복 잔존 — 추가 인력 교체 검토 필요"
            )

        # 대체 인력이 있는 경우 명시
        available_replacements = [
            d for d in excluded_detail
            if any(c["is_available"] for c in d["replacement_candidates"])
        ]
        if available_replacements:
            for ed in available_replacements[:2]:
                avail = [c for c in ed["replacement_candidates"] if c["is_available"]]
                if avail:
                    names = ", ".join(c["person_name"] for c in avail[:2])
                    sim_suggestions.append(
                        f"{ed['person_name']} 대체 후보: {names} (해당 기간 투입 가능)"
                    )
    else:
        sim_suggestions.append("제외할 인력을 선택하면 리스크 감소 효과를 시뮬레이션합니다")

    return {
        "project_id":      project_id,
        "excluded_keys":   list(excluded),
        "original": {
            "danger":          orig_danger,
            "warning":         orig_warning,
            "conflict_people": orig_conflict_people,
            "overlap_days":    orig_overlap_days,
            "overlap_md":      orig_overlap_md,
        },
        "simulated": {
            "danger":          sim_danger,
            "warning":         sim_warning,
            "conflict_people": sim_conflict_people,
            "overlap_days":    sim_overlap_days,
            "overlap_md":      sim_overlap_md,
        },
        "delta": {
            "danger":          orig_danger  - sim_danger,
            "warning":         orig_warning - sim_warning,
            "conflict_people": orig_conflict_people - sim_conflict_people,
            "overlap_days":    orig_overlap_days    - sim_overlap_days,
            "overlap_md":      orig_overlap_md      - sim_overlap_md,
        },
        "suggestions":    sim_suggestions,
        "excluded_detail": excluded_detail,
        "risks":   sim_risks,
        "people":  sim_schedule,
    }


# ── 최적화 시뮬레이션 스키마 ──────────────────────────────────────────────────
class OptimizeRequest(BaseModel):
    """최적 인력/일정 추천 요청 (DB 변경 없음)"""
    pass  # 향후 옵션 추가 가능


class SimulateV2Request(BaseModel):
    """인력 교체 + 일정 이동 시뮬레이션 요청 (DB 변경 없음)"""
    # 인력 교체: {old_person_key: new_person_id}
    person_replacements: Dict[str, Optional[int]] = {}
    # 일정 이동: {phase_id: {start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD"}}
    phase_shifts: Dict[int, Dict[str, str]] = {}


# ── 헬퍼: 해당 기간 가용 인력 풀 수집 ────────────────────────────────────────
def _get_available_people(
    project_id: int,
    t_start: Optional[date],
    t_end: Optional[date],
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
    need_field: str = "",
    need_is_chief: bool = False,
    exclude_keys: Optional[set] = None,
    top_n: int = 5,
) -> List[Dict]:
    """
    해당 기간(t_start~t_end)에 가용한 인력을 반환.
    - 본사업에 이미 배정된 인력은 제외
    - 분야(field) 유사도 기준 필터
    - is_chief 필요 시 chief만 포함
    """
    if not t_start or not t_end:
        return []

    exclude_keys = exclude_keys or set()
    ph_map = {p.id: p for p in phases}

    # 이미 배정된 인력 키
    assigned_keys: set = set()
    for s in staffings:
        if s.project_id == project_id:
            key, _, _, _ = _resolve_person_key(s, people_map)
            if key:
                assigned_keys.add(key)

    # 전체 인력 busy 기간
    person_busy: Dict[str, List[Tuple[date, date]]] = {}
    for s in staffings:
        ph = ph_map.get(s.phase_id)
        if not ph or not ph.start_date or not ph.end_date:
            continue
        key, _, _, _ = _resolve_person_key(s, people_map)
        if not key:
            continue
        person_busy.setdefault(key, []).append((ph.start_date, ph.end_date))

    candidates = []
    for person in people_map.values():
        if person.deleted_at:
            continue
        p_key = f"id:{person.id}"
        if p_key in assigned_keys or p_key in exclude_keys:
            continue
        if need_is_chief and not person.is_chief:
            continue

        # 분야 매칭
        if need_field:
            matched = False
            for s in staffings:
                if s.person_id == person.id:
                    s_field = (s.field or "").strip()
                    if need_field in s_field or s_field in need_field:
                        matched = True
                        break
            if not matched:
                continue

        # 가용 여부
        is_available = not any(
            _dates_overlap(t_start, t_end, bs, be)
            for bs, be in person_busy.get(p_key, [])
        )

        # 중복일수 계산 (참고용)
        conflict_days = sum(
            _overlap_days(t_start, t_end, bs, be)
            for bs, be in person_busy.get(p_key, [])
        )

        candidates.append({
            "person_id":     person.id,
            "person_name":   person.person_name,
            "person_key":    p_key,
            "is_chief":      bool(person.is_chief),
            "grade":         person.grade or "",
            "position":      person.position or "",
            "company":       person.company or "",
            "is_available":  is_available,
            "conflict_days": conflict_days,
            "can_travel":    person.can_travel if person.can_travel is not None else True,
        })

    candidates.sort(key=lambda c: (0 if c["is_available"] else 1, c["conflict_days"], c["person_name"]))
    return candidates[:top_n]


@router.post("/{project_id}/optimize")
async def optimize_risk(
    project_id: int,
    body: OptimizeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    [DB 격리 보장] DB에 쓰기 없음 — 읽기+메모리 계산만 수행.

    현재 배정 상태를 분석하여:
    1. 최적 인력 교체 안 추천 (중복 인력 → 가용 대체 인력)
    2. 최적 일정 이동 안 추천 (중복 구간 → 착수 연기/단계 조정)
    3. 각 개선안의 예상 리스크 감소 효과 계산
    """
    from fastapi import HTTPException
    from datetime import timedelta

    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Project not found")

    t_start, t_end = _project_date_range(project_id, phases)
    t_phases_sorted = sorted(
        [ph for ph in phases if ph.project_id == project_id and ph.start_date and ph.end_date],
        key=lambda p: p.start_date
    )

    # 현재 리스크 / 스케줄 계산
    orig_risks = _analyze_risks(target, all_projects, phases, staffings, people_map)
    orig_schedule = _build_schedule_overlap(project_id, staffings, phases, people_map, project_map)
    orig_danger  = sum(1 for r in orig_risks if r["severity"] == "danger")
    orig_warning = sum(1 for r in orig_risks if r["severity"] == "warning")
    orig_conflict_people = sum(1 for p in orig_schedule if p["has_conflict"])
    orig_overlap_days    = sum(p["total_overlap_days"] for p in orig_schedule)
    orig_overlap_md      = sum(p["total_overlap_md"]   for p in orig_schedule)

    # ── 안 A: 인력 교체 추천 ────────────────────────────────────────────────
    person_replace_options: List[Dict] = []
    conflict_people = [p for p in orig_schedule if p["has_conflict"]]

    for cp in conflict_people:
        pk = cp["person_key"]
        # 대체 인력 찾기
        alternates = _get_available_people(
            project_id, t_start, t_end,
            staffings, phases, people_map,
            need_field=cp.get("my_field", ""),
            need_is_chief=cp.get("is_chief", False),
            exclude_keys={pk},
            top_n=3,
        )

        # 이 인력 제외 시 예상 리스크 감소
        sim_risks_if_excluded = _analyze_risks(
            target, all_projects, phases, staffings, people_map,
            excluded_keys={pk}
        )
        sim_schedule_if_excluded = _build_schedule_overlap(
            project_id, staffings, phases, people_map, project_map,
            excluded_keys={pk}
        )
        exc_danger  = sum(1 for r in sim_risks_if_excluded if r["severity"] == "danger")
        exc_warning = sum(1 for r in sim_risks_if_excluded if r["severity"] == "warning")
        exc_overlap = sum(p["total_overlap_days"] for p in sim_schedule_if_excluded)

        person_replace_options.append({
            "person_key":        pk,
            "person_name":       cp["person_name"],
            "is_chief":          cp["is_chief"],
            "grade":             cp.get("grade", ""),
            "my_field":          cp.get("my_field", ""),
            "my_category":       cp.get("my_category", ""),
            "conflict_days":     cp["total_overlap_days"],
            "conflict_md":       cp["total_overlap_md"],
            "conflicts_count":   len(cp["conflicts"]),
            # 교체 시 예상 효과
            "expected_danger_delta":  orig_danger  - exc_danger,
            "expected_warning_delta": orig_warning - exc_warning,
            "expected_overlap_delta": orig_overlap_days - exc_overlap,
            # 대체 후보
            "alternates": alternates,
        })

    # 효과 큰 순으로 정렬
    person_replace_options.sort(
        key=lambda x: (-x["expected_danger_delta"], -x["expected_overlap_delta"])
    )

    # ── 안 B: 일정 이동 추천안 3개 (리스크 큼→중간→0) ──────────────────────────
    # 헬퍼: 주어진 delay_days로 shifted phases 목록 생성
    def _make_shifted_phases(delay: int) -> List[Dict]:
        return [
            {
                "phase_id":   ph.id,
                "phase_name": ph.phase_name,
                "orig_start": str(ph.start_date),
                "orig_end":   str(ph.end_date),
                "new_start":  str(ph.start_date + timedelta(days=delay)),
                "new_end":    str(ph.end_date   + timedelta(days=delay)),
                "shift_days": delay,
            }
            for ph in t_phases_sorted
        ]

    # 헬퍼: 시뮬레이션 phase_shifts 딕셔너리 생성 후 실제 리스크 계산
    def _calc_risk_for_shift(delay: int) -> Dict:
        if delay <= 0:
            return {
                "danger": orig_danger,
                "warning": orig_warning,
                "conflict_people": orig_conflict_people,
                "overlap_days": orig_overlap_days,
                "overlap_md": orig_overlap_md,
            }
        import copy as _copy
        virtual_phases = []
        for ph in phases:
            if ph.project_id == project_id and ph.start_date and ph.end_date:
                v = _copy.copy(ph)
                v.start_date = ph.start_date + timedelta(days=delay)
                v.end_date   = ph.end_date   + timedelta(days=delay)
                virtual_phases.append(v)
            else:
                virtual_phases.append(ph)
        sim_risks    = _analyze_risks(target, all_projects, virtual_phases, staffings, people_map)
        sim_schedule = _build_schedule_overlap(project_id, staffings, virtual_phases, people_map, project_map)
        return {
            "danger":          sum(1 for r in sim_risks if r["severity"] == "danger"),
            "warning":         sum(1 for r in sim_risks if r["severity"] == "warning"),
            "conflict_people": sum(1 for p in sim_schedule if p["has_conflict"]),
            "overlap_days":    sum(p["total_overlap_days"] for p in sim_schedule),
            "overlap_md":      sum(p["total_overlap_md"]   for p in sim_schedule),
        }

    phase_shift_options: List[Dict] = []

    if t_start and t_end and t_phases_sorted and conflict_people:
        # 모든 중복 종료일 수집
        all_overlap_ends: List[date] = []
        for cp in conflict_people:
            for c in cp["conflicts"]:
                try:
                    all_overlap_ends.append(date.fromisoformat(c["overlap_end"]))
                except Exception:
                    pass

        if all_overlap_ends:
            max_overlap_end = max(all_overlap_ends)
            # 중복이 완전히 없어지려면 이 일수만큼 연기해야 함
            # 초기 추정치: 현재 가시적인 최대 overlap_end + 1일
            zero_delay = (max_overlap_end - t_start).days + 1

            # 이동 후 새로운 중복이 발생할 수 있으므로 실제로 충돌이 0이 될 때까지 반복 계산
            # (최대 10회 반복으로 무한루프 방지)
            for _iter in range(10):
                sim_check = _calc_risk_for_shift(zero_delay)
                if sim_check["conflict_people"] == 0:
                    break
                # 이동 후에도 충돌이 남아있으면: 새 충돌의 overlap_end를 찾아 더 이동
                import copy as _cp
                _vphases_check = []
                for ph in phases:
                    if ph.project_id == project_id and ph.start_date and ph.end_date:
                        v = _cp.copy(ph)
                        v.start_date = ph.start_date + timedelta(days=zero_delay)
                        v.end_date   = ph.end_date   + timedelta(days=zero_delay)
                        _vphases_check.append(v)
                    else:
                        _vphases_check.append(ph)
                _sched_check = _build_schedule_overlap(project_id, staffings, _vphases_check, people_map, project_map)
                _new_ends: List[date] = []
                for _cp2 in _sched_check:
                    if _cp2["has_conflict"]:
                        for _c in _cp2["conflicts"]:
                            try:
                                _new_ends.append(date.fromisoformat(_c["overlap_end"]))
                            except Exception:
                                pass
                if not _new_ends:
                    break
                _new_max = max(_new_ends)
                # 새 t_start = t_start + zero_delay; 새 zero_delay 기준으로 추가 이동량 계산
                _extra = (_new_max - (t_start + timedelta(days=zero_delay))).days + 1
                if _extra <= 0:
                    break
                zero_delay += _extra

            # ── 안 1: 최소변경 (리스크 큼) ─────────────────────────────────
            # 모든 중복 중 가장 짧은 것만 해소 (1/3 수준 연기)
            min_overlap_end = min(all_overlap_ends)
            minimal_delay = max(1, (min_overlap_end - t_start).days + 1)
            # 최소 7일 이상은 돼야 의미 있음
            if minimal_delay < 7:
                minimal_delay = 7
            if minimal_delay >= zero_delay:
                minimal_delay = max(1, zero_delay // 3)

            sim_minimal = _calc_risk_for_shift(minimal_delay)
            phase_shift_options.append({
                "option_id":   "delay_minimal",
                "risk_level":  "high",
                "label":       f"최소 변경안 ({minimal_delay}일 연기)",
                "description": (
                    f"전체 일정을 {minimal_delay}일 뒤로 이동 — "
                    f"일부 중복 해소, 일정 변경 최소화"
                ),
                "shift_days":  minimal_delay,
                "new_start":   str(t_start + timedelta(days=minimal_delay)),
                "new_end":     str(t_end   + timedelta(days=minimal_delay)),
                "phases":      _make_shifted_phases(minimal_delay),
                "simulated":   sim_minimal,
            })

            # ── 안 2: 중간 (리스크 중간) ────────────────────────────────────
            # 중복 인력 중 과반수 해소 (2/3 수준)
            # 총괄급 중복이 있으면 총괄급 중복 끝나는 날 기준
            chief_ends = [
                date.fromisoformat(c["overlap_end"])
                for cp in conflict_people if cp.get("is_chief")
                for c in cp["conflicts"]
                if "overlap_end" in c
            ]
            if chief_ends:
                medium_delay = (max(chief_ends) - t_start).days + 1
            else:
                medium_delay = max(minimal_delay + 1, zero_delay * 2 // 3)

            # minimal과 zero 사이여야 함
            if medium_delay <= minimal_delay:
                medium_delay = (minimal_delay + zero_delay) // 2
            if medium_delay >= zero_delay:
                medium_delay = max(minimal_delay + 1, zero_delay - 1)

            if medium_delay != minimal_delay:
                sim_medium = _calc_risk_for_shift(medium_delay)
                phase_shift_options.append({
                    "option_id":   "delay_medium",
                    "risk_level":  "medium",
                    "label":       f"중간 변경안 ({medium_delay}일 연기)",
                    "description": (
                        f"전체 일정을 {medium_delay}일 뒤로 이동 — "
                        f"주요 인력(총괄급) 중복 해소"
                    ),
                    "shift_days":  medium_delay,
                    "new_start":   str(t_start + timedelta(days=medium_delay)),
                    "new_end":     str(t_end   + timedelta(days=medium_delay)),
                    "phases":      _make_shifted_phases(medium_delay),
                    "simulated":   sim_medium,
                })

            # ── 안 3: 일정중복 완전 제로 (리스크 0) ─────────────────────────
            if zero_delay > 0:
                sim_zero = _calc_risk_for_shift(zero_delay)
                phase_shift_options.append({
                    "option_id":   "delay_zero_conflict",
                    "risk_level":  "low",
                    "label":       f"중복 제로안 ({zero_delay}일 연기)",
                    "description": (
                        f"전체 일정을 {zero_delay}일 뒤로 이동 — "
                        f"모든 인력 일정 중복 완전 해소"
                    ),
                    "shift_days":  zero_delay,
                    "new_start":   str(t_start + timedelta(days=zero_delay)),
                    "new_end":     str(t_end   + timedelta(days=zero_delay)),
                    "phases":      _make_shifted_phases(zero_delay),
                    "simulated":   sim_zero,
                })

    # ── 최적 조합 제안 (가장 효과 큰 안 = 중복제로 안) ────────────────────────
    best_combo: Dict = {}
    zero_opt = next((o for o in phase_shift_options if o["option_id"] == "delay_zero_conflict"), None)
    medium_opt = next((o for o in phase_shift_options if o["option_id"] == "delay_medium"), None)
    top_shift = zero_opt or medium_opt or (phase_shift_options[0] if phase_shift_options else None)

    if person_replace_options and top_shift:
        top_replace = person_replace_options[0]
        best_combo = {
            "label": "최적 조합 안",
            "description": (
                f"① {top_replace['person_name']} 교체 + "
                f"② {top_shift['label']} 적용 시 리스크 최소화 예상"
            ),
            "replace": top_replace,
            "shift":   top_shift,
            "expected_danger":  max(0, orig_danger  - top_replace["expected_danger_delta"]),
            "expected_warning": max(0, orig_warning - top_replace["expected_warning_delta"]),
        }
    elif person_replace_options:
        top_replace = person_replace_options[0]
        best_combo = {
            "label": "인력 교체 최적 안",
            "description": f"{top_replace['person_name']}을 대체 인력으로 교체 시 리스크 최소화",
            "replace": top_replace,
            "shift":   None,
            "expected_danger":  max(0, orig_danger  - top_replace["expected_danger_delta"]),
            "expected_warning": max(0, orig_warning - top_replace["expected_warning_delta"]),
        }
    elif top_shift:
        best_combo = {
            "label": "일정 이동 최적 안",
            "description": top_shift["label"],
            "replace": None,
            "shift":   top_shift,
            "expected_danger":  top_shift["simulated"]["danger"],
            "expected_warning": top_shift["simulated"]["warning"],
        }

    return {
        "project_id":          project_id,
        "project_name":        target.project_name,
        "current": {
            "danger":          orig_danger,
            "warning":         orig_warning,
            "conflict_people": orig_conflict_people,
            "overlap_days":    orig_overlap_days,
            "overlap_md":      orig_overlap_md,
        },
        "person_replace_options":  person_replace_options,
        "phase_shift_options":     phase_shift_options,
        "best_combo":              best_combo,
        "phases": [
            {
                "phase_id":   ph.id,
                "phase_name": ph.phase_name,
                "start_date": str(ph.start_date),
                "end_date":   str(ph.end_date),
                "sort_order": getattr(ph, "sort_order", 9999),
            }
            for ph in t_phases_sorted
        ],
    }


def _build_all_people_for_sim(
    project_id: int,
    virtual_phases: list,
    virtual_staffings: list,
    people_map: Dict[int, Any],
    sim_schedule: List[Dict],
) -> List[Dict]:
    """
    시뮬레이션(일정 이동 + 인력 교체) 컨텍스트에서
    각 인력의 가용 여부를 재계산하여 반환.

    - virtual_phases: 이동된 가상 phase 목록
    - virtual_staffings: 교체 후 가상 staffing 목록
    - sim_schedule: 이미 계산된 시뮬레이션 결과 (sim_schedule의 person_key 기준)

    반환: all-people API와 동일한 구조의 리스트
    (is_available이 이동된 일정 기준으로 재계산됨)
    """
    # 이동된 프로젝트의 날짜 범위
    t_start, t_end = _project_date_range_from_phases(project_id, virtual_phases)

    # 현재 시뮬레이션에서 배정된 인력 키
    assigned_keys = {p["person_key"] for p in sim_schedule}

    # 전체 인력 busy 기간 (target 프로젝트 제외)
    ph_map = {p.id: p for p in virtual_phases}
    person_busy: Dict[str, List[Tuple[date, date]]] = {}
    for s in virtual_staffings:
        if s.project_id == project_id:
            continue  # target 프로젝트 자신의 배정은 busy에서 제외
        ph = ph_map.get(s.phase_id)
        if not ph or not ph.start_date or not ph.end_date:
            continue
        key, _, _, _ = _resolve_person_key(s, people_map)
        if not key:
            continue
        person_busy.setdefault(key, []).append((ph.start_date, ph.end_date))

    all_people_list = []
    for person in people_map.values():
        if person.deleted_at:
            continue
        p_key = f"id:{person.id}"
        is_assigned = p_key in assigned_keys

        conflict_days = 0
        is_available = True
        if t_start and t_end:
            for bs, be in person_busy.get(p_key, []):
                od = _overlap_days(t_start, t_end, bs, be)
                conflict_days += od
            is_available = conflict_days == 0

        # 분야 정보
        person_fields: set = set()
        for s in virtual_staffings:
            s_key, _, _, _ = _resolve_person_key(s, people_map)
            if s_key == p_key and s.field:
                person_fields.add(s.field.strip())

        person_main_field = next(iter(person_fields), "")

        all_people_list.append({
            "person_id":    person.id,
            "person_key":   p_key,
            "person_name":  person.person_name,
            "grade":        person.grade or "",
            "position":     person.position or "",
            "company":      person.company or "",
            "is_chief":     bool(person.is_chief),
            "is_assigned":  is_assigned,
            "is_available": is_available,
            "conflict_days": conflict_days,
            "my_field":     person_main_field,
            "field_match":  False,  # 프론트에서 person.my_field 기준으로 판단
            "can_travel":   person.can_travel if person.can_travel is not None else True,
        })

    all_people_list.sort(key=lambda p: (
        1 if p["is_assigned"] else 0,   # 본사업 배정중 인력은 최하위
        0 if p["is_available"] else 1,
        p["conflict_days"],
        p["person_name"],
    ))
    return all_people_list


def _project_date_range_from_phases(project_id: int, phases: list):
    """virtual_phases 기반 프로젝트 날짜 범위 계산"""
    dates = [
        (ph.start_date, ph.end_date)
        for ph in phases
        if ph.project_id == project_id and ph.start_date and ph.end_date
    ]
    if not dates:
        return None, None
    return min(d[0] for d in dates), max(d[1] for d in dates)


@router.post("/{project_id}/simulate-v2")
async def simulate_risk_v2(
    project_id: int,
    body: SimulateV2Request,
    db: AsyncSession = Depends(get_db),
):
    """
    [DB 격리 보장] DB에 쓰기 없음 — 읽기+메모리 계산만 수행.

    인력 교체 + 일정 이동을 동시에 시뮬레이션:
    - person_replacements: {old_person_key: new_person_id} — old 제거 후 new 투입
    - phase_shifts: {phase_id: {start_date, end_date}} — 해당 phase 날짜 가상 변경

    원본 DB는 절대 변경되지 않으며 메모리에서만 계산.
    """
    from fastapi import HTTPException
    from datetime import timedelta
    import copy

    all_projects, phases, staffings, peoples = await _load_all(db)
    people_map = {p.id: p for p in peoples}
    project_map = {p.id: p for p in all_projects}

    target = next((p for p in all_projects if p.id == project_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Project not found")

    # ── 원본 리스크/스케줄 ────────────────────────────────────────────────────
    orig_risks    = _analyze_risks(target, all_projects, phases, staffings, people_map)
    orig_schedule = _build_schedule_overlap(project_id, staffings, phases, people_map, project_map)
    orig_danger   = sum(1 for r in orig_risks if r["severity"] == "danger")
    orig_warning  = sum(1 for r in orig_risks if r["severity"] == "warning")
    orig_conflict = sum(1 for p in orig_schedule if p["has_conflict"])
    orig_days     = sum(p["total_overlap_days"] for p in orig_schedule)
    orig_md       = sum(p["total_overlap_md"]   for p in orig_schedule)

    # ── 가상 staffing / phases 목록 생성 (메모리 조작, DB 불변) ──────────────
    # 1) phase 날짜 이동 적용
    phase_shift_map = {}  # phase_id → (new_start, new_end)
    for phase_id_str, dates in body.phase_shifts.items():
        try:
            pid_int = int(phase_id_str)
            ns = date.fromisoformat(dates["start_date"])
            ne = date.fromisoformat(dates["end_date"])
            phase_shift_map[pid_int] = (ns, ne)
        except Exception:
            continue

    # 가상 phase 객체 생성 (SimpleNamespace 사용)
    from types import SimpleNamespace

    def _make_virtual_phases(phases, phase_shift_map):
        result = []
        for ph in phases:
            if ph.id in phase_shift_map:
                ns_date, ne_date = phase_shift_map[ph.id]
                vph = SimpleNamespace(
                    id=ph.id,
                    project_id=ph.project_id,
                    phase_name=ph.phase_name,
                    start_date=ns_date,
                    end_date=ne_date,
                    sort_order=getattr(ph, "sort_order", 9999),
                    deleted_at=ph.deleted_at,
                )
            else:
                vph = ph
            result.append(vph)
        return result

    virtual_phases = _make_virtual_phases(phases, phase_shift_map)

    # 2) 인력 교체 적용
    # person_replacements = {old_key: new_person_id or None}
    # old_key 인력을 제거하고, new_person_id 가 있으면 같은 위치에 새 인력을 넣은 것처럼 시뮬레이션
    # → old_key를 excluded_keys에 추가하고, new staffing 레코드를 가상으로 추가

    replacements_raw = body.person_replacements  # {old_key: new_person_id}

    # ── 체인 압축: A→B, B→C → A→C / B는 중간 노드 제거 ──────────────────────
    # 중간 노드 판단: new_pid 값들 → 그 id의 "id:N" key가 old_key에 있으면 중간
    _raw_new_pids: set = {v for v in replacements_raw.values() if v}
    def _is_mid(key: str) -> bool:
        if key.startswith("id:"):
            try: return int(key[3:]) in _raw_new_pids
            except ValueError: pass
        return False

    def _resolve_final_pid(key: str, visited: set) -> Optional[int]:
        if key in visited:
            return None
        visited.add(key)
        pid = replacements_raw.get(key)
        if pid is None:
            return None
        nk = f"id:{pid}"
        if nk in replacements_raw:
            return _resolve_final_pid(nk, visited)
        return pid

    # 체인 압축된 최종 교체 맵 {original_old_key: final_new_pid}
    replacements: Dict[str, Optional[int]] = {}
    for k in replacements_raw:
        if _is_mid(k):
            continue  # 중간 노드는 독립 교체로 처리하지 않음
        replacements[k] = _resolve_final_pid(k, set())

    excluded_old_keys = set(replacements.keys())

    # 교체 대상 new_pid들 수집:
    # new_pid가 본사업에 이미 직접 배정된 경우 그 배정도 제거해야 중복 계산 방지
    # 예) 손정순→이동영, id:168→진기호 동시 교체 시
    #     이동영이 본사업에 원래 배정된 경우 → 이동영 원본 배정 제거 필요
    new_person_ids_as_replacements = {
        new_pid for new_pid in replacements.values() if new_pid
    }
    # new_pid의 person_key 계산 (id:N 형식 또는 name 키)
    excluded_new_keys: set = set()
    for s in staffings:
        if s.project_id != project_id:
            continue
        s_key, _, _, _ = _resolve_person_key(s, people_map)
        pid = s.person_id
        if pid and pid in new_person_ids_as_replacements:
            excluded_new_keys.add(s_key)

    # 가상 staffing 생성: 교체 인력의 기존 배정 위치에 새 인력을 배치
    virtual_staffings = list(staffings)  # 원본 참조 (읽기 전용)

    added_virtual: List[Any] = []
    for old_key, new_pid in replacements.items():
        if not new_pid:
            continue
        # 새 인력이 DB에 없으면 스킵
        if new_pid not in people_map:
            continue

        # old_key의 본사업 배정 staffing 레코드를 찾아서 new_pid로 교체한 가상 레코드 생성
        for s in staffings:
            if s.project_id != project_id:
                continue
            s_key, _, _, _ = _resolve_person_key(s, people_map)
            if s_key != old_key:
                continue
            # 가상 staffing 레코드
            # id는 음수로 표시하되, sort_key 계산에는 원본 s.id(양수)를 사용하여
            # 정렬 순서가 유지되도록 orig_id 속성을 별도 보존
            vs = SimpleNamespace(
                id=-s.id,                        # 음수 id로 가상 표시
                orig_id=s.id,                    # 정렬 순서 유지용 원본 id
                orig_person_key=old_key,         # 교체 전 원본 person_key (프론트 교체 드롭다운 연결용)
                project_id=s.project_id,
                phase_id=s.phase_id,
                person_id=new_pid,
                person_name_text=None,
                field=s.field,
                sub_field=s.sub_field,
                category=s.category,
                md=s.md,
                deleted_at=None,
            )
            added_virtual.append(vs)

    # 가상 staffing = 원본(excluded 제거) + 추가 가상
    def _filter_excluded(staffings, excluded_keys, people_map, project_id):
        result = []
        for s in staffings:
            if s.project_id == project_id:
                key, _, _, _ = _resolve_person_key(s, people_map)
                if key in excluded_keys:
                    continue
            result.append(s)
        return result

    # excluded_old_keys(교체 대상 원본) + excluded_new_keys(교체 인력의 기존 본사업 배정) 모두 제거
    all_excluded_keys = excluded_old_keys | excluded_new_keys
    virtual_staffings_filtered = _filter_excluded(virtual_staffings, all_excluded_keys, people_map, project_id)
    virtual_staffings_final = virtual_staffings_filtered + added_virtual

    # ── 시뮬레이션 리스크/스케줄 계산 ────────────────────────────────────────
    sim_risks = _analyze_risks(
        target, all_projects, virtual_phases, virtual_staffings_final, people_map
    )
    sim_schedule = _build_schedule_overlap(
        project_id, virtual_staffings_final, virtual_phases, people_map, project_map
    )

    # ── sim_schedule에 orig_person_key 보정 ──────────────────────────────────
    # _build_schedule_overlap 내 person_best 경쟁으로 orig_person_key가 누락/오염될 수 있으므로
    # replacements(old_key → new_pid) 맵을 기반으로 직접 보정
    new_pid_to_old_key: Dict[int, str] = {v: k for k, v in replacements.items() if v}
    for person_entry in sim_schedule:
        pid = person_entry.get("person_id")
        if pid and pid in new_pid_to_old_key:
            person_entry["orig_person_key"] = new_pid_to_old_key[pid]

    sim_danger   = sum(1 for r in sim_risks if r["severity"] == "danger")
    sim_warning  = sum(1 for r in sim_risks if r["severity"] == "warning")
    sim_conflict = sum(1 for p in sim_schedule if p["has_conflict"])
    sim_days     = sum(p["total_overlap_days"] for p in sim_schedule)
    sim_md       = sum(p["total_overlap_md"]   for p in sim_schedule)

    # ── 교체 인력 요약 (체인 압축) ───────────────────────────────────────────
    # A→B, B→C 같은 체인은 A→C 하나로 압축.
    # "중간 노드"(다른 교체의 결과로 투입된 new_pid와 old_key가 일치하는 항목)는 제외.
    replacement_summary = []
    orig_schedule_map = {p["person_key"]: p for p in orig_schedule}

    # new_pid 집합으로 사용되는 id들 → 그 id의 person_key를 중간 노드로 간주
    new_pid_values: set = {v for v in replacements.values() if v}
    # old_key가 "id:N" 형식이고 N이 new_pid_values에 있으면 중간 노드
    def _is_intermediate(key: str) -> bool:
        if key.startswith("id:"):
            try:
                return int(key[3:]) in new_pid_values
            except ValueError:
                pass
        return False

    # 체인 추적: old_key에서 출발해 최종 new_pid 반환 (순환 방지)
    def _resolve_chain(key: str, visited: set) -> Optional[int]:
        if key in visited:
            return None
        visited.add(key)
        pid = replacements.get(key)
        if pid is None:
            return None
        next_key = f"id:{pid}"
        if next_key in replacements:
            return _resolve_chain(next_key, visited)
        return pid

    for old_key in replacements:
        # 중간 노드는 별도 줄로 표시하지 않음
        if _is_intermediate(old_key):
            continue

        final_pid = _resolve_chain(old_key, set())
        old_person = orig_schedule_map.get(old_key)
        new_person = people_map.get(final_pid) if final_pid else None

        # old_name
        if old_person:
            old_name = old_person["person_name"]
            old_conflict_days = old_person["total_overlap_days"]
        else:
            old_name = old_key
            old_conflict_days = 0
            if old_key.startswith("id:"):
                try:
                    old_pid_int = int(old_key[3:])
                    old_p = people_map.get(old_pid_int)
                    if old_p:
                        old_name = old_p.person_name
                except ValueError:
                    pass

        replacement_summary.append({
            "old_key":           old_key,
            "old_name":          old_name,
            "old_conflict_days": old_conflict_days,
            "new_person_id":     final_pid,
            "new_name":          new_person.person_name if new_person else "(제외만)",
            "new_is_chief":      bool(new_person.is_chief) if new_person else False,
            "new_grade":         new_person.grade or "" if new_person else "",
        })

    # ── 일정 이동 요약 ────────────────────────────────────────────────────────
    shift_summary = []
    for ph in phases:
        if ph.id in phase_shift_map:
            ns, ne = phase_shift_map[ph.id]
            shift_days = (ns - ph.start_date).days
            shift_summary.append({
                "phase_id":   ph.id,
                "phase_name": ph.phase_name,
                "orig_start": str(ph.start_date),
                "orig_end":   str(ph.end_date),
                "new_start":  str(ns),
                "new_end":    str(ne),
                "shift_days": shift_days,
            })

    # ── 시뮬레이션 제안 메시지 ────────────────────────────────────────────────
    suggestions = []
    delta_danger  = orig_danger  - sim_danger
    delta_warning = orig_warning - sim_warning
    delta_days    = orig_days    - sim_days
    delta_ppl     = orig_conflict - sim_conflict

    if delta_danger > 0:
        suggestions.append(f"위험 리스크 {delta_danger}건 해소 ({orig_danger} → {sim_danger}건)")
    if delta_warning > 0:
        suggestions.append(f"주의 리스크 {delta_warning}건 해소 ({orig_warning} → {sim_warning}건)")
    if delta_days > 0:
        suggestions.append(f"중복 일수 {delta_days}일 감소 ({orig_days} → {sim_days}일)")
    if delta_ppl > 0:
        suggestions.append(f"중복 인력 {delta_ppl}명 해소 ({orig_conflict} → {sim_conflict}명)")
    if sim_conflict == 0 and (replacements or phase_shift_map):
        suggestions.append("✅ 이 조합으로 모든 일정 중복 완전 해소 가능")
    elif sim_conflict > 0:
        suggestions.append(f"적용 후에도 {sim_conflict}명 중복 잔존 — 추가 조정 검토 필요")
    if not suggestions:
        suggestions.append("현재 조합에서는 리스크 변화 없음")

    return {
        "project_id": project_id,
        "original": {
            "danger":          orig_danger,
            "warning":         orig_warning,
            "conflict_people": orig_conflict,
            "overlap_days":    orig_days,
            "overlap_md":      orig_md,
        },
        "simulated": {
            "danger":          sim_danger,
            "warning":         sim_warning,
            "conflict_people": sim_conflict,
            "overlap_days":    sim_days,
            "overlap_md":      sim_md,
        },
        "delta": {
            "danger":          delta_danger,
            "warning":         delta_warning,
            "conflict_people": delta_ppl,
            "overlap_days":    delta_days,
            "overlap_md":      orig_md - sim_md,
        },
        "replacement_summary": replacement_summary,
        "shift_summary":       shift_summary,
        "suggestions":         suggestions,
        "risks":               sim_risks,
        "people":              sim_schedule,
        "all_people_updated":  _build_all_people_for_sim(
            project_id, virtual_phases, virtual_staffings_final, people_map, sim_schedule
        ),
    }
