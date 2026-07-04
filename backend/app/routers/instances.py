"""Plant instance CRUD, care logging, and enriched reads."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import CurrentUser, get_current_user
from ..care import compute_care_status
from ..config import Settings, get_settings
from ..deps import class_repo, instance_repo
from ..models import (
    CareEvent,
    CareEventCreate,
    EventType,
    PlantInstance,
    PlantInstanceCreate,
    PlantInstanceRead,
    PlantInstanceUpdate,
)
from ..repositories import PlantClassRepository, PlantInstanceRepository

router = APIRouter(prefix="/api/instances", tags=["instances"])


async def _to_read(
    instance: PlantInstance,
    classes: PlantClassRepository,
    settings: Settings,
) -> PlantInstanceRead:
    plant_class = await classes.get(instance.class_id)
    status_ = compute_care_status(instance, plant_class)
    read = PlantInstanceRead(**instance.model_dump())
    read.care_status = status_
    read.plant_class = plant_class
    read.scan_url = f"{settings.scan_base_url.rstrip('/')}/{instance.id}"
    return read


@router.get("", response_model=list[PlantInstanceRead])
async def list_instances(
    class_id: str | None = Query(default=None),
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    instances = await repo.list(class_id=class_id)
    return [await _to_read(i, classes, settings) for i in instances]


@router.post("", response_model=PlantInstanceRead, status_code=status.HTTP_201_CREATED)
async def create_instance(
    payload: PlantInstanceCreate,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    if await classes.get(payload.class_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Referenced class does not exist")
    created = await repo.create(payload)
    return await _to_read(created, classes, settings)


@router.get("/{instance_id}", response_model=PlantInstanceRead)
async def get_instance(
    instance_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get(instance_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")
    return await _to_read(instance, classes, settings)


@router.patch("/{instance_id}", response_model=PlantInstanceRead)
async def update_instance(
    instance_id: str,
    payload: PlantInstanceUpdate,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    updated = await repo.update(instance_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")
    return await _to_read(updated, classes, settings)


@router.delete("/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_instance(
    instance_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    _: CurrentUser = Depends(get_current_user),
):
    if not await repo.delete(instance_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant instance not found")


@router.post("/{instance_id}/events", response_model=PlantInstanceRead)
async def add_care_event(
    instance_id: str,
    payload: CareEventCreate,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get(instance_id)
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
    return await _to_read(saved, classes, settings)
