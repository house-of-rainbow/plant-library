"""Plant instance CRUD, care logging, and enriched reads."""
from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import CurrentUser, get_current_user
from ..care import compute_care_status
from ..config import Settings, get_settings
from ..deps import authorize, class_repo, instance_repo, tenancy_repo
from ..models import (
    CareEvent,
    CareEventCreate,
    EventType,
    PlantInstance,
    PlantInstanceCreate,
    PlantInstanceRead,
    PlantInstanceUpdate,
)
from ..repositories import (
    PlantClassRepository,
    PlantInstanceRepository,
    TenancyRepository,
)

router = APIRouter(prefix="/api/instances", tags=["instances"])
logger = logging.getLogger("plantlibrary.routers.instances")


async def _to_read(
    instance: PlantInstance,
    classes: PlantClassRepository,
    settings: Settings,
) -> PlantInstanceRead:
    plant_class = await classes.get(instance.property_id, instance.class_id)
    status_ = compute_care_status(instance, plant_class)
    read = PlantInstanceRead(**instance.model_dump())
    read.care_status = status_
    read.plant_class = plant_class
    read.scan_url = f"{settings.scan_base_url.rstrip('/')}/{instance.id}"
    logger.debug("Built plant instance read model instance_id=%s property_id=%s", instance.id, instance.property_id)
    return read


@router.get("", response_model=list[PlantInstanceRead])
async def list_instances(
    property_id: str = Query(...),
    garden_id: str | None = Query(default=None),
    class_id: str | None = Query(default=None),
    tag_id: str | None = Query(default=None),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    instances = await repo.list(
        property_id, garden_id=garden_id, class_id=class_id, tag_id=tag_id
    )
    result = [await _to_read(i, classes, settings) for i in instances]
    logger.debug(
        "Listed instances property_id=%s garden_id=%s class_id=%s tag_id=%s count=%s",
        property_id,
        garden_id,
        class_id,
        tag_id,
        len(result),
    )
    return result


@router.post("", response_model=PlantInstanceRead, status_code=status.HTTP_201_CREATED)
async def create_instance(
    payload: PlantInstanceCreate,
    property_id: str = Query(...),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if await classes.get(property_id, payload.class_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Referenced class does not exist")
    if await tenancy.get_garden(property_id, payload.garden_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Referenced garden does not exist")
    created = await repo.create(property_id, payload)
    logger.info("Created instance property_id=%s instance_id=%s", property_id, created.id)
    return await _to_read(created, classes, settings)


@router.get("/{instance_id}", response_model=PlantInstanceRead)
async def get_instance(
    instance_id: str,
    property_id: str = Query(...),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    instance = await repo.get(property_id, instance_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")
    logger.debug("Fetched instance property_id=%s instance_id=%s", property_id, instance_id)
    return await _to_read(instance, classes, settings)


@router.patch("/{instance_id}", response_model=PlantInstanceRead)
async def update_instance(
    instance_id: str,
    payload: PlantInstanceUpdate,
    property_id: str = Query(...),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    updated = await repo.update(property_id, instance_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")
    logger.info("Updated instance property_id=%s instance_id=%s", property_id, instance_id)
    return await _to_read(updated, classes, settings)


@router.delete("/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instance(
    instance_id: str,
    property_id: str = Query(...),
    repo: PlantInstanceRepository = Depends(instance_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if not await repo.delete(property_id, instance_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")
    logger.info("Deleted instance property_id=%s instance_id=%s", property_id, instance_id)


@router.post("/{instance_id}/events", response_model=PlantInstanceRead)
async def add_care_event(
    instance_id: str,
    payload: CareEventCreate,
    property_id: str = Query(...),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    instance = await repo.get(property_id, instance_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")

    event = CareEvent(**payload.model_dump(exclude_unset=True))
    instance.events.insert(0, event)

    # Update convenience timestamps based on the event type.
    now = event.occurred_at or datetime.now(timezone.utc)
    if event.type == EventType.watered:
        instance.last_watered_at = now
    elif event.type == EventType.fertilized:
        instance.last_fertilized_at = now
    elif event.type == EventType.repotted:
        instance.last_repotted_at = now
    elif event.type == EventType.health_change and event.new_health_status:
        instance.health_status = event.new_health_status

    saved = await repo.replace(instance)
    logger.info(
        "Added care event property_id=%s instance_id=%s event_type=%s",
        property_id,
        instance_id,
        event.type,
    )
    return await _to_read(saved, classes, settings)
