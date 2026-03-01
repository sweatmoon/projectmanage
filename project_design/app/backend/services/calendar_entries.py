import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.calendar_entries import Calendar_entries

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class Calendar_entriesService:
    """Service layer for Calendar_entries operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Calendar_entries]:
        """Create a new calendar_entries"""
        try:
            obj = Calendar_entries(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created calendar_entries with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating calendar_entries: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Calendar_entries]:
        """Get calendar_entries by ID"""
        try:
            query = select(Calendar_entries).where(Calendar_entries.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching calendar_entries {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of calendar_entriess"""
        try:
            query = select(Calendar_entries)
            count_query = select(func.count(Calendar_entries.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Calendar_entries, field):
                        query = query.where(getattr(Calendar_entries, field) == value)
                        count_query = count_query.where(getattr(Calendar_entries, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Calendar_entries, field_name):
                        query = query.order_by(getattr(Calendar_entries, field_name).desc())
                else:
                    if hasattr(Calendar_entries, sort):
                        query = query.order_by(getattr(Calendar_entries, sort))
            else:
                query = query.order_by(Calendar_entries.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching calendar_entries list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Calendar_entries]:
        """Update calendar_entries"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Calendar_entries {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated calendar_entries {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating calendar_entries {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete calendar_entries"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Calendar_entries {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted calendar_entries {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting calendar_entries {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Calendar_entries]:
        """Get calendar_entries by any field"""
        try:
            if not hasattr(Calendar_entries, field_name):
                raise ValueError(f"Field {field_name} does not exist on Calendar_entries")
            result = await self.db.execute(
                select(Calendar_entries).where(getattr(Calendar_entries, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching calendar_entries by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Calendar_entries]:
        """Get list of calendar_entriess filtered by field"""
        try:
            if not hasattr(Calendar_entries, field_name):
                raise ValueError(f"Field {field_name} does not exist on Calendar_entries")
            result = await self.db.execute(
                select(Calendar_entries)
                .where(getattr(Calendar_entries, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Calendar_entries.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching calendar_entriess by {field_name}: {str(e)}")
            raise