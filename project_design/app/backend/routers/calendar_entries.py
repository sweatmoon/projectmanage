import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.calendar_entries import Calendar_entriesService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/calendar_entries", tags=["calendar_entries"])


# ---------- Pydantic Schemas ----------
class Calendar_entriesData(BaseModel):
    """Entity data schema (for create/update)"""
    staffing_id: int
    entry_date: date
    status: str = None


class Calendar_entriesUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    staffing_id: Optional[int] = None
    entry_date: Optional[date] = None
    status: Optional[str] = None


class Calendar_entriesResponse(BaseModel):
    """Entity response schema"""
    id: int
    staffing_id: int
    entry_date: date
    status: Optional[str] = None

    class Config:
        from_attributes = True


class Calendar_entriesListResponse(BaseModel):
    """List response schema"""
    items: List[Calendar_entriesResponse]
    total: int
    skip: int
    limit: int


class Calendar_entriesBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[Calendar_entriesData]


class Calendar_entriesBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: Calendar_entriesUpdateData


class Calendar_entriesBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[Calendar_entriesBatchUpdateItem]


class Calendar_entriesBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=Calendar_entriesListResponse)
async def query_calendar_entriess(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query calendar_entriess with filtering, sorting, and pagination"""
    logger.debug(f"Querying calendar_entriess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = Calendar_entriesService(db)
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
        logger.debug(f"Found {result['total']} calendar_entriess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying calendar_entriess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=Calendar_entriesListResponse)
async def query_calendar_entriess_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query calendar_entriess with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying calendar_entriess: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = Calendar_entriesService(db)
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
        logger.debug(f"Found {result['total']} calendar_entriess")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying calendar_entriess: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=Calendar_entriesResponse)
async def get_calendar_entries(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single calendar_entries by ID"""
    logger.debug(f"Fetching calendar_entries with id: {id}, fields={fields}")
    
    service = Calendar_entriesService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Calendar_entries with id {id} not found")
            raise HTTPException(status_code=404, detail="Calendar_entries not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching calendar_entries {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=Calendar_entriesResponse, status_code=201)
async def create_calendar_entries(
    data: Calendar_entriesData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new calendar_entries"""
    logger.debug(f"Creating new calendar_entries with data: {data}")
    
    service = Calendar_entriesService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create calendar_entries")
        
        logger.info(f"Calendar_entries created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating calendar_entries: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating calendar_entries: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[Calendar_entriesResponse], status_code=201)
async def create_calendar_entriess_batch(
    request: Calendar_entriesBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple calendar_entriess in a single request"""
    logger.debug(f"Batch creating {len(request.items)} calendar_entriess")
    
    service = Calendar_entriesService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} calendar_entriess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[Calendar_entriesResponse])
async def update_calendar_entriess_batch(
    request: Calendar_entriesBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple calendar_entriess in a single request"""
    logger.debug(f"Batch updating {len(request.items)} calendar_entriess")
    
    service = Calendar_entriesService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} calendar_entriess successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=Calendar_entriesResponse)
async def update_calendar_entries(
    id: int,
    data: Calendar_entriesUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing calendar_entries"""
    logger.debug(f"Updating calendar_entries {id} with data: {data}")

    service = Calendar_entriesService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Calendar_entries with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Calendar_entries not found")
        
        logger.info(f"Calendar_entries {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating calendar_entries {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating calendar_entries {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_calendar_entriess_batch(
    request: Calendar_entriesBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple calendar_entriess by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} calendar_entriess")
    
    service = Calendar_entriesService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} calendar_entriess successfully")
        return {"message": f"Successfully deleted {deleted_count} calendar_entriess", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_calendar_entries(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single calendar_entries by ID"""
    logger.debug(f"Deleting calendar_entries with id: {id}")
    
    service = Calendar_entriesService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Calendar_entries with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Calendar_entries not found")
        
        logger.info(f"Calendar_entries {id} deleted successfully")
        return {"message": "Calendar_entries deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting calendar_entries {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")