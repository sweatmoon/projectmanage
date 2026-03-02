import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.staffing import Staffing

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class StaffingService:
    """Service layer for Staffing operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Staffing]:
        """Create a new staffing"""
        try:
            obj = Staffing(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created staffing with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating staffing: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Staffing]:
        """Get staffing by ID (excludes soft-deleted)"""
        try:
            query = select(Staffing).where(Staffing.id == obj_id, Staffing.deleted_at.is_(None))
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching staffing {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of staffings (excludes soft-deleted)"""
        try:
            query = select(Staffing).where(Staffing.deleted_at.is_(None))
            count_query = select(func.count(Staffing.id)).where(Staffing.deleted_at.is_(None))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Staffing, field):
                        query = query.where(getattr(Staffing, field) == value)
                        count_query = count_query.where(getattr(Staffing, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Staffing, field_name):
                        query = query.order_by(getattr(Staffing, field_name).desc())
                else:
                    if hasattr(Staffing, sort):
                        query = query.order_by(getattr(Staffing, sort))
            else:
                query = query.order_by(Staffing.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching staffing list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Staffing]:
        """Update staffing"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Staffing {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated staffing {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating staffing {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete staffing"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Staffing {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted staffing {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting staffing {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Staffing]:
        """Get staffing by any field"""
        try:
            if not hasattr(Staffing, field_name):
                raise ValueError(f"Field {field_name} does not exist on Staffing")
            result = await self.db.execute(
                select(Staffing).where(getattr(Staffing, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching staffing by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Staffing]:
        """Get list of staffings filtered by field"""
        try:
            if not hasattr(Staffing, field_name):
                raise ValueError(f"Field {field_name} does not exist on Staffing")
            result = await self.db.execute(
                select(Staffing)
                .where(getattr(Staffing, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Staffing.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching staffings by {field_name}: {str(e)}")
            raise