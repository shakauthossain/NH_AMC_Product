from fastapi import APIRouter
from app.api.v1.endpoints import provision, status

router = APIRouter()
router.include_router(provision.router)
router.include_router(status.router)
