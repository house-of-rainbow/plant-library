"""Application configuration loaded from environment variables.

Secrets are never hard-coded; everything is sourced from the environment
(injected via env vars in production, `.env` for local development).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173"

    # Cosmos DB
    cosmos_endpoint: str = "https://localhost:8081"
    cosmos_key: str = ""
    cosmos_database: str = "plantlibrary"
    cosmos_classes_container: str = "plant_classes"
    cosmos_instances_container: str = "plant_instances"
    cosmos_tenancy_container: str = "tenancy"
    cosmos_auth_container: str = "user_auth"
    cosmos_allow_insecure: bool = False

    # Blob storage
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "plant-images"
    azure_storage_public_base_url: str = ""

    # Auth (EntraID)
    auth_disabled: bool = True
    entra_tenant_id: str = "common"
    entra_client_id: str = ""
    entra_api_audience: str = ""

    # Scan / labels
    scan_base_url: str = "http://localhost:5173/scan"

    # Pl@ntNet identification API (https://my.plantnet.org/)
    plantnet_api_key: str = Field(default="", validation_alias="PLANT_DOT_NET__API_KEY")
    plantnet_base_url: str = "https://my-api.plantnet.org"

    # OpenAI vision fallback for identification (used when Pl@ntNet fails)
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = "gpt-4o"

    # ASPCA pet-toxicity lookup (best-effort enrichment after identification)
    aspca_enabled: bool = True

    # MCP server API keys (comma-separated GUIDs; any listed key is valid)
    mcp_api_keys: str = ""

    @property
    def mcp_api_keys_list(self) -> list[str]:
        return [k.strip() for k in self.mcp_api_keys.split(",") if k.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings singleton."""
    return Settings()
