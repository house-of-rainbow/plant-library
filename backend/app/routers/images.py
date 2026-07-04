"""Image upload endpoint (Azure Blob Storage / Azurite)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from ..auth import CurrentUser, get_current_user
from ..storage import BlobStorage, get_storage

router = APIRouter(prefix="/api/images", tags=["images"])

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_image(
    file: UploadFile = File(...),
    storage: BlobStorage = Depends(get_storage),
    _: CurrentUser = Depends(get_current_user),
):
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
    try:
        url = await storage.upload_image(data, file.content_type or "")
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return {"url": url}
