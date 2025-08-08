# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.api import router as api_router
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure tables exist (quick bootstrap; switch to Alembic later)
@app.on_event("startup")
def on_startup():
    from app.db.session import engine
    from app.db.models.task_log import Base  # the Base defined in your model file
    Base.metadata.create_all(bind=engine)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)