"""
Batch project operations for performance optimization.
Handles cascade deletion of projects with all related data.
"""
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.projects import Projects
from models.phases import Phases
from models.staffing import Staffing
from models.calendar_entries import Calendar_entries

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/projects", tags=["project_batch"])


class BatchDeleteRequest(BaseModel):
    project_ids: List[int]


class BatchDeleteResponse(BaseModel):
    deleted_projects: int
    deleted_phases: int
    deleted_staffing: int
    deleted_calendar_entries: int
    message: str


@router.post("/batch_delete", response_model=BatchDeleteResponse)
async def batch_delete_projects(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Batch delete projects and all related data (phases, staffing, calendar entries)
    in a single transaction for maximum performance.
    """
    if not request.project_ids:
        return BatchDeleteResponse(
            deleted_projects=0, deleted_phases=0,
            deleted_staffing=0, deleted_calendar_entries=0,
            message="삭제할 프로젝트가 없습니다."
        )

    try:
        # Step 1: Get all phase IDs for these projects
        phase_result = await db.execute(
            select(Phases.id).where(Phases.project_id.in_(request.project_ids))
        )
        phase_ids = [row[0] for row in phase_result.fetchall()]

        deleted_calendar = 0
        deleted_staffing_count = 0

        if phase_ids:
            # Step 2: Get all staffing IDs for these phases
            staffing_result = await db.execute(
                select(Staffing.id).where(Staffing.phase_id.in_(phase_ids))
            )
            staffing_ids = [row[0] for row in staffing_result.fetchall()]

            if staffing_ids:
                # Step 3: Delete all calendar entries for these staffing IDs
                cal_result = await db.execute(
                    delete(Calendar_entries).where(
                        Calendar_entries.staffing_id.in_(staffing_ids)
                    )
                )
                deleted_calendar = cal_result.rowcount or 0

                # Step 4: Delete all staffing records
                staff_result = await db.execute(
                    delete(Staffing).where(Staffing.phase_id.in_(phase_ids))
                )
                deleted_staffing_count = staff_result.rowcount or 0

            # Step 5: Delete all phases
            phase_del_result = await db.execute(
                delete(Phases).where(Phases.project_id.in_(request.project_ids))
            )
            deleted_phases_count = phase_del_result.rowcount or 0
        else:
            deleted_phases_count = 0

        # Step 6: Delete the projects themselves
        proj_result = await db.execute(
            delete(Projects).where(Projects.id.in_(request.project_ids))
        )
        deleted_projects_count = proj_result.rowcount or 0

        await db.commit()

        return BatchDeleteResponse(
            deleted_projects=deleted_projects_count,
            deleted_phases=deleted_phases_count,
            deleted_staffing=deleted_staffing_count,
            deleted_calendar_entries=deleted_calendar,
            message=(
                f"삭제 완료: 프로젝트 {deleted_projects_count}개, "
                f"단계 {deleted_phases_count}개, "
                f"투입인력 {deleted_staffing_count}개, "
                f"일정 {deleted_calendar}건"
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Batch delete error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"일괄 삭제 실패: {str(e)}")