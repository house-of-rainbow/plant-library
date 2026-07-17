"""Shared FastAPI dependencies and tenancy authorization helpers."""
from __future__ import annotations

from fastapi import HTTPException, status

from .auth import CurrentUser
from .db import get_db
from .models import MemberRole, Membership
from .repositories import (
    PersonalAccessTokenRepository,
    PlantClassRepository,
    PlantInstanceRepository,
    TagRepository,
    TenancyRepository,
)


def class_repo() -> PlantClassRepository:
    return PlantClassRepository(get_db())


def instance_repo() -> PlantInstanceRepository:
    return PlantInstanceRepository(get_db())


def tenancy_repo() -> TenancyRepository:
    return TenancyRepository(get_db())


def tag_repo() -> TagRepository:
    return TagRepository(get_db())


def pat_repo() -> PersonalAccessTokenRepository:
    return PersonalAccessTokenRepository(get_db())


async def authorize(
    tenancy: TenancyRepository,
    property_id: str,
    user: CurrentUser,
    *,
    require_owner: bool = False,
) -> Membership:
    """Ensure the user can access ``property_id`` and return their membership.

    Raises 404 when the property does not exist, 403 when the user is not a
    member, and 403 when owner privileges are required but the user is only a
    member.
    """
    prop = await tenancy.get_property(property_id)
    if prop is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    membership = await tenancy.get_membership(property_id, user.oid, user.email)
    if membership is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You do not have access to this property"
        )
    if require_owner and membership.role != MemberRole.owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the property owner can perform this action"
        )
    return membership
