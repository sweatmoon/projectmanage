import json
import logging
from typing import List, Optional

from datetime import datetime, date

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from services.staffing import StaffingService

# Set up logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/entities/staffing", tags=["staffing"])


# ---------- Pydantic Schemas ----------
class StaffingData(BaseModel):
    """Entity data schema (for create/update)"""
    project_id: int
    phase_id: int
    category: str
    field: str
    sub_field: str
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None


class StaffingUpdateData(BaseModel):
    """Update entity data (partial updates allowed)"""
    project_id: Optional[int] = None
    phase_id: Optional[int] = None
    category: Optional[str] = None
    field: Optional[str] = None
    sub_field: Optional[str] = None
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None


class StaffingResponse(BaseModel):
    """Entity response schema"""
    id: int
    project_id: int
    phase_id: int
    category: str
    field: str
    sub_field: str
    person_id: Optional[int] = None
    person_name_text: Optional[str] = None
    md: Optional[int] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class StaffingListResponse(BaseModel):
    """List response schema"""
    items: List[StaffingResponse]
    total: int
    skip: int
    limit: int


class StaffingBatchCreateRequest(BaseModel):
    """Batch create request"""
    items: List[StaffingData]


class StaffingBatchUpdateItem(BaseModel):
    """Batch update item"""
    id: int
    updates: StaffingUpdateData


class StaffingBatchUpdateRequest(BaseModel):
    """Batch update request"""
    items: List[StaffingBatchUpdateItem]


class StaffingBatchDeleteRequest(BaseModel):
    """Batch delete request"""
    ids: List[int]


# ---------- Routes ----------
@router.get("", response_model=StaffingListResponse)
async def query_staffings(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Query staffings with filtering, sorting, and pagination"""
    logger.debug(f"Querying staffings: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")
    
    service = StaffingService(db)
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
        logger.debug(f"Found {result['total']} staffings")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying staffings: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/all", response_model=StaffingListResponse)
async def query_staffings_all(
    query: str = Query(None, description="Query conditions (JSON string)"),
    sort: str = Query(None, description="Sort field (prefix with '-' for descending)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(20, ge=1, le=2000, description="Max number of records to return"),
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    # Query staffings with filtering, sorting, and pagination without user limitation
    logger.debug(f"Querying staffings: query={query}, sort={sort}, skip={skip}, limit={limit}, fields={fields}")

    service = StaffingService(db)
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
        logger.debug(f"Found {result['total']} staffings")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error querying staffings: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/{id}", response_model=StaffingResponse)
async def get_staffing(
    id: int,
    fields: str = Query(None, description="Comma-separated list of fields to return"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single staffing by ID"""
    logger.debug(f"Fetching staffing with id: {id}, fields={fields}")
    
    service = StaffingService(db)
    try:
        result = await service.get_by_id(id)
        if not result:
            logger.warning(f"Staffing with id {id} not found")
            raise HTTPException(status_code=404, detail="Staffing not found")
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching staffing {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("", response_model=StaffingResponse, status_code=201)
async def create_staffing(
    data: StaffingData,
    db: AsyncSession = Depends(get_db),
):
    """Create a new staffing"""
    logger.debug(f"Creating new staffing with data: {data}")
    
    service = StaffingService(db)
    try:
        result = await service.create(data.model_dump())
        if not result:
            raise HTTPException(status_code=400, detail="Failed to create staffing")
        
        logger.info(f"Staffing created successfully with id: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"Validation error creating staffing: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating staffing: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/batch", response_model=List[StaffingResponse], status_code=201)
async def create_staffings_batch(
    request: StaffingBatchCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create multiple staffings in a single request"""
    logger.debug(f"Batch creating {len(request.items)} staffings")
    
    service = StaffingService(db)
    results = []
    
    try:
        for item_data in request.items:
            result = await service.create(item_data.model_dump())
            if result:
                results.append(result)
        
        logger.info(f"Batch created {len(results)} staffings successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch create: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch create failed: {str(e)}")


@router.put("/batch", response_model=List[StaffingResponse])
async def update_staffings_batch(
    request: StaffingBatchUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update multiple staffings in a single request"""
    logger.debug(f"Batch updating {len(request.items)} staffings")
    
    service = StaffingService(db)
    results = []
    
    try:
        for item in request.items:
            # Only include non-None values for partial updates
            update_dict = {k: v for k, v in item.updates.model_dump().items() if v is not None}
            result = await service.update(item.id, update_dict)
            if result:
                results.append(result)
        
        logger.info(f"Batch updated {len(results)} staffings successfully")
        return results
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch update: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch update failed: {str(e)}")


@router.put("/{id}", response_model=StaffingResponse)
async def update_staffing(
    id: int,
    data: StaffingUpdateData,
    db: AsyncSession = Depends(get_db),
):
    """Update an existing staffing"""
    logger.debug(f"Updating staffing {id} with data: {data}")

    service = StaffingService(db)
    try:
        # Only include non-None values for partial updates
        update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
        result = await service.update(id, update_dict)
        if not result:
            logger.warning(f"Staffing with id {id} not found for update")
            raise HTTPException(status_code=404, detail="Staffing not found")
        
        logger.info(f"Staffing {id} updated successfully")
        return result
    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error updating staffing {id}: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating staffing {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/batch")
async def delete_staffings_batch(
    request: StaffingBatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Delete multiple staffings by their IDs"""
    logger.debug(f"Batch deleting {len(request.ids)} staffings")
    
    service = StaffingService(db)
    deleted_count = 0
    
    try:
        for item_id in request.ids:
            success = await service.delete(item_id)
            if success:
                deleted_count += 1
        
        logger.info(f"Batch deleted {deleted_count} staffings successfully")
        return {"message": f"Successfully deleted {deleted_count} staffings", "deleted_count": deleted_count}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in batch delete: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Batch delete failed: {str(e)}")


@router.delete("/{id}")
async def delete_staffing(
    id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a single staffing by ID"""
    logger.debug(f"Deleting staffing with id: {id}")
    
    service = StaffingService(db)
    try:
        success = await service.delete(id)
        if not success:
            logger.warning(f"Staffing with id {id} not found for deletion")
            raise HTTPException(status_code=404, detail="Staffing not found")
        
        logger.info(f"Staffing {id} deleted successfully")
        return {"message": "Staffing deleted successfully", "id": id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting staffing {id}: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")