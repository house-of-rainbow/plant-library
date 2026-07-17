"""Shared FastAPI dependencies and tenancy authorization helpers."""
from __future__ import annotations

import logging

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

logger = logging.getLogger("plantlibrary.deps")


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
        logger.warning("Authorization failed: property not found property_id=%s user_oid=%s", property_id, user.oid)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Property not found")
    membership = await tenancy.get_membership(property_id, user.oid, user.email)
    if membership is None:
        logger.warning(
            "Authorization failed: membership missing property_id=%s user_oid=%s",
            property_id,
            user.oid,
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You do not have access to this property"
        )
    if require_owner and membership.role != MemberRole.owner:
        logger.warning(
            "Authorization failed: owner role required property_id=%s user_oid=%s role=%s",
            property_id,
            user.oid,
            membership.role,
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the property owner can perform this action"
        )
    logger.debug(
        "Authorization granted property_id=%s user_oid=%s role=%s owner_required=%s",
        property_id,
        user.oid,
        membership.role,
        require_owner,
    )
    return membership
