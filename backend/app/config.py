import os
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The billing database. It must be its own database, never the main CRM/HR one.
    # Local development defaults to a SQLite file; production uses PostgreSQL, e.g.
    # postgresql+psycopg://user:pass@host:5432/rexera_billing
    DATABASE_URL: str = "sqlite:///./billing.db"

    # Main application API: sign-in happens there and every billing request is checked
    # against it (/api/rbac/me), so billing never sees passwords or the JWT signing key.
    MAIN_API_URL: str = "http://localhost:8000"
    IDENTITY_CACHE_SECONDS: int = 60

    CORS_ORIGINS: List[str] = ["http://localhost:5190"]
    RATE_LIMIT_PER_MINUTE: int = 300
    MAX_UPLOAD_MB: int = 15
    DEV_AUTH: bool = True

    model_config = SettingsConfigDict(env_file=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
                                      env_file_encoding="utf-8", extra="ignore")


settings = Settings()
