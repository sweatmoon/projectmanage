"""
홈 화면 통계 API
- 진행중인 사업 (감리 구분, 2026년 하루라도 일정 포함)
- 제안중인 사업 (제안 구분 전체)
- 등록 인력 수
- 가동률 (2026.01.01 ~ 오늘, 감리원+수석감리원 기준)
"""
import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, and_, or_, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.projects import Projects
from models.phases import Phases
from models.people import People
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries
from utils.holidays import is_business_day

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/home", tags=["home"])

GRADE_AUDITORS = ("수석감리원", "감리원")


class HomeStatsResponse(BaseModel):
    active_project_count: int    # 진행중인 사업 (감리, 2026년 일정 포함)
    proposal_count: int          # 제안중인 사업
    people_count: int            # 등록 인력 수
    utilization_rate: float      # 가동률 (0.0 ~ 1.0)
    utilization_numerator: int   # 가동률 분자 (실제 투입 일수)
    utilization_denominator: int # 가동률 분모 (영업일 × 감리원수)
    auditor_count: int           # 감리원 수 (수석감리원+감리원)
    biz_days_ytd: int            # 올해 1/1~오늘 영업일 수


def count_biz_days(start: date, end: date) -> int:
    """start ~ end(포함) 사이 영업일 수 계산"""
    count = 0
    cur = start
    while cur <= end:
        if is_business_day(cur):
            count += 1
        cur += timedelta(days=1)
    return count


@router.get("/stats", response_model=HomeStatsResponse)
async def get_home_stats(db: AsyncSession = Depends(get_db)):
    today = date.today()
    year = today.year  # 현재 연도 기준 (2026)
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    # ── 1. 진행중인 사업: status='감리', 해당 연도에 하루라도 phase 일정 포함 ──
    # phases 중 start_date <= year_end AND end_date >= year_start 인 것과 join
    active_proj_q = (
        select(distinct(Projects.id))
        .join(Phases, and_(
            Phases.project_id == Projects.id,
            Phases.deleted_at.is_(None),
        ))
        .where(
            Projects.deleted_at.is_(None),
            Projects.status == "감리",
            Phases.start_date.isnot(None),
            Phases.end_date.isnot(None),
            Phases.start_date <= year_end,
            Phases.end_date >= year_start,
        )
    )
    active_result = await db.execute(active_proj_q)
    active_project_count = len(active_result.fetchall())

    # ── 2. 제안중인 사업: status='제안' 전체 ──
    proposal_q = select(func.count()).select_from(Projects).where(
        Projects.deleted_at.is_(None),
        Projects.status == "제안",
    )
    proposal_count = (await db.execute(proposal_q)).scalar() or 0

    # ── 3. 등록 인력 수 ──
    people_q = select(func.count()).select_from(People).where(
        People.deleted_at.is_(None)
    )
    people_count = (await db.execute(people_q)).scalar() or 0

    # ── 4. 가동률 계산 ──
    # 감리원 (grade IN ('수석감리원', '감리원')) 목록
    auditor_q = select(People.id).where(
        People.deleted_at.is_(None),
        People.grade.in_(GRADE_AUDITORS),
    )
    auditor_ids = [row[0] for row in (await db.execute(auditor_q)).fetchall()]
    auditor_count = len(auditor_ids)

    # 올해 1/1 ~ 오늘 영업일 수
    biz_days_ytd = count_biz_days(year_start, today)

    utilization_numerator = 0
    utilization_denominator = biz_days_ytd * auditor_count

    if auditor_count > 0 and biz_days_ytd > 0:
        # 감리원이 배정된 staffing ids 조회
        staffing_q = select(Staffing.id).where(
            Staffing.deleted_at.is_(None),
            Staffing.person_id.in_(auditor_ids),
        )
        staffing_ids = [r[0] for r in (await db.execute(staffing_q)).fetchall()]

        if staffing_ids:
            # year_start ~ today 사이의 실제 투입 일정(status 있는 것) 수 집계
            entries_q = (
                select(func.count())
                .select_from(Calendar_entries)
                .where(
                    Calendar_entries.staffing_id.in_(staffing_ids),
                    Calendar_entries.status.isnot(None),
                    Calendar_entries.status != "",
                    Calendar_entries.entry_date >= year_start,
                    Calendar_entries.entry_date <= today,
                )
            )
            utilization_numerator = (await db.execute(entries_q)).scalar() or 0

    utilization_rate = (
        utilization_numerator / utilization_denominator
        if utilization_denominator > 0 else 0.0
    )

    return HomeStatsResponse(
        active_project_count=active_project_count,
        proposal_count=proposal_count,
        people_count=people_count,
        utilization_rate=round(utilization_rate, 4),
        utilization_numerator=utilization_numerator,
        utilization_denominator=utilization_denominator,
        auditor_count=auditor_count,
        biz_days_ytd=biz_days_ytd,
    )
