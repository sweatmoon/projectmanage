import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.people import People

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class PeopleService:
    """Service layer for People operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[People]:
        """Create a new people"""
        try:
            obj = People(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created people with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating people: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[People]:
        """Get people by ID (excludes soft-deleted)"""
        try:
            query = select(People).where(People.id == obj_id, People.deleted_at.is_(None))
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching people {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of peoples (excludes soft-deleted)"""
        try:
            query = select(People).where(People.deleted_at.is_(None))
            count_query = select(func.count(People.id)).where(People.deleted_at.is_(None))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(People, field):
                        query = query.where(getattr(People, field) == value)
                        count_query = count_query.where(getattr(People, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(People, field_name):
                        query = query.order_by(getattr(People, field_name).desc())
                else:
                    if hasattr(People, sort):
                        query = query.order_by(getattr(People, sort))
            else:
                query = query.order_by(People.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching people list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[People]:
        """Update people"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"People {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated people {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating people {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete people"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"People {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted people {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting people {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[People]:
        """Get people by any field"""
        try:
            if not hasattr(People, field_name):
                raise ValueError(f"Field {field_name} does not exist on People")
            result = await self.db.execute(
                select(People).where(getattr(People, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching people by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[People]:
        """Get list of peoples filtered by field"""
        try:
            if not hasattr(People, field_name):
                raise ValueError(f"Field {field_name} does not exist on People")
            result = await self.db.execute(
                select(People)
                .where(getattr(People, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(People.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching peoples by {field_name}: {str(e)}")
            raise