"""Burien Station Plant Library — MCP server (FastMCP).

Exposes the library's operations as MCP tools. Authentication is via the same
personal access tokens used by the REST API, so MCP responses are scoped to the
authenticated user's memberships.

Reuses the backend's data layer (``app.*``) so behaviour matches the REST API.
"""
from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

SOURCE_BACKEND = Path(__file__).resolve().parents[1] / "backend"
if SOURCE_BACKEND.exists():
    sys.path.insert(0, str(SOURCE_BACKEND))

from fastmcp import FastMCP
from fastmcp.server.auth import AccessToken, TokenVerifier
from fastmcp.server.dependencies import get_access_token

from app.auth import CurrentUser
from app.care import compute_care_status
from app.config import get_settings
from app.db import get_db
from app.models import MemberRole
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
from app.repositories import (
    PersonalAccessTokenRepository,
    PlantClassRepository,
    PlantInstanceRepository,
    TenancyRepository,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("plantlibrary.mcp")

settings = get_settings()
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))
MCP_PATH = os.getenv("MCP_PATH", "/mcp/")


class PersonalAccessTokenVerifier(TokenVerifier):
    async def verify_token(self, token: str) -> AccessToken | None:
        pat = await PersonalAccessTokenRepository(get_db()).authenticate(token)
        if pat is None:
            return None
        claims = {
            "oid": pat.user_oid,
            "sub": pat.user_oid,
            "name": pat.user_name or pat.user_email or "Personal Access Token",
            "email": pat.user_email,
            "pat_id": pat.id,
        }
        return AccessToken(
            token=token,
            client_id=pat.user_oid,
            scopes=[],
            expires_at=int(pat.expires_at.timestamp()),
            claims=claims,
        )


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
    auth=PersonalAccessTokenVerifier(),
    lifespan=lifespan,
)


def _classes() -> PlantClassRepository:
    return PlantClassRepository(get_db())


def _instances() -> PlantInstanceRepository:
    return PlantInstanceRepository(get_db())


def _tenancy() -> TenancyRepository:
    return TenancyRepository(get_db())


def _current_user() -> CurrentUser:
    access_token = get_access_token()
    if access_token is None:
        raise PermissionError("Missing bearer token")
    claims = access_token.claims or {}
    return CurrentUser(
        oid=claims.get("oid") or claims.get("sub") or access_token.client_id,
        name=claims.get("name") or "Unknown",
        email=claims.get("email"),
    )


async def _authorize_property(
    property_id: str, *, require_owner: bool = False
):
    user = _current_user()
    prop = await _tenancy().get_property(property_id)
    if prop is None:
        raise ValueError("Property not found")
    membership = await _tenancy().get_membership(property_id, user.oid, user.email)
    if membership is None:
        raise PermissionError("You do not have access to this property")
    if require_owner and membership.role != MemberRole.owner:
        raise PermissionError("Only the property owner can perform this action")
    return membership


async def _read_instance(instance: PlantInstance) -> dict:
    plant_class = await _classes().get(instance.property_id, instance.class_id)
    care_status = compute_care_status(instance, plant_class)
    data = instance.model_dump(mode="json")
    data["care_status"] = care_status.model_dump(mode="json")
    data["plant_class"] = plant_class.model_dump(mode="json") if plant_class else None
    data["scan_url"] = f"{settings.scan_base_url.rstrip('/')}/{instance.id}"
    return data


# --------------------------------------------------------------------------- #
# Properties (tenancy discovery)
# --------------------------------------------------------------------------- #
@mcp.tool
async def list_properties() -> list[dict]:
    """List all properties (tenants). Use a property's id to scope other tools."""
    user = _current_user()
    pairs = await _tenancy().list_properties_for_user(user.oid, user.email)
    return [p.model_dump(mode="json") for p, _role in pairs]


@mcp.tool
async def list_gardens(property_id: str) -> list[dict]:
    """List the gardens belonging to a property."""
    await _authorize_property(property_id)
    return [g.model_dump(mode="json") for g in await _tenancy().list_gardens(property_id)]


# --------------------------------------------------------------------------- #
# Plant species (classes)
# --------------------------------------------------------------------------- #
@mcp.tool
async def list_plant_species(property_id: str) -> list[dict]:
    """List all plant species (care templates) in a property's library."""
    await _authorize_property(property_id)
    return [c.model_dump(mode="json") for c in await _classes().list(property_id)]


@mcp.tool
async def get_plant_species(property_id: str, class_id: str) -> dict | None:
    """Get a single plant species by id."""
    await _authorize_property(property_id)
    c = await _classes().get(property_id, class_id)
    return c.model_dump(mode="json") if c else None


@mcp.tool
async def create_plant_species(property_id: str, species: PlantClassCreate) -> dict:
    """Create a new plant species (with optional default care requirements)."""
    await _authorize_property(property_id)
    created = await _classes().create(property_id, species)
    return created.model_dump(mode="json")


@mcp.tool
async def update_plant_species(
    property_id: str, class_id: str, changes: PlantClassUpdate
) -> dict | None:
    """Update fields on an existing plant species."""
    await _authorize_property(property_id)
    updated = await _classes().update(property_id, class_id, changes)
    return updated.model_dump(mode="json") if updated else None


@mcp.tool
async def delete_plant_species(property_id: str, class_id: str) -> dict:
    """Delete a plant species by id."""
    await _authorize_property(property_id)
    ok = await _classes().delete(property_id, class_id)
    return {"deleted": ok, "id": class_id}


# --------------------------------------------------------------------------- #
# Plant instances
# --------------------------------------------------------------------------- #
@mcp.tool
async def list_plants(
    property_id: str, garden_id: str | None = None, class_id: str | None = None
) -> list[dict]:
    """List owned plants in a property, optionally filtered by garden or species
    (class_id). Includes computed care status (watering due/overdue) for each."""
    await _authorize_property(property_id)
    instances = await _instances().list(
        property_id, garden_id=garden_id, class_id=class_id
    )
    return [await _read_instance(i) for i in instances]


@mcp.tool
async def get_plant(property_id: str, instance_id: str) -> dict | None:
    """Get a single plant with its enriched care status and species info."""
    await _authorize_property(property_id)
    inst = await _instances().get(property_id, instance_id)
    return await _read_instance(inst) if inst else None


@mcp.tool
async def create_plant(property_id: str, plant: PlantInstanceCreate) -> dict:
    """Add a new plant instance. The referenced species (class_id) and garden
    (garden_id) must exist in the property."""
    await _authorize_property(property_id)
    if await _classes().get(property_id, plant.class_id) is None:
        raise ValueError(f"Referenced species '{plant.class_id}' does not exist")
    if await _tenancy().get_garden(property_id, plant.garden_id) is None:
        raise ValueError(f"Referenced garden '{plant.garden_id}' does not exist")
    created = await _instances().create(property_id, plant)
    return await _read_instance(created)


@mcp.tool
async def update_plant(
    property_id: str, instance_id: str, changes: PlantInstanceUpdate
) -> dict | None:
    """Update fields on an existing plant instance."""
    await _authorize_property(property_id)
    updated = await _instances().update(property_id, instance_id, changes)
    return await _read_instance(updated) if updated else None


@mcp.tool
async def delete_plant(property_id: str, instance_id: str) -> dict:
    """Delete a plant instance by id."""
    await _authorize_property(property_id)
    ok = await _instances().delete(property_id, instance_id)
    return {"deleted": ok, "id": instance_id}


@mcp.tool
async def log_care_event(
    property_id: str, instance_id: str, event: CareEventCreate
) -> dict | None:
    """Log a care event (watered, fertilized, repotted, pruned, pest treatment,
    note, health change, moved) for a plant and update its convenience dates."""
    await _authorize_property(property_id)
    instance = await _instances().get(property_id, instance_id)
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
    inst = await _instances().get_any(plant_id)
    if inst is not None:
        await _authorize_property(inst.property_id)
    return await _read_instance(inst) if inst else None


@mcp.tool
async def care_dashboard(property_id: str, garden_id: str | None = None) -> dict:
    """Summarise a property's collection: totals plus plants that are overdue for
    water, due soon, or need attention."""
    await _authorize_property(property_id)
    all_classes = await _classes().list(property_id)
    class_map = {c.id: c for c in all_classes}
    instances = await _instances().list(property_id, garden_id=garden_id)

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
    mcp.run(transport="http", host=MCP_HOST, port=MCP_PORT, path=MCP_PATH)
