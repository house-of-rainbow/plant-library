"""Azure Blob Storage layer for plant images.

Uses a connection string (Azurite locally, real storage account in prod).
The container is created on first use with anonymous blob read access so the
frontend can render images directly from the returned URLs.
"""
from __future__ import annotations

import logging
from pathlib import Path
import secrets
from typing import Optional

from azure.core.exceptions import ResourceExistsError
from azure.storage.blob.aio import BlobServiceClient

from .config import Settings, get_settings

logger = logging.getLogger("plantlibrary.storage")

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

_ALLOWED_SCENE_EXTENSIONS = {"glb"}
_ALLOWED_SCENE_CONTENT_TYPES = {
    "application/octet-stream",
    "model/gltf-binary",
}


class BlobStorage:
    def __init__(self) -> None:
        self._service: Optional[BlobServiceClient] = None
        self._settings: Optional[Settings] = None

    async def connect(self, settings: Settings | None = None) -> None:
        settings = settings or get_settings()
        self._settings = settings
        if not settings.azure_storage_connection_string:
            logger.warning("No storage connection string set; image upload disabled")
            return
        self._service = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
        container = self._service.get_container_client(settings.azure_storage_container)
        try:
            await container.create_container(public_access="blob")
        except ResourceExistsError:
            pass
        logger.info("Blob container '%s' ready", settings.azure_storage_container)

    async def close(self) -> None:
        if self._service is not None:
            await self._service.close()
            self._service = None

    async def upload_image(self, data: bytes, content_type: str) -> str:
        if self._service is None or self._settings is None:
            raise RuntimeError("Blob storage is not configured")
        ext = _ALLOWED_CONTENT_TYPES.get(content_type)
        if ext is None:
            raise ValueError(f"Unsupported image content type: {content_type}")

        blob_name = f"{secrets.token_hex(12)}.{ext}"
        container = self._service.get_container_client(
            self._settings.azure_storage_container
        )
        from azure.storage.blob import ContentSettings

        await container.upload_blob(
            name=blob_name,
            data=data,
            content_settings=ContentSettings(content_type=content_type),
            overwrite=True,
        )

        base = self._settings.azure_storage_public_base_url.rstrip("/")
        container_name = self._settings.azure_storage_container
        return f"{base}/{container_name}/{blob_name}"

    async def upload_garden_scene(
        self, data: bytes, content_type: str, filename: str | None
    ) -> str:
        if self._service is None or self._settings is None:
            raise RuntimeError("Blob storage is not configured")

        ext = Path(filename or "scene.glb").suffix.lower().lstrip(".")
        if ext not in _ALLOWED_SCENE_EXTENSIONS:
            raise ValueError("Unsupported scene file type; expected a .glb export")
        if content_type and content_type not in _ALLOWED_SCENE_CONTENT_TYPES:
            raise ValueError("Unsupported scene content type; expected a GLB upload")

        blob_name = f"garden-scenes/{secrets.token_hex(12)}.{ext}"
        container = self._service.get_container_client(
            self._settings.azure_storage_container
        )
        from azure.storage.blob import ContentSettings

        await container.upload_blob(
            name=blob_name,
            data=data,
            content_settings=ContentSettings(content_type="model/gltf-binary"),
            overwrite=True,
        )

        base = self._settings.azure_storage_public_base_url.rstrip("/")
        container_name = self._settings.azure_storage_container
        return f"{base}/{container_name}/{blob_name}"


storage = BlobStorage()


def get_storage() -> BlobStorage:
    return storage
