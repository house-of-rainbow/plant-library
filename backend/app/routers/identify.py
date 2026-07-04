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
from ..openai_identify import identify_with_openai

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
    source: Optional[str] = None  # "plantnet" | "openai"
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
        source="plantnet",
        candidates=candidates,
    )


async def _try_plantnet(
    raw: list[tuple[str, bytes, str]],
    organs: list[str] | None,
    settings: Settings,
) -> tuple[Optional[IdentifyResponse], bool]:
    """Attempt Pl@ntNet identification.

    Returns ``(result, failed)``: ``result`` is the parsed response (possibly
    with zero candidates) when Pl@ntNet responded; ``failed`` is True when the
    service was unavailable/errored so the caller should fall back.
    """
    if not settings.plantnet_api_key:
        return None, True

    files = [("images", (fn, data, ct)) for fn, data, ct in raw]
    # `data` must be a mapping (dict). httpx treats a list/None-mixed value as raw
    # content, which breaks multipart uploads on an AsyncClient. Repeated multipart
    # fields are expressed as a dict with a list value: {"organs": [...]}.
    form_data = {"organs": organs} if organs else None
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
        return None, True

    if resp.status_code == 200:
        return _parse_results(resp.json()), False
    if resp.status_code == 404:
        # Responded, but no species matched.
        return IdentifyResponse(candidates=[], source="plantnet"), False

    logger.warning("Pl@ntNet error %s: %s", resp.status_code, resp.text[:300])
    return None, True


async def _try_openai(
    raw: list[tuple[str, bytes, str]],
    settings: Settings,
) -> Optional[IdentifyResponse]:
    """Fallback identification via the OpenAI Responses API (Structured Outputs)."""
    if not settings.openai_api_key:
        return None
    try:
        llm = await identify_with_openai(
            [(data, ct) for _, data, ct in raw],
            api_key=settings.openai_api_key,
            model=settings.openai_model,
        )
    except Exception as exc:  # noqa: BLE001 - never let the fallback crash the request
        logger.warning("OpenAI identify failed: %s", exc)
        return None

    candidates = [
        IdentifyCandidate(
            scientific_name=c.scientific_name,
            scientific_name_without_author=c.scientific_name,
            common_name=c.common_name,
            common_names=[c.common_name] if c.common_name else [],
            genus=c.genus,
            family=c.family,
            score=max(0.0, min(1.0, c.confidence)),
        )
        for c in llm.candidates
    ]
    return IdentifyResponse(source="openai", candidates=candidates)


@router.post("", response_model=IdentifyResponse)
async def identify(
    images: list[UploadFile] = File(...),
    organs: list[str] | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    if not settings.plantnet_api_key and not settings.openai_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Plant identification is not configured.",
        )
    if not 1 <= len(images) <= _MAX_IMAGES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Provide between 1 and {_MAX_IMAGES} images.",
        )
    if organs and len(organs) != len(images):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The number of organs must match the number of images.",
        )

    raw: list[tuple[str, bytes, str]] = []
    for img in images:
        content_type = img.content_type or "image/jpeg"
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Unsupported image type: {content_type}",
            )
        data = await img.read()
        raw.append((img.filename or "image.jpg", data, content_type))

    # Primary: Pl@ntNet.
    result, failed = await _try_plantnet(raw, organs, settings)
    if result and result.candidates:
        return result

    # Fallback: OpenAI vision, when Pl@ntNet failed OR returned no candidates.
    fallback = await _try_openai(raw, settings)
    if fallback is not None and (failed or not result or not result.candidates):
        # Prefer the fallback when it produced something, else keep whatever we have.
        if fallback.candidates or result is None:
            return fallback

    if result is not None:
        return result  # Pl@ntNet responded (possibly empty)
    if fallback is not None:
        return fallback  # empty fallback
    raise HTTPException(
        status.HTTP_502_BAD_GATEWAY, "Identification services are unavailable."
    )

