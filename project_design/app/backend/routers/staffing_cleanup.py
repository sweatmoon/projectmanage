"""
Staffing cleanup: Re-map external staffing to internal people by name matching,
and remove duplicate external entries.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.staffing import Staffing
from models.people import People
from models.calendar_entries import Calendar_entries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/staffing_cleanup", tags=["staffing_cleanup"])


class CleanupResponse(BaseModel):
    remapped_count: int
    duplicates_removed: int
    duplicates_calendar_removed: int
    message: str


class CleanupByProjectResponse(BaseModel):
    remapped_count: int
    duplicates_removed: int
    duplicates_calendar_removed: int
    message: str


@router.post("/remap_and_dedup/{project_id}", response_model=CleanupByProjectResponse)
async def remap_and_dedup_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    For a given project:
    1. Re-map staffing entries where person_name_text matches a person in the people table
       but person_id is null → set person_id to the matched person's id.
    2. Remove duplicate staffing entries (same phase_id + field + person_name_text),
       keeping only the first one (lowest id). Also remove their calendar entries.
    """
    try:
        # Step 1: Get all people for name matching
        people_result = await db.execute(select(People))
        all_people = people_result.scalars().all()
        people_by_name = {}
        for p in all_people:
            # Normalize: strip whitespace
            normalized = p.person_name.strip()
            people_by_name[normalized] = p

        # Step 2: Get all staffing for this project
        staffing_result = await db.execute(
            select(Staffing).where(Staffing.project_id == project_id).order_by(Staffing.id)
        )
        all_staffing = staffing_result.scalars().all()

        # Step 3: Re-map external → internal where name matches
        remapped_count = 0
        for s in all_staffing:
            if s.person_id is None and s.person_name_text:
                normalized_name = s.person_name_text.strip()
                matched_person = people_by_name.get(normalized_name)
                if matched_person:
                    s.person_id = matched_person.id
                    remapped_count += 1

        await db.flush()

        # Step 4: Remove duplicates (same phase_id + field + person_name_text)
        # Keep the one with the lowest id
        seen = {}  # key: (phase_id, field, person_name_text_normalized) -> first staffing id
        duplicates_to_remove = []

        for s in all_staffing:
            name_key = (s.person_name_text or '').strip()
            key = (s.phase_id, s.field, name_key)
            if key in seen:
                duplicates_to_remove.append(s.id)
            else:
                seen[key] = s.id

        # Remove calendar entries for duplicates first
        duplicates_calendar_removed = 0
        if duplicates_to_remove:
            # Count calendar entries to be removed
            cal_count_result = await db.execute(
                select(func.count(Calendar_entries.id)).where(
                    Calendar_entries.staffing_id.in_(duplicates_to_remove)
                )
            )
            duplicates_calendar_removed = cal_count_result.scalar() or 0

            # Delete calendar entries
            await db.execute(
                delete(Calendar_entries).where(
                    Calendar_entries.staffing_id.in_(duplicates_to_remove)
                )
            )

            # Delete duplicate staffing entries
            await db.execute(
                delete(Staffing).where(
                    Staffing.id.in_(duplicates_to_remove)
                )
            )

        await db.commit()

        return CleanupByProjectResponse(
            remapped_count=remapped_count,
            duplicates_removed=len(duplicates_to_remove),
            duplicates_calendar_removed=duplicates_calendar_removed,
            message=(
                f"정리 완료: {remapped_count}명 내부인력 재매핑, "
                f"{len(duplicates_to_remove)}개 중복 제거 "
                f"(일정 {duplicates_calendar_removed}건 삭제)"
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error cleaning up staffing: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")


@router.post("/remap_all", response_model=CleanupResponse)
async def remap_all_staffing(
    db: AsyncSession = Depends(get_db),
):
    """
    Global cleanup: Re-map all staffing entries where person_name_text matches
    a person in the people table but person_id is null.
    Also remove duplicates across all projects.
    """
    try:
        # Get all people
        people_result = await db.execute(select(People))
        all_people = people_result.scalars().all()
        people_by_name = {}
        for p in all_people:
            normalized = p.person_name.strip()
            people_by_name[normalized] = p

        # Get all staffing ordered by id
        staffing_result = await db.execute(
            select(Staffing).order_by(Staffing.id)
        )
        all_staffing = staffing_result.scalars().all()

        # Re-map
        remapped_count = 0
        for s in all_staffing:
            if s.person_id is None and s.person_name_text:
                normalized_name = s.person_name_text.strip()
                matched_person = people_by_name.get(normalized_name)
                if matched_person:
                    s.person_id = matched_person.id
                    remapped_count += 1

        await db.flush()

        # Remove duplicates per (project_id, phase_id, field, person_name_text)
        seen = {}
        duplicates_to_remove = []

        for s in all_staffing:
            name_key = (s.person_name_text or '').strip()
            key = (s.project_id, s.phase_id, s.field, name_key)
            if key in seen:
                duplicates_to_remove.append(s.id)
            else:
                seen[key] = s.id

        duplicates_calendar_removed = 0
        if duplicates_to_remove:
            cal_count_result = await db.execute(
                select(func.count(Calendar_entries.id)).where(
                    Calendar_entries.staffing_id.in_(duplicates_to_remove)
                )
            )
            duplicates_calendar_removed = cal_count_result.scalar() or 0

            await db.execute(
                delete(Calendar_entries).where(
                    Calendar_entries.staffing_id.in_(duplicates_to_remove)
                )
            )
            await db.execute(
                delete(Staffing).where(
                    Staffing.id.in_(duplicates_to_remove)
                )
            )

        await db.commit()

        return CleanupResponse(
            remapped_count=remapped_count,
            duplicates_removed=len(duplicates_to_remove),
            duplicates_calendar_removed=duplicates_calendar_removed,
            message=(
                f"전체 정리 완료: {remapped_count}명 내부인력 재매핑, "
                f"{len(duplicates_to_remove)}개 중복 제거 "
                f"(일정 {duplicates_calendar_removed}건 삭제)"
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in global cleanup: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Global cleanup failed: {str(e)}")