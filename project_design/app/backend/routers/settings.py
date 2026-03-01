from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/admin/settings", tags=["admin-settings"])


@router.get("")
async def get_settings():
    """Get application settings"""
    return {"settings": {}}
