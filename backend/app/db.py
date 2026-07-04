"""Cosmos DB access layer.

A single :class:`CosmosClient` is created and reused for the lifetime of the
process (per Cosmos DB SDK best practice). Containers are created on startup
if they do not already exist.
"""
from __future__ import annotations

import logging
from typing import Optional

from azure.cosmos import PartitionKey
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient

from .config import Settings, get_settings

logger = logging.getLogger("plantlibrary.db")


class Database:
    """Holds the singleton async Cosmos client and container proxies."""

    def __init__(self) -> None:
        self._client: Optional[AsyncCosmosClient] = None
        self.classes = None
        self.instances = None

    async def connect(self, settings: Settings | None = None) -> None:
        settings = settings or get_settings()

        connection_verify = not settings.cosmos_allow_insecure
        self._client = AsyncCosmosClient(
            url=settings.cosmos_endpoint,
            credential=settings.cosmos_key,
            connection_verify=connection_verify,
        )

        db = await self._client.create_database_if_not_exists(
            id=settings.cosmos_database
        )
        self.classes = await db.create_container_if_not_exists(
            id=settings.cosmos_classes_container,
            partition_key=PartitionKey(path="/pk"),
        )
        self.instances = await db.create_container_if_not_exists(
            id=settings.cosmos_instances_container,
            partition_key=PartitionKey(path="/pk"),
        )
        logger.info("Connected to Cosmos DB database '%s'", settings.cosmos_database)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None


# Module-level singleton reused across requests.
db = Database()


def get_db() -> Database:
    return db
