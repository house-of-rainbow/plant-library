"""Plant identification via the Pl@ntNet API.

Accepts up to 5 photos (e.g. taken with the phone camera), forwards them to
Pl@ntNet, and returns candidate species with a confidence score so the user can
quickly identify a plant and, if the species is missing, add it.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from ..auth import CurrentUser, get_current_user
from ..config import Settings, get_settings

logger = logging.getLogger("plantlibrary.identify")

router = APIRouter(prefix="/api/identify", tags=["identify"])

_MAX_IMAGES = 5
_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


class IdentifyCandidate(BaseModel):
    scientific_name: str
    scientific_name_without_author: Optional[str] = None
    common_name: Optional[str] = None
    common_names: list[str] = []
    genus: Optional[str] = None
    family: Optional[str] = None
    score: float  # confidence 0..1
    gbif_id: Optional[str] = None
    powo_id: Optional[str] = None
    image_url: Optional[str] = None


class IdentifyResponse(BaseModel):
    best_match: Optional[str] = None
    remaining_requests: Optional[int] = None
    candidates: list[IdentifyCandidate] = []


def _parse_results(payload: dict) -> IdentifyResponse:
    candidates: list[IdentifyCandidate] = []
    for item in payload.get("results", []):
        species = item.get("species", {}) or {}
        genus = (species.get("genus") or {}).get("scientificNameWithoutAuthor") or (
            species.get("genus") or {}
        ).get("scientificName")
        family = (species.get("family") or {}).get("scientificNameWithoutAuthor") or (
            species.get("family") or {}
        ).get("scientificName")
        common_names = species.get("commonNames") or []
        images = item.get("images") or []
        image_url = None
        if images:
            url = images[0].get("url") or {}
            image_url = url.get("m") or url.get("s") or url.get("o")

        candidates.append(
            IdentifyCandidate(
                scientific_name=species.get("scientificName")
                or species.get("scientificNameWithoutAuthor")
                or "Unknown",
                scientific_name_without_author=species.get("scientificNameWithoutAuthor"),
                common_name=common_names[0] if common_names else None,
                common_names=common_names,
                genus=genus,
                family=family,
                score=float(item.get("score", 0.0)),
                gbif_id=str((item.get("gbif") or {}).get("id"))
                if item.get("gbif")
                else None,
                powo_id=str((item.get("powo") or {}).get("id")) if item.get("powo") else None,
                image_url=image_url,
            )
        )

    return IdentifyResponse(
        best_match=payload.get("bestMatch"),
        remaining_requests=payload.get("remainingIdentificationRequests"),
        candidates=candidates,
    )


@router.post("", response_model=IdentifyResponse)
async def identify(
    images: list[UploadFile] = File(...),
    organs: list[str] | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    if not settings.plantnet_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Plant identification is not configured (missing PLANT_DOT_NET__API_KEY).",
        )
    if not 1 <= len(images) <= _MAX_IMAGES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Provide between 1 and {_MAX_IMAGES} images.",
        )

    files: list[tuple[str, tuple[str, bytes, str]]] = []
    for img in images:
        content_type = img.content_type or "image/jpeg"
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Unsupported image type: {content_type}",
            )
        data = await img.read()
        files.append(("images", (img.filename or "image.jpg", data, content_type)))

    # Organs must be omitted or match the number of images; default is "auto".
    form_data: list[tuple[str, str]] = []
    if organs:
        if len(organs) != len(images):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "The number of organs must match the number of images.",
            )
        form_data = [("organs", o) for o in organs]

    params = {
        "api-key": settings.plantnet_api_key,
        "nb-results": 5,
        "include-related-images": "true",
        "lang": "en",
    }
    url = f"{settings.plantnet_base_url.rstrip('/')}/v2/identify/all"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, params=params, files=files, data=form_data)
    except httpx.HTTPError as exc:
        logger.warning("Pl@ntNet request failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Identification service is unavailable."
        ) from exc

    if resp.status_code == 404:
        # No species matched — return an empty (but successful) result.
        return IdentifyResponse(candidates=[])
    if resp.status_code == 401:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Identification service rejected the API key."
        )
    if resp.status_code == 429:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Identification quota exceeded. Please try again later.",
        )
    if resp.status_code >= 400:
        logger.warning("Pl@ntNet error %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Identification service returned an error."
        )

    return _parse_results(resp.json())
