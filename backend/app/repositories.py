"""Cosmos-backed repositories for plant classes and instances."""
from __future__ import annotations

from datetime import datetime, timezone

from azure.cosmos.exceptions import CosmosResourceNotFoundError

from .db import Database
from .models import (
    PlantClass,
    PlantClassCreate,
    PlantClassUpdate,
    PlantInstance,
    PlantInstanceCreate,
    PlantInstanceUpdate,
)

CLASS_PK = "class"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PlantClassRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.classes

    async def list(self) -> list[PlantClass]:
        items = [
            item
            async for item in self._c.query_items(
                query="SELECT * FROM c WHERE c.doc_type = 'plant_class' ORDER BY c.common_name"
            )
        ]
        return [PlantClass(**i) for i in items]

    async def get(self, class_id: str) -> PlantClass | None:
        try:
            item = await self._c.read_item(item=class_id, partition_key=CLASS_PK)
        except CosmosResourceNotFoundError:
            return None
        return PlantClass(**item)

    async def create(self, payload: PlantClassCreate) -> PlantClass:
        entity = PlantClass(**payload.model_dump())
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def update(self, class_id: str, payload: PlantClassUpdate) -> PlantClass | None:
        current = await self.get(class_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = PlantClass(**data)
        await self._c.replace_item(item=class_id, body=updated.model_dump(mode="json"))
        return updated

    async def delete(self, class_id: str) -> bool:
        try:
            await self._c.delete_item(item=class_id, partition_key=CLASS_PK)
        except CosmosResourceNotFoundError:
            return False
        return True


class PlantInstanceRepository:
    def __init__(self, db: Database) -> None:
        self._c = db.instances

    async def list(self, class_id: str | None = None) -> list[PlantInstance]:
        if class_id:
            query = "SELECT * FROM c WHERE c.doc_type = 'plant_instance' AND c.class_id = @cid ORDER BY c.created_at DESC"
            params = [{"name": "@cid", "value": class_id}]
        else:
            query = "SELECT * FROM c WHERE c.doc_type = 'plant_instance' ORDER BY c.created_at DESC"
            params = []
        items = [
            item
            async for item in self._c.query_items(query=query, parameters=params)
        ]
        return [PlantInstance(**i) for i in items]

    async def get(self, instance_id: str) -> PlantInstance | None:
        # pk == class_id, but scan/lookup by id alone needs a cross-partition query.
        query = "SELECT * FROM c WHERE c.id = @id AND c.doc_type = 'plant_instance'"
        params = [{"name": "@id", "value": instance_id}]
        async for item in self._c.query_items(query=query, parameters=params):
            return PlantInstance(**item)
        return None

    async def create(self, payload: PlantInstanceCreate) -> PlantInstance:
        entity = PlantInstance(**payload.model_dump())
        entity.pk = entity.class_id  # partition by owning class
        await self._c.create_item(body=entity.model_dump(mode="json"))
        return entity

    async def update(
        self, instance_id: str, payload: PlantInstanceUpdate
    ) -> PlantInstance | None:
        current = await self.get(instance_id)
        if current is None:
            return None
        data = current.model_dump()
        data.update(payload.model_dump(exclude_unset=True))
        data["updated_at"] = _now()
        updated = PlantInstance(**data)
        updated.pk = updated.class_id
        await self._c.replace_item(
            item=instance_id, body=updated.model_dump(mode="json")
        )
        return updated

    async def replace(self, entity: PlantInstance) -> PlantInstance:
        entity.updated_at = _now()
        entity.pk = entity.class_id
        await self._c.replace_item(
            item=entity.id, body=entity.model_dump(mode="json")
        )
        return entity

    async def delete(self, instance_id: str) -> bool:
        current = await self.get(instance_id)
        if current is None:
            return False
        await self._c.delete_item(item=instance_id, partition_key=current.pk)
        return True
