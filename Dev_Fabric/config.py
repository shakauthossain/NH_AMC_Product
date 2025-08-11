# config.py
from typing import List
from pydantic import RedisDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # Make .env work + be forgiving with key case
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # App
    APP_NAME: str = "NH AMC Fabric MVP"

    # Celery/Redis
    REDIS_URL: RedisDsn = "redis://localhost:6379/0"
    BROKER_URL: RedisDsn | None = None   # falls back to REDIS_URL if not set
    RESULT_BACKEND: RedisDsn | None = None

    # SMTP for report emails
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 25
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    SMTP_FROM: str = "no-reply@example.com"
    SMTP_STARTTLS: bool = False

    # Security — required by /tasks/wp-reset
    RESET_TOKEN: str | None = None

    # CORS (comma-separated in .env, e.g., "https://a.com,https://b.com" or "*")
    CORS_ALLOW_ORIGINS: List[str] = ["*"]

    @field_validator("BROKER_URL", mode="before")
    @classmethod
    def default_broker(cls, v, info):
        if v is None:
            return info.data.get("REDIS_URL", "redis://localhost:6379/0")
        return v

    @field_validator("RESULT_BACKEND", mode="before")
    @classmethod
    def default_backend(cls, v, info):
        if v is None:
            return info.data.get("REDIS_URL", "redis://localhost:6379/0")
        return v

    @field_validator("CORS_ALLOW_ORIGINS", mode="before")
    @classmethod
    def parse_cors(cls, v):
        if v is None:
            return ["*"]
        if isinstance(v, str):
            v = v.strip()
            if v == "*":
                return ["*"]
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

settings = Settings()
