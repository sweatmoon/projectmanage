import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.phases import PhasesService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/phases", tags=["phases"])


# ---------- Pydantic Schemas ----------
class PhasesData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    phase_name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    sort_order: int


class PhasesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    phase_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    sort_order: Optional[int] = None


class PhasesResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: int
    phase_name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    sort_order: int

    class Config:
        from_attributes = True


class PhasesListResponse(BaseModel):
    """List response schema"""
    items: List[PhasesResponse]
    total: int
    skip: int
    limit: int


class PhasesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[PhasesData]


class PhasesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: PhasesUpdateData


class PhasesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[PhasesBatchUpdateItem]


class PhasesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=PhasesListResponse)
async def query_phasess(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query phasess with filtering, sorting, and pagination"""
    logger.debug(f"Querying phasess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = PhasesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")
        
        result = await service.get_list(
            skip=skip, 
            limit=limit,
            query_dict=query_dict,
            sort=sort,
        )
        logger.debug(f"Found {result['total']} phasess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying phasess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=PhasesListResponse)
async def query_phasess_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query phasess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying phasess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = PhasesService(db)
    try:
        # Parse query JSON if provided
        query_dict = None
        if query:
            try:
                query_dict = json.loads(query)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid query JSON format")

        result = await service.get_list(
            skip=skip,
            limit=limit,
            query_dict=query_dict,
            sort=sort
        )
        logger.debug(f"Found {result['total']} phasess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying phasess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=PhasesResponse)
async def get_phases(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single phases by ID"""
    logger.debug(f"Fetching phases with id: {id}, fields={fields}")
    
    service = PhasesService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Phases with id {id} not found")
            raise HTTPException(status_code=404, detail="Phases not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching phases {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=PhasesResponse, status_code=201)
async def create_phases(
    data: PhasesData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new phases"""
    logger.debug(f"Creating new phases with data: {data}")
    
    service = PhasesService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create phases")
        
        logger.info(f"Phases created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating phases: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating phases: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[PhasesResponse], status_code=201)
async def create_phasess_batch(
    request: PhasesBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple phasess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} phasess")
    
    service = PhasesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} phasess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[PhasesResponse])
async def update_phasess_batch(
    request: PhasesBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple phasess in a single request"""
    logger.debug(f"Batch updating {len(request.items)} phasess")
    
    service = PhasesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} phasess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=PhasesResponse)
async def update_phases(
    id: int,
    data: PhasesUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing phases"""
    logger.debug(f"Updating phases {id} with data: {data}")

    service = PhasesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Phases with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Phases not found")
        
        logger.info(f"Phases {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating phases {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating phases {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_phasess_batch(
    request: PhasesBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple phasess by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} phasess")
    
    service = PhasesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} phasess successfully")
        return {"message": f"Successfully deleted {deleted_count} phasess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_phases(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single phases by ID"""
    logger.debug(f"Deleting phases with id: {id}")
    
    service = PhasesService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Phases with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Phases not found")
        
        logger.info(f"Phases {id} deleted successfully")
        return {"message": "Phases deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting phases {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")