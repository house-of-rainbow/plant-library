"""Property / Garden / Member management — the multitenancy hierarchy root.

Property -> Garden -> Plant. The creator of a property is always its owner.
Owners manage plants, gardens, members and property settings; members manage
plants (and tags) only.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response

from ..auth import CurrentUser, get_current_user
from ..deps import authorize, tenancy_repo
from ..models import (
    Garden,
    GardenCreate,
    GardenScene,
    GardenUpdate,
    MemberInvite,
    MemberRole,
    MemberRoleUpdate,
    Membership,
    Property,
    PropertyCreate,
    PropertyRead,
    PropertyUpdate,
)
from ..repositories import TenancyRepository
from ..storage import BlobStorage, get_storage

router = APIRouter(prefix="/api/properties", tags=["properties"])
logger = logging.getLogger("plantlibrary.routers.properties")

_MAX_SCENE_BYTES = 100 * 1024 * 1024


async def _to_read(
    prop: Property, role: MemberRole, tenancy: TenancyRepository
) -> PropertyRead:
    gardens = await tenancy.list_gardens(prop.id)
    members = await tenancy.list_members(prop.id)
    read = PropertyRead(**prop.model_dump())
    read.role = role
    read.gardens = gardens
    read.member_count = len(members)
    return read


@router.get("", response_model=list[PropertyRead])
async def list_properties(
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    pairs = await tenancy.list_properties_for_user(user.oid, user.email)
    result = [await _to_read(p, role, tenancy) for p, role in pairs]
    logger.debug("Listed properties for user user_oid=%s count=%s", user.oid, len(result))
    return result


@router.post("", response_model=PropertyRead, status_code=status.HTTP_201_CREATED)
async def create_property(
    payload: PropertyCreate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    prop = await tenancy.create_property(
        payload, owner_oid=user.oid, owner_email=user.email, owner_name=user.name
    )
    # Optionally provision the first "Home" garden alongside the property.
    if payload.home_garden_name:
        await tenancy.create_garden(
            prop.id, GardenCreate(name=payload.home_garden_name, is_home=True)
        )
    logger.info("Created property property_id=%s owner_oid=%s", prop.id, user.oid)
    return await _to_read(prop, MemberRole.owner, tenancy)


@router.get("/{property_id}", response_model=PropertyRead)
async def get_property(
    property_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    membership = await authorize(tenancy, property_id, user)
    prop = await tenancy.get_property(property_id)
    assert prop is not None  # authorize() already verified existence
    logger.debug("Fetched property property_id=%s user_oid=%s", property_id, user.oid)
    return await _to_read(prop, membership.role, tenancy)


@router.patch("/{property_id}", response_model=PropertyRead)
async def update_property(
    property_id: str,
    payload: PropertyUpdate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    updated = await tenancy.update_property(property_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    logger.info("Updated property property_id=%s", property_id)
    return await _to_read(updated, MemberRole.owner, tenancy)


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    await tenancy.delete_property(property_id)
    logger.info("Deleted property property_id=%s", property_id)


# --------------------------------------------------------------------------- #
# Gardens
# --------------------------------------------------------------------------- #
@router.get("/{property_id}/gardens", response_model=list[Garden])
async def list_gardens(
    property_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    gardens = await tenancy.list_gardens(property_id)
    logger.debug("Listed gardens property_id=%s count=%s", property_id, len(gardens))
    return gardens


@router.post(
    "/{property_id}/gardens", response_model=Garden, status_code=status.HTTP_201_CREATED
)
async def create_garden(
    property_id: str,
    payload: GardenCreate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    garden = await tenancy.create_garden(property_id, payload)
    logger.info("Created garden property_id=%s garden_id=%s", property_id, garden.id)
    return garden


@router.patch("/{property_id}/gardens/{garden_id}", response_model=Garden)
async def update_garden(
    property_id: str,
    garden_id: str,
    payload: GardenUpdate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    updated = await tenancy.update_garden(property_id, garden_id, payload)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Garden not found")
    logger.info("Updated garden property_id=%s garden_id=%s", property_id, garden_id)
    return updated


@router.post("/{property_id}/gardens/{garden_id}/scene", response_model=Garden)
async def upload_garden_scene(
    property_id: str,
    garden_id: str,
    file: UploadFile = File(...),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    storage: BlobStorage = Depends(get_storage),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    garden = await tenancy.get_garden(property_id, garden_id)
    if garden is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Garden not found")

    data = await file.read()
    if len(data) > _MAX_SCENE_BYTES:
        logger.warning("Rejected garden scene upload property_id=%s garden_id=%s bytes=%s", property_id, garden_id, len(data))
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Scene file too large")

    try:
        url = await storage.upload_garden_scene(data, file.content_type or "", file.filename)
    except ValueError as exc:
        logger.warning("Rejected garden scene upload property_id=%s garden_id=%s reason=%s", property_id, garden_id, exc)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RuntimeError as exc:
        logger.warning("Garden scene upload unavailable property_id=%s garden_id=%s", property_id, garden_id)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    updated = await tenancy.update_garden(
        property_id,
        garden_id,
        GardenUpdate(
            scene=GardenScene(model_url=url, model_filename=file.filename or None)
        ),
    )
    assert updated is not None
    logger.info(
        "Uploaded garden scene property_id=%s garden_id=%s filename=%s bytes=%s",
        property_id,
        garden_id,
        file.filename,
        len(data),
    )
    return updated


@router.get("/{property_id}/gardens/{garden_id}/scene")
async def get_garden_scene(
    property_id: str,
    garden_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    storage: BlobStorage = Depends(get_storage),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    garden = await tenancy.get_garden(property_id, garden_id)
    if garden is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Garden not found")
    if garden.scene is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Garden has no scene file")

    try:
        data, content_type = await storage.download_garden_scene(garden.scene.model_url)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    logger.debug("Downloaded garden scene property_id=%s garden_id=%s", property_id, garden_id)
    return Response(content=data, media_type=content_type)


@router.delete(
    "/{property_id}/gardens/{garden_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_garden(
    property_id: str,
    garden_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    if not await tenancy.delete_garden(property_id, garden_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Garden not found")
    logger.info("Deleted garden property_id=%s garden_id=%s", property_id, garden_id)


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
@router.get("/{property_id}/members", response_model=list[Membership])
async def list_members(
    property_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    members = await tenancy.list_members(property_id)
    logger.debug("Listed members property_id=%s count=%s", property_id, len(members))
    return members


@router.post(
    "/{property_id}/members",
    response_model=Membership,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    property_id: str,
    payload: MemberInvite,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    existing = await tenancy.find_member_by_email(property_id, payload.email)
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That person is already a member of this property"
        )
    member = await tenancy.add_member(property_id, payload.email, payload.role)
    logger.info("Added member property_id=%s member_id=%s", property_id, member.id)
    return member


@router.patch("/{property_id}/members/{member_id}", response_model=Membership)
async def update_member_role(
    property_id: str,
    member_id: str,
    payload: MemberRoleUpdate,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    target = await tenancy.get_member(property_id, member_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    prop = await tenancy.get_property(property_id)
    if prop is not None and target.user_oid and target.user_oid == prop.owner_oid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The property owner's role cannot be changed"
        )
    updated = await tenancy.update_member_role(property_id, member_id, payload.role)
    logger.info("Updated member role property_id=%s member_id=%s role=%s", property_id, member_id, payload.role)
    return updated


@router.delete(
    "/{property_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_member(
    property_id: str,
    member_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    target = await tenancy.get_member(property_id, member_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    prop = await tenancy.get_property(property_id)
    if prop is not None and target.user_oid and target.user_oid == prop.owner_oid:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "The property owner cannot be removed"
        )
    await tenancy.remove_member(property_id, member_id)
    logger.info("Removed member property_id=%s member_id=%s", property_id, member_id)
