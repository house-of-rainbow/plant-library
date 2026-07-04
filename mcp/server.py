"""Burien Station Plant Library — MCP server (FastMCP).

Exposes the library's operations as MCP tools. Authentication is via API key:
a bearer token that must be one of the GUIDs listed in the ``MCP_API_KEYS``
environment variable (comma-separated). This is separate from the web app's
EntraID auth.

Reuses the backend's data layer (``app.*``) so behaviour matches the REST API.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier

from app.care import compute_care_status
from app.config import get_settings
from app.db import get_db
from app.models import (
    CareEvent,
    CareEventCreate,
    EventType,
    PlantClass,
    PlantClassCreate,
    PlantClassUpdate,
    PlantInstance,
    PlantInstanceCreate,
    PlantInstanceUpdate,
)
from app.repositories import PlantClassRepository, PlantInstanceRepository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("plantlibrary.mcp")

settings = get_settings()


def _build_verifier() -> StaticTokenVerifier:
    """Every GUID in MCP_API_KEYS is accepted as a valid bearer token."""
    tokens = {
        key: {"client_id": "mcp-client", "scopes": []}
        for key in settings.mcp_api_keys_list
    }
    if not tokens:
        logger.warning("MCP_API_KEYS is empty — all requests will be rejected.")
    return StaticTokenVerifier(tokens=tokens)


@asynccontextmanager
async def lifespan(_server: FastMCP):
    await get_db().connect(settings)
    logger.info("MCP server connected to Cosmos DB")
    try:
        yield
    finally:
        await get_db().close()


mcp = FastMCP(
    name="Burien Station Plant Library",
    instructions=(
        "Tools to manage a prosumer plant collection: plant species (classes), "
        "individual plants (instances), care logging, label scanning and a care "
        "dashboard."
    ),
    auth=_build_verifier(),
    lifespan=lifespan,
)


def _classes() -> PlantClassRepository:
    return PlantClassRepository(get_db())


def _instances() -> PlantInstanceRepository:
    return PlantInstanceRepository(get_db())


async def _read_instance(instance: PlantInstance) -> dict:
    plant_class = await _classes().get(instance.class_id)
    care_status = compute_care_status(instance, plant_class)
    data = instance.model_dump(mode="json")
    data["care_status"] = care_status.model_dump(mode="json")
    data["plant_class"] = plant_class.model_dump(mode="json") if plant_class else None
    data["scan_url"] = f"{settings.scan_base_url.rstrip('/')}/{instance.id}"
    return data


# --------------------------------------------------------------------------- #
# Plant species (classes)
# --------------------------------------------------------------------------- #
@mcp.tool
async def list_plant_species() -> list[dict]:
    """List all plant species (care templates) in the library."""
    return [c.model_dump(mode="json") for c in await _classes().list()]


@mcp.tool
async def get_plant_species(class_id: str) -> dict | None:
    """Get a single plant species by id."""
    c = await _classes().get(class_id)
    return c.model_dump(mode="json") if c else None


@mcp.tool
async def create_plant_species(species: PlantClassCreate) -> dict:
    """Create a new plant species (with optional default care requirements)."""
    created = await _classes().create(species)
    return created.model_dump(mode="json")


@mcp.tool
async def update_plant_species(class_id: str, changes: PlantClassUpdate) -> dict | None:
    """Update fields on an existing plant species."""
    updated = await _classes().update(class_id, changes)
    return updated.model_dump(mode="json") if updated else None


@mcp.tool
async def delete_plant_species(class_id: str) -> dict:
    """Delete a plant species by id."""
    ok = await _classes().delete(class_id)
    return {"deleted": ok, "id": class_id}


# --------------------------------------------------------------------------- #
# Plant instances
# --------------------------------------------------------------------------- #
@mcp.tool
async def list_plants(class_id: str | None = None) -> list[dict]:
    """List owned plants, optionally filtered by species (class_id). Includes
    computed care status (watering due/overdue) for each plant."""
    instances = await _instances().list(class_id=class_id)
    return [await _read_instance(i) for i in instances]


@mcp.tool
async def get_plant(instance_id: str) -> dict | None:
    """Get a single plant with its enriched care status and species info."""
    inst = await _instances().get(instance_id)
    return await _read_instance(inst) if inst else None


@mcp.tool
async def create_plant(plant: PlantInstanceCreate) -> dict:
    """Add a new plant instance. The referenced species (class_id) must exist."""
    if await _classes().get(plant.class_id) is None:
        raise ValueError(f"Referenced species '{plant.class_id}' does not exist")
    created = await _instances().create(plant)
    return await _read_instance(created)


@mcp.tool
async def update_plant(instance_id: str, changes: PlantInstanceUpdate) -> dict | None:
    """Update fields on an existing plant instance."""
    updated = await _instances().update(instance_id, changes)
    return await _read_instance(updated) if updated else None


@mcp.tool
async def delete_plant(instance_id: str) -> dict:
    """Delete a plant instance by id."""
    ok = await _instances().delete(instance_id)
    return {"deleted": ok, "id": instance_id}


@mcp.tool
async def log_care_event(instance_id: str, event: CareEventCreate) -> dict | None:
    """Log a care event (watered, fertilized, repotted, pruned, pest treatment,
    note, health change, moved) for a plant and update its convenience dates."""
    instance = await _instances().get(instance_id)
    if instance is None:
        return None

    care_event = CareEvent(**event.model_dump(exclude_unset=True))
    instance.events.insert(0, care_event)

    now = care_event.occurred_at or datetime.now(timezone.utc)
    if care_event.type == EventType.watered:
        instance.last_watered_at = now
    elif care_event.type == EventType.fertilized:
        instance.last_fertilized_at = now
    elif care_event.type == EventType.repotted:
        instance.last_repotted_at = now
    elif care_event.type == EventType.health_change and care_event.new_health_status:
        instance.health_status = care_event.new_health_status

    saved = await _instances().replace(instance)
    return await _read_instance(saved)


# --------------------------------------------------------------------------- #
# Scan + dashboard
# --------------------------------------------------------------------------- #
@mcp.tool
async def resolve_scan(plant_id: str) -> dict | None:
    """Resolve a scanned QR/NFC label id (e.g. plant_ab12cd34) to a plant."""
    inst = await _instances().get(plant_id)
    return await _read_instance(inst) if inst else None


@mcp.tool
async def care_dashboard() -> dict:
    """Summarise the collection: totals plus plants that are overdue for water,
    due soon, or need attention."""
    all_classes = await _classes().list()
    class_map = {c.id: c for c in all_classes}
    instances = await _instances().list()

    overdue: list[dict] = []
    due_soon: list[dict] = []
    attention: list[dict] = []

    for inst in instances:
        pc: PlantClass | None = class_map.get(inst.class_id)
        cs = compute_care_status(inst, pc)
        read = await _read_instance(inst)
        if cs.watering_overdue:
            overdue.append(read)
        elif cs.days_until_watering is not None and cs.days_until_watering <= 2:
            due_soon.append(read)
        if inst.health_status.value in {"struggling", "critical"}:
            attention.append(read)

    return {
        "total_plants": len(instances),
        "total_species": len(all_classes),
        "watering_overdue_count": len(overdue),
        "watering_due_soon_count": len(due_soon),
        "needs_attention_count": len(attention),
        "watering_overdue": overdue,
        "watering_due_soon": due_soon,
        "needs_attention": attention,
    }


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8000, path="/mcp/")
