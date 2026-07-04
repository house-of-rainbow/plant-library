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
from ..deps import class_repo, instance_repo
from ..models import PlantInstanceRead
from ..repositories import PlantClassRepository, PlantInstanceRepository
from .instances import _to_read

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.get("/{plant_id}", response_model=PlantInstanceRead)
async def resolve_scan(
    plant_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get(plant_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No plant matches that label")
    return await _to_read(instance, classes, settings)


@router.get("/{plant_id}/qr.png")
async def qr_code(
    plant_id: str,
    repo: PlantInstanceRepository = Depends(instance_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    instance = await repo.get(plant_id)
    if instance is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No plant matches that label")

    target = f"{settings.scan_base_url.rstrip('/')}/{plant_id}"
    img = qrcode.make(target)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
