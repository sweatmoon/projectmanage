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


def _get_sort_key(category: str, field: str) -> Tuple[int, int]:
    """
    ScheduleTab resolveTeamInfo 와 동일한 정렬 키 반환.
    반환: (sortGroup, sortOrder)
      단계감리팀 → sortGroup=0, sortOrder= field 순서(0~3, 나머지 4)
      전문가팀   → sortGroup=1, sortOrder=999
    """
    cat = (category or "").strip()
    fld = (field or "").strip()

    if cat in _STAGE_CATEGORIES:
        for pattern, order in _STAGE_FIELD_ORDER:
            if pattern.search(fld):
                return (0, order)
        return (0, 4)

    if cat in _EXPERT_CATEGORIES:
        return (1, 999)

    # category 미설정: field로 판단
    for pattern, order in _STAGE_FIELD_ORDER:
        if pattern.search(fld):
            return (0, order)
    return (1, 999)


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
        key, name, is_chief, _ = _resolve_person_key(s, people_map)
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

        suggestions = ["중복 인력을 대체 가능한 인력으로 교체 검토"]
        if t_start and t_end:
            suggestions.append("본 사업 일정을 타 사업 종료 후로 조정 검토")
        if chief_conflicts:
            suggestions.append("총괄감리원 중복은 수행 품질에 직접 영향 — 최우선 해소 필요")

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


# ── 본사업 인력 배치 목록 (ScheduleTab 정렬 기준) ─────────────────────────────
def _get_target_staffing_people(
    target_project_id: int,
    staffings: list,
    phases: list,
    people_map: Dict[int, Any],
) -> List[Dict]:
    """
    본사업(제안) 인력을 ScheduleTab과 동일한 순서로 반환.
    정렬: (sortGroup, sortOrder, phase.sort_order, staffing.id)
      - sortGroup: 단계감리팀=0, 전문가팀=1
      - sortOrder: 사업관리=0, 응용시스템=1, DB=2, 시스템구조=3, 기타=4/999
      - phase.sort_order: 단계 순서
      - staffing.id: 동일 단계/분야 내 순서
    """
    ph_map = {p.id: p for p in phases}
    t_staffings = [s for s in staffings if s.project_id == target_project_id]

    # 인력별 첫 번째 staffing 레코드 수집 (정렬 키 계산용)
    # 동일 인력이 여러 phase에 있을 경우, 가장 우선순위 높은(sort_key 작은) 것 사용
    person_best: Dict[str, Dict] = {}  # key → {sort_key, staffing, person_obj}

    for s in t_staffings:
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key:
            continue
        phase = ph_map.get(s.phase_id)
        phase_sort = phase.sort_order if phase and hasattr(phase, 'sort_order') else 9999
        sg, so = _get_sort_key(s.category or "", s.field or "")
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

    # 인력별로 가장 우선순위 높은 staffing 레코드로 분야/정렬키 결정
    person_best: Dict[str, Dict] = {}
    for s in t_staffings:
        key, name, is_chief, person_obj = _resolve_person_key(s, people_map)
        if not key:
            continue
        phase = ph_map.get(s.phase_id)
        phase_sort = phase.sort_order if phase and hasattr(phase, 'sort_order') else 9999
        sg, so = _get_sort_key(s.category or "", s.field or "")
        sort_key = (sg, so, phase_sort, s.id)

        if key not in person_best or sort_key < person_best[key]["sort_key"]:
            person_best[key] = {
                "sort_key":   sort_key,
                "staffing":   s,
                "person_obj": person_obj,
                "person_name": name,
                "is_chief":   is_chief,
            }

    # ScheduleTab과 동일한 정렬 순서 유지
    sorted_people = sorted(person_best.items(), key=lambda kv: kv[1]["sort_key"])

    person_field_map: Dict[str, Dict] = {}
    for key, info in sorted_people:
        s = info["staffing"]
        person_obj = info["person_obj"]
        person_field_map[key] = {
            "person_key":  key,
            "person_id":   s.person_id,
            "person_name": info["person_name"],
            "is_chief":    info["is_chief"],
            "grade":       (person_obj.grade if person_obj else None) or "",
            "position":    (person_obj.position if person_obj else None) or "",
            "my_field":    s.field or "",
            "my_sub_field":s.sub_field or "",
            "my_category": s.category or "",
        }

    # 각 인력의 충돌 수집 (정렬 순서 유지)
    result = []
    seen_order = list(person_field_map.keys())  # 이미 정렬된 순서

    for person_key in seen_order:
        pinfo = person_field_map[person_key]
        all_entries = person_phase_index.get(person_key, [])

        my_phases = [e for e in all_entries if e["project_id"] == target_project_id]
        other_phases = [e for e in all_entries if e["project_id"] != target_project_id]

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

        result.append({
            **pinfo,
            "total_overlap_days": total_days,
            "total_overlap_md":   total_md,
            "has_conflict":       len(conflicts) > 0,
            "conflicts":          conflicts,
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

    # 배정 인력 목록 (배치 순서 - staffing.id 기준)
    assigned_people = _get_target_staffing_people(
        project_id, staffings, phases, people_map
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
