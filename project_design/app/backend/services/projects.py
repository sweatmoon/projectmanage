import logging
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.projects import Projects

logger = logging.getLogger(__name__)


# ------------------ Service Layer ------------------
class ProjectsService:
    """Service layer for Projects operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: Dict[str, Any]) -> Optional[Projects]:
        """Create a new projects"""
        try:
            obj = Projects(**data)
            self.db.add(obj)
            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Created projects with id: {obj.id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error creating projects: {str(e)}")
            raise

    async def get_by_id(self, obj_id: int) -> Optional[Projects]:
        """Get projects by ID"""
        try:
            query = select(Projects).where(Projects.id == obj_id)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching projects {obj_id}: {str(e)}")
            raise

    async def get_list(
        self, 
        skip: int = 0, 
        limit: int = 20, 
        query_dict: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated list of projectss"""
        try:
            query = select(Projects)
            count_query = select(func.count(Projects.id))
            
            if query_dict:
                for field, value in query_dict.items():
                    if hasattr(Projects, field):
                        query = query.where(getattr(Projects, field) == value)
                        count_query = count_query.where(getattr(Projects, field) == value)
            
            count_result = await self.db.execute(count_query)
            total = count_result.scalar()

            if sort:
                if sort.startswith('-'):
                    field_name = sort[1:]
                    if hasattr(Projects, field_name):
                        query = query.order_by(getattr(Projects, field_name).desc())
                else:
                    if hasattr(Projects, sort):
                        query = query.order_by(getattr(Projects, sort))
            else:
                query = query.order_by(Projects.id.desc())

            result = await self.db.execute(query.offset(skip).limit(limit))
            items = result.scalars().all()

            return {
                "items": items,
                "total": total,
                "skip": skip,
                "limit": limit,
            }
        except Exception as e:
            logger.error(f"Error fetching projects list: {str(e)}")
            raise

    async def update(self, obj_id: int, update_data: Dict[str, Any]) -> Optional[Projects]:
        """Update projects"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Projects {obj_id} not found for update")
                return None
            for key, value in update_data.items():
                if hasattr(obj, key):
                    setattr(obj, key, value)

            await self.db.commit()
            await self.db.refresh(obj)
            logger.info(f"Updated projects {obj_id}")
            return obj
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating projects {obj_id}: {str(e)}")
            raise

    async def delete(self, obj_id: int) -> bool:
        """Delete projects"""
        try:
            obj = await self.get_by_id(obj_id)
            if not obj:
                logger.warning(f"Projects {obj_id} not found for deletion")
                return False
            await self.db.delete(obj)
            await self.db.commit()
            logger.info(f"Deleted projects {obj_id}")
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting projects {obj_id}: {str(e)}")
            raise

    async def get_by_field(self, field_name: str, field_value: Any) -> Optional[Projects]:
        """Get projects by any field"""
        try:
            if not hasattr(Projects, field_name):
                raise ValueError(f"Field {field_name} does not exist on Projects")
            result = await self.db.execute(
                select(Projects).where(getattr(Projects, field_name) == field_value)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error fetching projects by {field_name}: {str(e)}")
            raise

    async def list_by_field(
        self, field_name: str, field_value: Any, skip: int = 0, limit: int = 20
    ) -> List[Projects]:
        """Get list of projectss filtered by field"""
        try:
            if not hasattr(Projects, field_name):
                raise ValueError(f"Field {field_name} does not exist on Projects")
            result = await self.db.execute(
                select(Projects)
                .where(getattr(Projects, field_name) == field_value)
                .offset(skip)
                .limit(limit)
                .order_by(Projects.id.desc())
            )
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error fetching projectss by {field_name}: {str(e)}")
            raise