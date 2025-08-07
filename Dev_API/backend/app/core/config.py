import os
from pydantic import BaseSettings, Field, EmailStr


class Settings(BaseSettings):
    PROJECT_NAME: str = "WordPress VPS Provisioner"
    API_V1_PREFIX: str = "/api/v1"

    # Redis for Celery
    REDIS_URL: str = Field("redis://localhost:6379/0", env="REDIS_URL")

    # Email settings (SMTP)
    SMTP_HOST: str = Field(..., env="SMTP_HOST")
    SMTP_PORT: int = Field(..., env="SMTP_PORT")
    SMTP_USER: str = Field(..., env="SMTP_USER")
    SMTP_PASS: str = Field(..., env="SMTP_PASS")
    SMTP_FROM: EmailStr = Field(..., env="SMTP_FROM")

    class Config:
        env_file = ".env"


settings = Settings()
