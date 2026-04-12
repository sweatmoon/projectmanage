import logging
from typing import Dict, List, Optional
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from services.audit_service import write_audit_log, EventType, EntityType

from core.database import get_db
from models.projects import Projects
from models.phases import Phases
from models.staffing import Staffing
from models.people import People
from models.calendar_entries import Calendar_entries
from models.staffing_hat import StaffingHat
from models.staffing_change import StaffingChange
from utils.holidays import count_business_days, get_consecutive_business_days

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/project_import", tags=["project_import"])


class PhaseTextImportRequest(BaseModel):
    project_id: int
    text: str  # Multi-line text in the specified format
    section_map: Optional[Dict[str, str]] = None  # name → section label (e.g. '핵심기술')


class PhaseTextOverwriteRequest(BaseModel):
    project_id: int
    text: str  # Multi-line text - will replace ALL existing phases
    section_map: Optional[Dict[str, str]] = None  # name → section label


class PhaseTextImportResponse(BaseModel):
    phases_created: int
    staffing_created: int
    calendar_entries_created: int
    phases_deleted: int = 0
    staffing_deleted: int = 0
    calendar_entries_deleted: int = 0
    message: str


class ProjectExportResponse(BaseModel):
    text: str
    actual_text: str = ''   # 모자(대체인력) 반영된 실제 버전
    original_text: str = ''  # 공식 인력변경 전 초기 입력값 버전
    has_hat: bool = False    # 모자 데이터 존재 여부
    has_change: bool = False  # 공식 인력변경 이력 존재 여부
    project_name: str
    organization: str
    status: str
    section_map: Dict[str, str] = {}  # name → section/category


def get_first_n_business_days(start_date: date, end_date: date, n: int) -> List[date]:
    """Get first N business days (holidays excluded) from start_date within the range."""
    return get_consecutive_business_days(start_date, end_date, n)


# 단계감리팀으로 분류되는 field 패턴 (프론트 getTeamInfo 함수와 동일 기준)
_TEAM_FIELD_PATTERNS = [
    '사업관리',
    '응용시스템',
    '데이터베이스',
    '시스템구조',
    '시스템 구조',
]

def _classify_category_by_field(field: str) -> str:
    """section_map 없을 때 field명으로 단계감리팀/전문가팀 자동 분류.
    프론트엔드 getTeamInfo() 함수와 동일한 기준 적용.
    """
    for pattern in _TEAM_FIELD_PATTERNS:
        if pattern in field:
            return '단계감리팀'
    return '전문가팀'


async def _import_phases_logic(
    db: AsyncSession,
    project: Projects,
    text: str,
    next_sort_order: int,
    section_map: Optional[Dict[str, str]] = None,
) -> dict:
    """Shared logic for importing phases from text."""
    # Get existing people for name matching (strip whitespace for robust matching)
    people_stmt = select(People)
    people_result = await db.execute(people_stmt)
    all_people = people_result.scalars().all()
    people_by_name = {p.person_name.strip(): p for p in all_people}

    lines = text.strip().split('\n')
    phases_created = 0
    staffing_created = 0
    calendar_entries_created = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue

        parts = [p.strip() for p in line.split(',')]
        if len(parts) < 3:
            continue

        phase_name = parts[0].strip()
        start_date_str = parts[1].strip()
        end_date_str = parts[2].strip()

        # Parse dates (YYYYMMDD format)
        try:
            start_date = datetime.strptime(start_date_str, '%Y%m%d').date()
            end_date = datetime.strptime(end_date_str, '%Y%m%d').date()
        except ValueError:
            logger.warning(f"Invalid date format in line: {line}")
            continue

        # Calculate total business days in phase
        total_biz_days = count_business_days(start_date, end_date)

        # Create phase
        new_phase = Phases(
            project_id=project.id,
            phase_name=phase_name,
            start_date=start_date,
            end_date=end_date,
            sort_order=next_sort_order,
        )
        db.add(new_phase)
        await db.flush()
        await db.refresh(new_phase)
        phases_created += 1
        next_sort_order += 1

        # Parse staffing entries (parts[3:])
        for i in range(3, len(parts)):
            entry = parts[i].strip()
            if not entry:
                continue

            # Parse "인력명:분야[:MD]"
            entry_parts = entry.split(':')
            if len(entry_parts) < 2:
                continue

            person_name = entry_parts[0].strip()
            field_name = entry_parts[1].strip()

            # Check if MD is specified
            md_value = None
            if len(entry_parts) >= 3:
                try:
                    md_value = int(entry_parts[2].strip())
                except ValueError:
                    md_value = None

            # If MD not specified, use total business days
            if md_value is None:
                md_value = total_biz_days

            # Find person in people table (strip for robust matching)
            person = people_by_name.get(person_name.strip())
            person_id = person.id if person else None

            # Determine category from section_map (for proposal mode)
            # section_map 없으면 field명으로 자동 분류 (단계감리팀 / 전문가팀)
            if section_map and person_name in section_map:
                category_val = section_map[person_name]
            else:
                category_val = _classify_category_by_field(field_name)

            # Create staffing entry
            new_staffing = Staffing(
                project_id=project.id,
                phase_id=new_phase.id,
                category=category_val,
                field=field_name,
                sub_field=field_name,
                person_id=person_id,
                person_name_text=person_name,
                md=md_value,
            )
            db.add(new_staffing)
            await db.flush()
            await db.refresh(new_staffing)
            staffing_created += 1

            # Create default calendar entries (first N business days)
            default_days = get_first_n_business_days(start_date, end_date, md_value)
            status = 'P' if project.status == '제안' else 'A'

            for day in default_days:
                new_entry = Calendar_entries(
                    staffing_id=new_staffing.id,
                    entry_date=day,
                    status=status,
                )
                db.add(new_entry)
                calendar_entries_created += 1

    return {
        'phases_created': phases_created,
        'staffing_created': staffing_created,
        'calendar_entries_created': calendar_entries_created,
    }


@router.post("/import_phases", response_model=PhaseTextImportResponse)
async def import_phases_from_text(
    request: PhaseTextImportRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Import phases and staffing from text format (append to existing).

    Format per line:
    단계명, YYYYMMDD, YYYYMMDD, 인력1:분야[:MD], 인력2:분야[:MD], ...
    """
    try:
        # Verify project exists
        proj_stmt = select(Projects).where(Projects.id == request.project_id)
        proj_result = await db.execute(proj_stmt)
        project = proj_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get existing phases for sort_order
        existing_phases_stmt = select(Phases).where(
            Phases.project_id == request.project_id
        ).order_by(Phases.sort_order)
        existing_result = await db.execute(existing_phases_stmt)
        existing_phases = existing_result.scalars().all()
        next_sort_order = max((p.sort_order for p in existing_phases), default=0) + 1

        result = await _import_phases_logic(db, project, request.text, next_sort_order, section_map=request.section_map)
        await write_audit_log(
            db,
            event_type=EventType.BULK_IMPORT,
            entity_type=EntityType.PROJECT,
            entity_id=request.project_id,
            project_id=request.project_id,
            after_obj={
                "phases_created": result["phases_created"],
                "staffing_created": result["staffing_created"],
                "calendar_entries_created": result["calendar_entries_created"],
                "import_text_length": len(request.text),
            },
            request=http_request,
            description=f"TSV 일괄 가져오기: {result['phases_created']}개 단계, {result['staffing_created']}개 투입공수 생성",
        )
        await db.commit()

        return PhaseTextImportResponse(
            **result,
            message=f"성공: {result['phases_created']}개 단계, {result['staffing_created']}개 투입공수, {result['calendar_entries_created']}개 일정 생성됨",
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error importing phases: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")


@router.post("/overwrite_phases", response_model=PhaseTextImportResponse)
async def overwrite_phases_from_text(
    request: PhaseTextOverwriteRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Overwrite ALL phases and staffing from text format.
    Deletes all existing phases, staffing, and calendar entries for the project,
    then imports from text.

    Format per line:
    단계명, YYYYMMDD, YYYYMMDD, 인력1:분야[:MD], 인력2:분야[:MD], ...
    """
    try:
        # Verify project exists
        proj_stmt = select(Projects).where(Projects.id == request.project_id)
        proj_result = await db.execute(proj_stmt)
        project = proj_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get existing data counts for response
        existing_phases_stmt = select(Phases).where(Phases.project_id == request.project_id)
        existing_phases_result = await db.execute(existing_phases_stmt)
        existing_phases = existing_phases_result.scalars().all()
        phases_deleted = len(existing_phases)

        existing_staffing_stmt = select(Staffing).where(Staffing.project_id == request.project_id)
        existing_staffing_result = await db.execute(existing_staffing_stmt)
        existing_staffing = existing_staffing_result.scalars().all()
        staffing_deleted = len(existing_staffing)

        # Delete calendar entries for all staffing in this project
        staffing_ids = [s.id for s in existing_staffing]
        calendar_entries_deleted = 0
        if staffing_ids:
            cal_count_stmt = select(Calendar_entries).where(
                Calendar_entries.staffing_id.in_(staffing_ids)
            )
            cal_result = await db.execute(cal_count_stmt)
            calendar_entries_deleted = len(cal_result.scalars().all())

            # Delete calendar entries
            await db.execute(
                delete(Calendar_entries).where(
                    Calendar_entries.staffing_id.in_(staffing_ids)
                )
            )

        # Delete staffing
        await db.execute(
            delete(Staffing).where(Staffing.project_id == request.project_id)
        )

        # Delete phases
        await db.execute(
            delete(Phases).where(Phases.project_id == request.project_id)
        )

        await db.flush()

        # Import new data
        result = await _import_phases_logic(db, project, request.text, 1, section_map=request.section_map)

        # Post-import: re-map any staffing where person_name_text matches people table
        # This ensures robust matching even with slight whitespace differences
        remap_stmt = select(Staffing).where(
            and_(
                Staffing.project_id == request.project_id,
                Staffing.person_id.is_(None),
                Staffing.person_name_text.isnot(None),
            )
        )
        remap_result = await db.execute(remap_stmt)
        unmapped_staffing = remap_result.scalars().all()

        people_stmt2 = select(People)
        people_result2 = await db.execute(people_stmt2)
        all_people2 = people_result2.scalars().all()
        people_by_name2 = {p.person_name.strip(): p for p in all_people2}

        remapped = 0
        for s in unmapped_staffing:
            name = (s.person_name_text or '').strip()
            matched = people_by_name2.get(name)
            if matched:
                s.person_id = matched.id
                remapped += 1

        # Remove duplicates (same phase_id + field + person_name_text)
        all_new_staffing_stmt = select(Staffing).where(
            Staffing.project_id == request.project_id
        ).order_by(Staffing.id)
        all_new_result = await db.execute(all_new_staffing_stmt)
        all_new_staffing = all_new_result.scalars().all()

        seen_keys = {}
        dup_ids = []
        for s in all_new_staffing:
            key = (s.phase_id, s.field, (s.person_name_text or '').strip())
            if key in seen_keys:
                dup_ids.append(s.id)
            else:
                seen_keys[key] = s.id

        if dup_ids:
            await db.execute(
                delete(Calendar_entries).where(Calendar_entries.staffing_id.in_(dup_ids))
            )
            await db.execute(
                delete(Staffing).where(Staffing.id.in_(dup_ids))
            )

        await write_audit_log(
            db,
            event_type=EventType.BULK_OVERWRITE,
            entity_type=EntityType.PROJECT,
            entity_id=request.project_id,
            project_id=request.project_id,
            before_obj={
                "phases_deleted": phases_deleted,
                "staffing_deleted": staffing_deleted,
                "calendar_entries_deleted": calendar_entries_deleted,
            },
            after_obj={
                "phases_created": result["phases_created"],
                "staffing_created": result["staffing_created"],
                "calendar_entries_created": result["calendar_entries_created"],
                "import_text_length": len(request.text),
            },
            request=http_request,
            description=(
                f"TSV 덮어쓰기: 승인 {phases_deleted}개 단계 삭제 → {result['phases_created']}개 단계 생성, "
                f"{result['staffing_created']}개 투입공수 생성"
            ),
        )
        await db.commit()

        extra_msg = ""
        if remapped > 0:
            extra_msg += f" | {remapped}명 내부인력 재매핑"
        if dup_ids:
            extra_msg += f" | {len(dup_ids)}개 중복 제거"

        return PhaseTextImportResponse(
            **result,
            phases_deleted=phases_deleted,
            staffing_deleted=staffing_deleted,
            calendar_entries_deleted=calendar_entries_deleted,
            message=(
                f"기존 데이터 삭제: {phases_deleted}개 단계, {staffing_deleted}개 투입공수, {calendar_entries_deleted}개 일정 | "
                f"새로 생성: {result['phases_created']}개 단계, {result['staffing_created']}개 투입공수, {result['calendar_entries_created']}개 일정"
                + extra_msg
            ),
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error overwriting phases: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Overwrite failed: {str(e)}")


@router.get("/export/{project_id}", response_model=ProjectExportResponse)
async def export_project_to_text(
    project_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Export project phases and staffing to text format.

    Output format per line:
    단계명, YYYYMMDD, YYYYMMDD, 인력1:분야:MD, 인력2:분야:MD, ...
    """
    try:
        # Get project
        proj_stmt = select(Projects).where(Projects.id == project_id)
        proj_result = await db.execute(proj_stmt)
        project = proj_result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Get phases
        phases_stmt = select(Phases).where(
            Phases.project_id == project_id
        ).order_by(Phases.sort_order)
        phases_result = await db.execute(phases_stmt)
        phases = phases_result.scalars().all()

        # Get people for name lookup
        people_stmt = select(People)
        people_result = await db.execute(people_stmt)
        all_people = people_result.scalars().all()
        people_by_id = {p.id: p.person_name for p in all_people}

        # Get all staffing for this project (id 오름차순 = 입력 순서)
        staffing_stmt = select(Staffing).where(
            Staffing.project_id == project_id
        ).order_by(Staffing.id)
        staffing_result = await db.execute(staffing_stmt)
        all_staffing = staffing_result.scalars().all()

        # Group staffing by phase_id
        staffing_by_phase = {}
        for s in all_staffing:
            if s.phase_id not in staffing_by_phase:
                staffing_by_phase[s.phase_id] = []
            staffing_by_phase[s.phase_id].append(s)

        # Get actual calendar entry counts per staffing_id
        cal_stmt = select(Calendar_entries).where(
            Calendar_entries.staffing_id.in_([s.id for s in all_staffing])
        ) if all_staffing else None

        actual_counts = {}
        if cal_stmt is not None:
            cal_result = await db.execute(cal_stmt)
            all_cal_entries = cal_result.scalars().all()
            for entry in all_cal_entries:
                if entry.status:
                    actual_counts[entry.staffing_id] = actual_counts.get(entry.staffing_id, 0) + 1

        lines = []
        for phase in phases:
            start_str = phase.start_date.strftime('%Y%m%d') if phase.start_date else ''
            end_str = phase.end_date.strftime('%Y%m%d') if phase.end_date else ''

            # Calculate total business days for this phase
            total_biz_days = 0
            if phase.start_date and phase.end_date:
                total_biz_days = count_business_days(phase.start_date, phase.end_date)

            phase_staffing = staffing_by_phase.get(phase.id, [])
            person_entries = []
            for s in phase_staffing:
                person_name = s.person_name_text or ''
                if not person_name and s.person_id:
                    person_name = people_by_id.get(s.person_id, '')

                field_name = s.field or ''

                # Use actual calendar entry count if available, otherwise use MD from staffing
                actual_md = actual_counts.get(s.id, s.md or 0)

                # If MD equals total business days, omit the number (means full period)
                if actual_md == total_biz_days:
                    person_entries.append(f"{person_name}:{field_name}")
                else:
                    person_entries.append(f"{person_name}:{field_name}:{actual_md}")

            parts = [phase.phase_name, start_str, end_str] + person_entries
            lines.append(', '.join(parts))

        # Build section_map: person_name -> category (from first occurrence per person)
        section_map_out: Dict[str, str] = {}
        for s in all_staffing:
            person_name = s.person_name_text or ''
            if not person_name and s.person_id:
                person_name = people_by_id.get(s.person_id, '')
            if person_name and person_name not in section_map_out:
                section_map_out[person_name] = s.category or '단계감리팀'

        # ── 모자(hat) 데이터 조회 → 실제 버전 생성 ──────────────
        staffing_ids = [s.id for s in all_staffing]
        hat_by_staffing: Dict[int, str] = {}  # staffing_id → actual_person_name
        if staffing_ids:
            hat_stmt = select(StaffingHat).where(
                and_(
                    StaffingHat.staffing_id.in_(staffing_ids),
                    StaffingHat.deleted_at.is_(None),
                )
            )
            hat_result = await db.execute(hat_stmt)
            for hat in hat_result.scalars().all():
                hat_by_staffing[hat.staffing_id] = hat.actual_person_name

        has_hat = bool(hat_by_staffing)

        # ── 공식 인력변경 이력 조회 → 초기 입력값 버전 생성 ──────────────
        # staffing_id → 가장 오래된 original_person_name (= 최초 입력값)
        change_by_staffing: Dict[int, str] = {}
        if staffing_ids:
            change_stmt = select(StaffingChange).where(
                StaffingChange.staffing_id.in_(staffing_ids)
            ).order_by(StaffingChange.changed_at)
            change_result = await db.execute(change_stmt)
            for chg in change_result.scalars().all():
                # 가장 오래된 레코드의 original을 초기값으로 사용 (중복 시 먼저 온 것만 저장)
                if chg.staffing_id not in change_by_staffing:
                    change_by_staffing[chg.staffing_id] = chg.original_person_name

        has_change = bool(change_by_staffing)

        # 초기 입력값 버전 라인 생성 (공식변경 전 원래 인력)
        original_lines = []
        for phase in phases:
            start_str = phase.start_date.strftime('%Y%m%d') if phase.start_date else ''
            end_str = phase.end_date.strftime('%Y%m%d') if phase.end_date else ''
            total_biz_days = 0
            if phase.start_date and phase.end_date:
                total_biz_days = count_business_days(phase.start_date, phase.end_date)

            phase_staffing = staffing_by_phase.get(phase.id, [])
            person_entries = []
            for s in phase_staffing:
                # 공식변경 이력이 있으면 최초 original_person_name, 없으면 현재 이름
                person_name = change_by_staffing.get(s.id)
                if person_name is None:
                    person_name = s.person_name_text or ''
                    if not person_name and s.person_id:
                        person_name = people_by_id.get(s.person_id, '')
                field_name = s.field or ''
                actual_md = actual_counts.get(s.id, s.md or 0)
                if actual_md == total_biz_days:
                    person_entries.append(f"{person_name}:{field_name}")
                else:
                    person_entries.append(f"{person_name}:{field_name}:{actual_md}")

            parts = [phase.phase_name, start_str, end_str] + person_entries
            original_lines.append(', '.join(parts))

        # 실제 버전 라인 생성 (hat 적용)
        actual_lines = []
        for phase in phases:
            start_str = phase.start_date.strftime('%Y%m%d') if phase.start_date else ''
            end_str = phase.end_date.strftime('%Y%m%d') if phase.end_date else ''
            total_biz_days = 0
            if phase.start_date and phase.end_date:
                total_biz_days = count_business_days(phase.start_date, phase.end_date)

            phase_staffing = staffing_by_phase.get(phase.id, [])
            person_entries = []
            for s in phase_staffing:
                # 모자가 있으면 실제 투입자 이름으로 교체
                person_name = hat_by_staffing.get(s.id) or s.person_name_text or ''
                if not person_name and s.person_id:
                    person_name = people_by_id.get(s.person_id, '')
                field_name = s.field or ''
                actual_md = actual_counts.get(s.id, s.md or 0)
                if actual_md == total_biz_days:
                    person_entries.append(f"{person_name}:{field_name}")
                else:
                    person_entries.append(f"{person_name}:{field_name}:{actual_md}")

            parts = [phase.phase_name, start_str, end_str] + person_entries
            actual_lines.append(', '.join(parts))

        return ProjectExportResponse(
            text='\n'.join(lines),
            actual_text='\n'.join(actual_lines),
            original_text='\n'.join(original_lines),
            has_hat=has_hat,
            has_change=has_change,
            project_name=project.project_name,
            organization=project.organization or '',
            status=project.status or '',
            section_map=section_map_out,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting project: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")
