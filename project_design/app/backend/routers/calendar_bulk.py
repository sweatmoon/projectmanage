import logging
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.calendar_entries import Calendar_entries
from models.staffing import Staffing
from models.phases import Phases
from models.projects import Projects
from utils.holidays import is_business_day, get_consecutive_business_days
from services.audit_service import write_audit_log, EventType, EntityType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar_bulk"])


class CellToggleRequest(BaseModel):
    staffing_id: int
    entry_date: date
    status: Optional[str] = None  # None means delete/clear


class BulkCellToggleRequest(BaseModel):
    cells: List[CellToggleRequest]


class CellResponse(BaseModel):
    id: Optional[int] = None
    staffing_id: int
    entry_date: date
    status: Optional[str] = None

    class Config:
        from_attributes = True


@router.post("/toggle", response_model=List[CellResponse])
async def bulk_toggle_cells(
    request: BulkCellToggleRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Bulk upsert/delete calendar entries. If status is None or empty, delete the entry."""
    results = []
    try:
        for cell in request.cells:
            # Skip inserting entries on holidays/weekends (allow delete even on holidays)
            if cell.status and not is_business_day(cell.entry_date):
                results.append(CellResponse(
                    id=None,
                    staffing_id=cell.staffing_id,
                    entry_date=cell.entry_date,
                    status=None,
                ))
                continue

            # Find existing entries (may have duplicates)
            stmt = select(Calendar_entries).where(
                and_(
                    Calendar_entries.staffing_id == cell.staffing_id,
                    Calendar_entries.entry_date == cell.entry_date,
                )
            )
            result = await db.execute(stmt)
            existing_list = result.scalars().all()

            if not cell.status:
                # Delete all matching entries
                for entry in existing_list:
                    await db.delete(entry)
                await db.flush()
                results.append(CellResponse(
                    id=None,
                    staffing_id=cell.staffing_id,
                    entry_date=cell.entry_date,
                    status=None,
                ))
            else:
                if existing_list:
                    # Keep only the first entry, delete duplicates
                    keep = existing_list[0]
                    for dup in existing_list[1:]:
                        await db.delete(dup)
                    keep.status = cell.status
                    await db.flush()
                    await db.refresh(keep)
                    results.append(CellResponse(
                        id=keep.id,
                        staffing_id=keep.staffing_id,
                        entry_date=keep.entry_date,
                        status=keep.status,
                    ))
                else:
                    new_entry = Calendar_entries(
                        staffing_id=cell.staffing_id,
                        entry_date=cell.entry_date,
                        status=cell.status,
                    )
                    db.add(new_entry)
                    await db.flush()
                    await db.refresh(new_entry)
                    results.append(CellResponse(
                        id=new_entry.id,
                        staffing_id=new_entry.staffing_id,
                        entry_date=new_entry.entry_date,
                        status=new_entry.status,
                    ))

        # ── 감사 로그: 변경된 셀 상세 정보 수집 ──────────────────
        staffing_ids_affected = list({c.staffing_id for c in request.cells})

        # 첫 번째 staffing에서 project_id, person_name, project_name 조회
        project_id_for_log = None
        person_name_for_log = None
        project_name_for_log = None
        phase_name_for_log = None

        if staffing_ids_affected:
            s_res = await db.execute(
                select(Staffing).where(Staffing.id == staffing_ids_affected[0])
            )
            s_obj = s_res.scalar_one_or_none()
            if s_obj:
                project_id_for_log = s_obj.project_id
                person_name_for_log = s_obj.person_name_text

                # person_name_text 없으면 People 테이블 조회
                if not person_name_for_log and s_obj.person_id:
                    from models.people import People
                    p_res = await db.execute(
                        select(People.person_name).where(People.id == s_obj.person_id)
                    )
                    person_name_for_log = p_res.scalar_one_or_none()

                # project_name 조회
                if s_obj.project_id:
                    proj_res = await db.execute(
                        select(Projects.project_name).where(Projects.id == s_obj.project_id)
                    )
                    project_name_for_log = proj_res.scalar_one_or_none()

                # phase_name 조회
                if s_obj.phase_id:
                    phase_res = await db.execute(
                        select(Phases.phase_name).where(Phases.id == s_obj.phase_id)
                    )
                    phase_name_for_log = phase_res.scalar_one_or_none()

        # 변경 전/후 셀 상태를 before_data에 기록 (롤백 참고용)
        before_cells = [
            {"staffing_id": c.staffing_id, "entry_date": str(c.entry_date)}
            for c in request.cells
        ]
        after_cells = [
            {"staffing_id": r.staffing_id, "entry_date": str(r.entry_date), "status": r.status}
            for r in results
        ]

        # description: 누가 어느 사업의 일정을 몇 개 변경했는지
        desc_parts = []
        if project_name_for_log:
            desc_parts.append(f"[{project_name_for_log}]")
        if phase_name_for_log:
            desc_parts.append(phase_name_for_log)
        if person_name_for_log:
            desc_parts.append(person_name_for_log)
        context = " > ".join(desc_parts) if desc_parts else None

        description = (
            f"{context} — " if context else ""
        ) + f"일정 셀 {len(request.cells)}개 변경"

        # entity_id: 단일 staffing이면 staffing_id, 복수면 None
        log_entity_id = staffing_ids_affected[0] if len(staffing_ids_affected) == 1 else None

        await write_audit_log(
            db,
            event_type=EventType.UPDATE,
            entity_type=EntityType.CALENDAR_ENTRY,
            entity_id=log_entity_id,
            project_id=project_id_for_log,
            before_obj={"cells": before_cells},
            after_obj={"cells": after_cells, "cells_count": len(request.cells)},
            request=http_request,
            project_name=project_name_for_log,
            phase_name=phase_name_for_log,
            person_name=person_name_for_log,
            description=description,
        )
        await db.commit()
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in bulk toggle: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Bulk toggle failed: {str(e)}")


@router.post("/cleanup_duplicates")
async def cleanup_duplicates(
    db: AsyncSession = Depends(get_db),
):
    """Remove duplicate calendar entries, keeping only the first one per staffing_id+entry_date."""
    try:
        stmt = select(Calendar_entries).order_by(
            Calendar_entries.staffing_id,
            Calendar_entries.entry_date,
            Calendar_entries.id,
        )
        result = await db.execute(stmt)
        all_entries = result.scalars().all()

        seen = set()
        deleted_count = 0
        for entry in all_entries:
            key = (entry.staffing_id, str(entry.entry_date))
            if key in seen:
                await db.delete(entry)
                deleted_count += 1
            else:
                seen.add(key)

        await db.commit()
        return {"deleted_duplicates": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error cleaning duplicates: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")


@router.post("/cleanup_holidays")
async def cleanup_holiday_entries(
    db: AsyncSession = Depends(get_db),
):
    """
    DB에 잘못 저장된 공휴일/주말 캘린더 엔트리를 삭제하고,
    각 staffing의 캘린더를 MD에 맞게 영업일로 재생성합니다.
    """
    try:
        # 1단계: 공휴일/주말에 있는 모든 엔트리 삭제
        stmt = select(Calendar_entries).order_by(Calendar_entries.staffing_id, Calendar_entries.entry_date)
        result = await db.execute(stmt)
        all_entries = result.scalars().all()

        deleted_holiday = 0
        for entry in all_entries:
            if not is_business_day(entry.entry_date):
                await db.delete(entry)
                deleted_holiday += 1

        await db.flush()

        # 2단계: 각 staffing별로 현재 엔트리 수와 MD를 비교하여 부족한 날짜 채우기
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.deleted_at.is_(None))
        )
        all_staffings = staffing_result.scalars().all()

        regenerated_count = 0
        for staffing in all_staffings:
            if not staffing.md or staffing.md <= 0:
                continue

            # 해당 staffing의 현재 엔트리 수 확인
            cur_entries_result = await db.execute(
                select(Calendar_entries).where(Calendar_entries.staffing_id == staffing.id)
                .order_by(Calendar_entries.entry_date)
            )
            cur_entries = cur_entries_result.scalars().all()
            cur_count = len(cur_entries)

            if cur_count >= staffing.md:
                continue  # 이미 충분한 엔트리가 있음

            # Phase 날짜 범위 확인
            phase_result = await db.execute(select(Phases).where(Phases.id == staffing.phase_id))
            phase = phase_result.scalar_one_or_none()
            if not phase or not phase.start_date or not phase.end_date:
                continue

            # 프로젝트 상태 확인
            proj_result = await db.execute(select(Projects).where(Projects.id == phase.project_id))
            proj = proj_result.scalar_one_or_none()
            calendar_status = "P" if (proj and proj.status == "제안") else "A"

            # 현재 이미 있는 날짜 수집
            existing_dates = {e.entry_date for e in cur_entries}

            # MD 만큼의 연속 영업일 목록 생성
            needed = staffing.md
            all_biz_days = get_consecutive_business_days(phase.start_date, phase.end_date, needed)

            # 없는 날짜만 추가
            added = 0
            for bd in all_biz_days:
                if bd not in existing_dates:
                    new_entry = Calendar_entries(
                        staffing_id=staffing.id,
                        entry_date=bd,
                        status=calendar_status,
                    )
                    db.add(new_entry)
                    added += 1

            if added > 0:
                regenerated_count += staffing.id

        await db.commit()
        return {
            "deleted_holiday_entries": deleted_holiday,
            "staffings_regenerated": regenerated_count,
            "message": f"공휴일/주말 엔트리 {deleted_holiday}개 삭제, 재생성 완료"
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error cleaning holiday entries: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Holiday cleanup failed: {str(e)}")


@router.post("/rebuild_all_calendars")
async def rebuild_all_calendars(
    db: AsyncSession = Depends(get_db),
):
    """
    모든 staffing의 캘린더를 공휴일/주말을 제외한 영업일로 완전히 재생성합니다.
    기존 엔트리를 모두 삭제하고 MD 기준으로 다시 만듭니다.
    """
    try:
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.deleted_at.is_(None))
        )
        all_staffings = staffing_result.scalars().all()

        total_deleted = 0
        total_created = 0
        skipped = 0

        for staffing in all_staffings:
            # 기존 엔트리 삭제
            existing_result = await db.execute(
                select(Calendar_entries).where(Calendar_entries.staffing_id == staffing.id)
            )
            existing = existing_result.scalars().all()
            for e in existing:
                await db.delete(e)
            total_deleted += len(existing)

            if not staffing.md or staffing.md <= 0:
                skipped += 1
                continue

            # Phase 날짜 범위 확인
            phase_result = await db.execute(select(Phases).where(Phases.id == staffing.phase_id))
            phase = phase_result.scalar_one_or_none()
            if not phase or not phase.start_date or not phase.end_date:
                skipped += 1
                continue

            # 프로젝트 상태 확인
            proj_result = await db.execute(select(Projects).where(Projects.id == phase.project_id))
            proj = proj_result.scalar_one_or_none()
            calendar_status = "P" if (proj and proj.status == "제안") else "A"

            # MD 만큼의 연속 영업일 목록 생성 (공휴일/주말 제외)
            biz_days = get_consecutive_business_days(phase.start_date, phase.end_date, staffing.md)
            for bd in biz_days:
                new_entry = Calendar_entries(
                    staffing_id=staffing.id,
                    entry_date=bd,
                    status=calendar_status,
                )
                db.add(new_entry)
            total_created += len(biz_days)

        await db.flush()
        await db.commit()

        return {
            "total_deleted": total_deleted,
            "total_created": total_created,
            "skipped_staffings": skipped,
            "message": f"전체 캘린더 재생성 완료: {total_deleted}개 삭제 → {total_created}개 생성 (공휴일/주말 제외)"
        }
    except Exception as e:
        await db.rollback()
        logger.error(f"Error rebuilding calendars: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {str(e)}")


class MonthQueryRequest(BaseModel):
    year: int
    month: int
    staffing_ids: Optional[List[int]] = None


class MonthEntriesResponse(BaseModel):
    entries: List[CellResponse]


@router.post("/month", response_model=MonthEntriesResponse)
async def get_month_entries(
    request: MonthQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Get all calendar entries for a specific month, optionally filtered by staffing_ids.
    Deduplicates results by staffing_id+entry_date."""
    try:
        import calendar
        _, last_day = calendar.monthrange(request.year, request.month)
        start = date(request.year, request.month, 1)
        end = date(request.year, request.month, last_day)

        stmt = (
            select(Calendar_entries)
            .join(Staffing, Calendar_entries.staffing_id == Staffing.id)
            .where(
                and_(
                    Calendar_entries.entry_date >= start,
                    Calendar_entries.entry_date <= end,
                    Staffing.deleted_at.is_(None),
                )
            )
        )
        if request.staffing_ids:
            stmt = stmt.where(Calendar_entries.staffing_id.in_(request.staffing_ids))

        result = await db.execute(stmt)
        entries = result.scalars().all()

        # Deduplicate in response
        seen = set()
        unique_entries = []
        for e in entries:
            key = (e.staffing_id, str(e.entry_date))
            if key not in seen:
                seen.add(key)
                unique_entries.append(e)

        return MonthEntriesResponse(
            entries=[
                CellResponse(
                    id=e.id,
                    staffing_id=e.staffing_id,
                    entry_date=e.entry_date,
                    status=e.status,
                )
                for e in unique_entries
            ]
        )
    except Exception as e:
        logger.error(f"Error querying month entries: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


class DateRangeQueryRequest(BaseModel):
    start_date: str   # YYYY-MM-DD
    end_date: str     # YYYY-MM-DD
    staffing_ids: Optional[List[int]] = None


@router.post("/range", response_model=MonthEntriesResponse)
async def get_range_entries(
    request: DateRangeQueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Get all calendar entries for a date range (used for quarterly/semi-annual/yearly views)."""
    try:
        start = date.fromisoformat(request.start_date)
        end = date.fromisoformat(request.end_date)

        stmt = (
            select(Calendar_entries)
            .join(Staffing, Calendar_entries.staffing_id == Staffing.id)
            .where(
                and_(
                    Calendar_entries.entry_date >= start,
                    Calendar_entries.entry_date <= end,
                    Staffing.deleted_at.is_(None),
                )
            )
        )
        if request.staffing_ids:
            stmt = stmt.where(Calendar_entries.staffing_id.in_(request.staffing_ids))

        result = await db.execute(stmt)
        entries = result.scalars().all()

        seen = set()
        unique_entries = []
        for e in entries:
            key = (e.staffing_id, str(e.entry_date))
            if key not in seen:
                seen.add(key)
                unique_entries.append(e)

        return MonthEntriesResponse(
            entries=[
                CellResponse(
                    id=e.id,
                    staffing_id=e.staffing_id,
                    entry_date=e.entry_date,
                    status=e.status,
                )
                for e in unique_entries
            ]
        )
    except Exception as e:
        logger.error(f"Error querying range entries: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


class StaffingIdsRequest(BaseModel):
    staffing_ids: List[int]


class AllEntriesResponse(BaseModel):
    entries: List[CellResponse]


@router.post("/by_staffing_ids", response_model=AllEntriesResponse)
async def get_entries_by_staffing_ids(
    request: StaffingIdsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Get all calendar entries for given staffing_ids (across all dates).
    Used by ProjectDetail to show which dates are selected per staffing."""
    try:
        if not request.staffing_ids:
            return AllEntriesResponse(entries=[])

        stmt = select(Calendar_entries).where(
            Calendar_entries.staffing_id.in_(request.staffing_ids)
        ).order_by(Calendar_entries.staffing_id, Calendar_entries.entry_date)

        result = await db.execute(stmt)
        entries = result.scalars().all()

        # Deduplicate
        seen = set()
        unique_entries = []
        for e in entries:
            key = (e.staffing_id, str(e.entry_date))
            if key not in seen:
                seen.add(key)
                unique_entries.append(e)

        return AllEntriesResponse(
            entries=[
                CellResponse(
                    id=e.id,
                    staffing_id=e.staffing_id,
                    entry_date=e.entry_date,
                    status=e.status,
                )
                for e in unique_entries
            ]
        )
    except Exception as e:
        logger.error(f"Error querying entries by staffing_ids: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


class PersonIdsRequest(BaseModel):
    person_ids: List[int]
    exclude_project_id: Optional[int] = None  # 이 프로젝트 소속 일정은 제외


class PersonEntriesResponse(BaseModel):
    # { person_id: ["2026-02-09", ...] }
    person_dates: dict  # person_id(str) → list of date strings


@router.post("/entries_by_person_ids", response_model=PersonEntriesResponse)
async def get_entries_by_person_ids(
    request: PersonIdsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    주어진 person_id 목록에 대해 각 인력이 투입된 날짜 목록을 반환합니다.
    exclude_project_id가 지정되면 해당 프로젝트의 staffing 일정은 제외합니다.
    (같은 프로젝트 내 중복은 허용하므로)
    """
    try:
        if not request.person_ids:
            return PersonEntriesResponse(person_dates={})

        # 1. person_id → staffing_ids 매핑 구축 (exclude_project_id 소속 제외)
        staffing_stmt = select(Staffing).where(
            Staffing.person_id.in_(request.person_ids),
            Staffing.deleted_at.is_(None),
        )
        staffing_result = await db.execute(staffing_stmt)
        all_staffings = staffing_result.scalars().all()

        # staffing → phase → project_id 확인을 위해 phase 로드
        phase_ids = list({s.phase_id for s in all_staffings})
        if phase_ids:
            phase_stmt = select(Phases).where(Phases.id.in_(phase_ids))
            phase_result = await db.execute(phase_stmt)
            phase_map = {ph.id: ph for ph in phase_result.scalars().all()}
        else:
            phase_map = {}

        # person_id별 staffing_ids (exclude_project 제외)
        person_staffing_ids: dict = {}  # person_id → [staffing_id, ...]
        for s in all_staffings:
            if not s.person_id:
                continue
            ph = phase_map.get(s.phase_id)
            if ph and request.exclude_project_id and ph.project_id == request.exclude_project_id:
                continue  # 현재 프로젝트 제외
            pid = s.person_id
            if pid not in person_staffing_ids:
                person_staffing_ids[pid] = []
            person_staffing_ids[pid].append(s.id)

        if not person_staffing_ids:
            return PersonEntriesResponse(person_dates={})

        # 2. staffing_ids → calendar_entries 조회
        all_staffing_ids = [sid for ids in person_staffing_ids.values() for sid in ids]
        entries_stmt = select(Calendar_entries).where(
            Calendar_entries.staffing_id.in_(all_staffing_ids)
        )
        entries_result = await db.execute(entries_stmt)
        all_entries = entries_result.scalars().all()

        # staffing_id → person_id 역매핑
        staffing_to_person = {}
        for s in all_staffings:
            if s.person_id and s.id in all_staffing_ids:
                staffing_to_person[s.id] = s.person_id

        # person_id별 날짜 집합 (중복 제거)
        person_dates: dict = {}
        for entry in all_entries:
            if not entry.status:
                continue
            pid = staffing_to_person.get(entry.staffing_id)
            if pid is None:
                continue
            key = str(pid)
            if key not in person_dates:
                person_dates[key] = set()
            person_dates[key].add(str(entry.entry_date))

        # set → sorted list
        return PersonEntriesResponse(
            person_dates={k: sorted(v) for k, v in person_dates.items()}
        )

    except Exception as e:
        logger.error(f"Error querying entries by person_ids: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


# ── 전체 기간 staffing별 투입 MD 카운트 ──────────────────────────
class StaffingTotalCountRequest(BaseModel):
    staffing_ids: List[int]

class StaffingTotalCountResponse(BaseModel):
    counts: dict  # staffing_id(str) → 투입 MD 수


@router.post("/staffing-total-count", response_model=StaffingTotalCountResponse)
async def get_staffing_total_count(
    request: StaffingTotalCountRequest,
    db: AsyncSession = Depends(get_db),
):
    """staffing_ids별 전체 기간(월 무관) 투입 MD 카운트 반환"""
    try:
        if not request.staffing_ids:
            return StaffingTotalCountResponse(counts={})

        stmt = select(
            Calendar_entries.staffing_id,
            Calendar_entries.entry_date,
        ).where(
            Calendar_entries.staffing_id.in_(request.staffing_ids),
            Calendar_entries.status.isnot(None),
            Calendar_entries.status != '',
        )
        result = await db.execute(stmt)
        rows = result.fetchall()

        # staffing_id별 날짜 중복 제거 후 카운트
        from collections import defaultdict
        date_sets: dict = defaultdict(set)
        for staffing_id, entry_date in rows:
            date_sets[staffing_id].add(str(entry_date))

        counts = {str(sid): len(dates) for sid, dates in date_sets.items()}
        return StaffingTotalCountResponse(counts=counts)

    except Exception as e:
        logger.error(f"Error getting staffing total count: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")
