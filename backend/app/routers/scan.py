"""Scan endpoints for QR / NFC label resolution.

Labels encode a URI like ``<SCAN_BASE_URL>/plant_abcdef123`` which the mobile
frontend opens. This endpoint resolves that id to the enriched instance, and a
companion endpoint returns a printable QR code PNG for a given instance.
"""
from __future__ import annotations

import io

import qrcode
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings
from ..deps import authorize, class_repo, instance_repo, tenancy_repo
from ..models import PlantInstanceRead
from ..repositories import (
    PlantClassRepository,
    PlantInstanceRepository,
    TenancyRepository,
)
from .instances import _to_read

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.get("/{plant_id}", response_model=PlantInstanceRead)
async def resolve_scan(
    plant_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get_any(plant_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No plant matches that label")
    # Only members of the plant's property may resolve its label.
    await authorize(tenancy, instance.property_id, user)
    return await _to_read(instance, classes, settings)


@router.get("/{plant_id}/qr.png")
async def qr_code(
    plant_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    settings: Settings = Depends(get_settings),
    user: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get_any(plant_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No plant matches that label")
    await authorize(tenancy, instance.property_id, user)

    target = f"{settings.scan_base_url.rstrip('/')}/{plant_id}"
    img = qrcode.make(target)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
