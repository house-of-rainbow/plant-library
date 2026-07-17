"""Tags: plant groupings for bulk care actions.

A tag has a ``scope`` of ``null`` (independent), ``garden`` (bound to one
garden) or ``property`` (spans the whole property). Tags can be applied to
plants and then used to run a single action (water, fertilize, ...) against
every plant carrying the tag.
"""
from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import CurrentUser, get_current_user
from ..deps import authorize, instance_repo, tag_repo, tenancy_repo
from ..models import (
    CareEvent,
    EventType,
    Tag,
    TagAction,
    TagBulkInstances,
    TagCreate,
    TagScope,
    TagUpdate,
)
from ..repositories import PlantInstanceRepository, TagRepository, TenancyRepository

router = APIRouter(prefix="/api/properties/{property_id}/tags", tags=["tags"])
logger = logging.getLogger("plantlibrary.routers.tags")


def _apply_event(instance, event: CareEvent) -> None:
    instance.events.insert(0, event)
    now = event.occurred_at or datetime.now(timezone.utc)
    if event.type == EventType.watered:
        instance.last_watered_at = now
    elif event.type == EventType.fertilized:
        instance.last_fertilized_at = now
    elif event.type == EventType.repotted:
        instance.last_repotted_at = now
    elif event.type == EventType.health_change and event.new_health_status:
        instance.health_status = event.new_health_status


@router.get("", response_model=list[Tag])
async def list_tags(
    property_id: str,
    garden_id: str | None = Query(default=None),
    scope: TagScope | None = Query(default=None),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    result = await tags.list(property_id, garden_id=garden_id, scope=scope)
    logger.debug(
        "Listed tags property_id=%s garden_id=%s scope=%s count=%s",
        property_id,
        garden_id,
        scope,
        len(result),
    )
    return result


@router.post("", response_model=Tag, status_code=status.HTTP_201_CREATED)
async def create_tag(
    property_id: str,
    payload: TagCreate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if payload.scope == TagScope.garden:
        if not payload.garden_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "garden_id is required for garden-scoped tags"
            )
        if await tenancy.get_garden(property_id, payload.garden_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Referenced garden does not exist")
    else:
        payload.garden_id = None
    tag = await tags.create(property_id, payload)
    logger.info("Created tag property_id=%s tag_id=%s", property_id, tag.id)
    return tag


@router.patch("/{tag_id}", response_model=Tag)
async def update_tag(
    property_id: str,
    tag_id: str,
    payload: TagUpdate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    updated = await tags.update(property_id, tag_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    logger.info("Updated tag property_id=%s tag_id=%s", property_id, tag_id)
    return updated


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    property_id: str,
    tag_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    instances: PlantInstanceRepository = Depends(instance_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if not await tags.delete(property_id, tag_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    # Detach the tag from any plants that carry it.
    tagged = await instances.list(property_id, tag_id=tag_id)
    for inst in tagged:
        inst.tag_ids = [t for t in inst.tag_ids if t != tag_id]
        await instances.replace(inst)
    logger.info("Deleted tag property_id=%s tag_id=%s detached_instances=%s", property_id, tag_id, len(tagged))


@router.post("/{tag_id}/apply", status_code=status.HTTP_204_NO_CONTENT)
async def apply_tag(
    property_id: str,
    tag_id: str,
    payload: TagBulkInstances,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    instances: PlantInstanceRepository = Depends(instance_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if await tags.get(property_id, tag_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    applied = 0
    for instance_id in payload.instance_ids:
        inst = await instances.get(property_id, instance_id)
        if inst is None:
            continue
        if tag_id not in inst.tag_ids:
            inst.tag_ids.append(tag_id)
            await instances.replace(inst)
            applied += 1
    logger.info("Applied tag property_id=%s tag_id=%s instances=%s", property_id, tag_id, applied)


@router.post("/{tag_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_tag_from_plants(
    property_id: str,
    tag_id: str,
    payload: TagBulkInstances,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    instances: PlantInstanceRepository = Depends(instance_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    removed = 0
    for instance_id in payload.instance_ids:
        inst = await instances.get(property_id, instance_id)
        if inst is None or tag_id not in inst.tag_ids:
            continue
        inst.tag_ids = [t for t in inst.tag_ids if t != tag_id]
        await instances.replace(inst)
        removed += 1
    logger.info("Removed tag from plants property_id=%s tag_id=%s instances=%s", property_id, tag_id, removed)


@router.post("/{tag_id}/action")
async def run_tag_action(
    property_id: str,
    tag_id: str,
    payload: TagAction,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    tags: TagRepository = Depends(tag_repo),
    instances: PlantInstanceRepository = Depends(instance_repo),
    user: CurrentUser = Depends(get_current_user),
):
    """Apply a single care action to every plant carrying the tag."""
    await authorize(tenancy, property_id, user)
    if await tags.get(property_id, tag_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tag not found")
    tagged = await instances.list(property_id, tag_id=tag_id)
    affected = 0
    for inst in tagged:
        event = CareEvent(**payload.model_dump(exclude_unset=True))
        _apply_event(inst, event)
        await instances.replace(inst)
        affected += 1
    logger.info(
        "Ran tag action property_id=%s tag_id=%s action=%s affected=%s",
        property_id,
        tag_id,
        payload.type,
        affected,
    )
    return {"affected": affected}
