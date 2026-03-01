import logging

logger = logging.getLogger(__name__)


async def initialize_admin_user():
    """Initialize admin user if not exists"""
    logger.info("Admin user initialization skipped (no auth module)")
    pass
