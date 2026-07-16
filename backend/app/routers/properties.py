"""Property / Garden / Member management — the multitenancy hierarchy root.

Property -> Garden -> Plant. The creator of a property is always its owner.
Owners manage plants, gardens, members and property settings; members manage
plants (and tags) only.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import CurrentUser, get_current_user
from ..deps import authorize, tenancy_repo
from ..models import (
    Garden,
    GardenCreate,
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

router = APIRouter(prefix="/api/properties", tags=["properties"])


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
    return [await _to_read(p, role, tenancy) for p, role in pairs]


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
    return await _to_read(updated, MemberRole.owner, tenancy)


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: str,
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user, require_owner=True)
    await tenancy.delete_property(property_id)


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
    return await tenancy.list_gardens(property_id)


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
    return await tenancy.create_garden(property_id, payload)


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
    return updated


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
    return await tenancy.list_members(property_id)


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
    return await tenancy.add_member(property_id, payload.email, payload.role)


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
