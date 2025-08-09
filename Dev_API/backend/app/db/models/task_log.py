from sqlalchemy import Column, Integer, String, Text, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class TaskLog(Base):
    __tablename__ = "task_logs"

    id = Column(Integer, primary_key=True, index=True)   # New PK
    task_id = Column(String, index=True, nullable=False) # No longer PK
    status = Column(String, nullable=False)
    message = Column(Text)
    meta = Column(JSONB, default=dict, nullable=False)   # JSONB for Postgres
    output = Column(JSONB)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, onupdate=func.now(), server_default=func.now(), nullable=False)