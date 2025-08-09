# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
import os

class Settings(BaseSettings):
    # ---------- Database ----------
    # default to local sqlite file next to backend/
    database_url: str = Field(
        default="sqlite:///./dev.db",
        alias="DATABASE_URL",
    )
    PROJECT_NAME: str = "WordPress VPS Provisioner"
    API_V1_PREFIX: str = "/api/v1"
    # ---------- SMTP ----------
    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int | None = Field(default=None, alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, alias="SMTP_USER")
    smtp_pass: str | None = Field(default=None, alias="SMTP_PASS")
    smtp_from: str | None = Field(default=None, alias="SMTP_FROM")

    # ---------- Celery ----------
    celery_broker_url: str = Field(
        default="redis://127.0.0.1:6379/0",
        alias="CELERY_BROKER_URL",
    )
    celery_result_backend: str = Field(
        default="redis://127.0.0.1:6379/1",
        alias="CELERY_RESULT_BACKEND",
    )

    # ---------- Reset ----------
    approval_token: str | None = Field(default=None, alias="APPROVAL_TOKEN")

    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()