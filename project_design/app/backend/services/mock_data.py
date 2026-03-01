import logging

logger = logging.getLogger(__name__)


async def initialize_mock_data():
    """Mock data initialization is disabled. All data is persisted in the database."""
    logger.info("Mock data initialization is disabled - using persistent database only")
    return
