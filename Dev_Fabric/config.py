# config.py
from pydantic_settings import BaseSettings
from pydantic import RedisDsn

class Settings(BaseSettings):
    APP_NAME: str = "NH AMC Fabric MVP"
    REDIS_URL: RedisDsn = "redis://localhost:6379/0"
    BROKER_URL: RedisDsn = REDIS_URL
    RESULT_BACKEND: RedisDsn = REDIS_URL

    # SMTP for report emails
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 25
    SMTP_USER: str | None = None
    SMTP_PASS: str | None = None
    SMTP_FROM: str = "no-reply@example.com"
    SMTP_STARTTLS: bool = False

    # 🔐 Secret token for wp-reset endpoint
    RESET_TOKEN: str | None = None   # set via env: RESET_TOKEN="your-long-random-string"

settings = Settings()