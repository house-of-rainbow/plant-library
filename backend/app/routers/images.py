"""Image upload endpoint (Azure Blob Storage / Azurite)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status

from ..auth import CurrentUser, get_current_user
from ..image_convert import normalize_image
from ..storage import BlobStorage, get_storage

router = APIRouter(prefix="/api/images", tags=["images"])
logger = logging.getLogger("plantlibrary.routers.images")

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_PREVIEWABLE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_image(
    file: UploadFile = File(...),
    storage: BlobStorage = Depends(get_storage),
    _: CurrentUser = Depends(get_current_user),
):
    data = await file.read()
    if len(data) > _MAX_BYTES:
        logger.warning("Rejected image upload larger than limit bytes=%s filename=%s", len(data), file.filename)
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
    data, content_type = normalize_image(data, file.content_type, file.filename)
    try:
        url = await storage.upload_image(data, content_type or "")
    except ValueError as exc:
        logger.warning("Rejected image upload filename=%s reason=%s", file.filename, exc)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RuntimeError as exc:
        logger.warning("Image upload failed because storage is unavailable filename=%s", file.filename)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    logger.info(
        "Uploaded image filename=%s bytes=%s content_type=%s",
        file.filename,
        len(data),
        content_type,
    )
    return {"url": url}


@router.post("/preview")
async def preview_image(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(get_current_user),
):
    """Transcode an upload to a browser-renderable image without storing it.

    Used for client-side thumbnails of formats browsers can't display natively
    (e.g. HEIC/HEIF from iPhones). Returns the converted image bytes directly.
    """
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
    data, content_type = normalize_image(data, file.content_type, file.filename)
    ct = (content_type or "").lower()
    if ct not in _PREVIEWABLE_CONTENT_TYPES:
        logger.warning(
            "Preview conversion unavailable filename=%s content_type=%s",
            file.filename,
            content_type,
        )
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Could not convert image for preview",
        )
    return Response(
        content=data,
        media_type=ct,
        headers={"Cache-Control": "no-store"},
    )
