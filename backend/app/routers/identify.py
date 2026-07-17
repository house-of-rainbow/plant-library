"""Plant identification via the Pl@ntNet API.

Accepts up to 5 photos (e.g. taken with the phone camera), forwards them to
Pl@ntNet, and returns candidate species with a confidence score so the user can
quickly identify a plant and, if the species is missing, add it.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from ..auth import CurrentUser, get_current_user
from ..aspca import lookup_pet_toxicity
from ..config import Settings, get_settings
from ..models import SunlightLevel
from ..openai_identify import (
    consolidate_with_openai,
    enrich_candidates_with_openai,
    identify_with_openai,
)
from ..wikipedia import WikipediaClient, apply_reference_metadata

logger = logging.getLogger("plantlibrary.identify")

router = APIRouter(prefix="/api/identify", tags=["identify"])

_MAX_IMAGES = 5
_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_wikipedia = WikipediaClient()


class IdentifyCandidate(BaseModel):
    scientific_name: str
    scientific_name_without_author: Optional[str] = None
    common_name: Optional[str] = None
    common_names: list[str] = []
    genus: Optional[str] = None
    family: Optional[str] = None
    score: float  # confidence 0..1
    description: Optional[str] = None
    watering_interval_days: Optional[int] = None
    watering_notes: Optional[str] = None
    sunlight: Optional[SunlightLevel] = None
    light_notes: Optional[str] = None
    fertilizing_interval_days: Optional[int] = None
    fertilizer_type: Optional[str] = None
    fertilizer_notes: Optional[str] = None
    repotting_interval_months: Optional[int] = None
    soil_type: Optional[str] = None
    pot_size: Optional[str] = None
    hardiness_zone: Optional[str] = None
    mature_size: Optional[str] = None
    pruning_notes: Optional[str] = None
    propagation_notes: Optional[str] = None
    pests_notes: Optional[str] = None
    toxic_to_pets: Optional[bool] = None
    care_notes: Optional[str] = None
    reference_url: Optional[str] = None
    gbif_id: Optional[str] = None
    powo_id: Optional[str] = None
    image_url: Optional[str] = None
    agreed_by_both: Optional[bool] = None
    note: Optional[str] = None
    pet_toxicity: Optional[dict] = None


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
    prompt_context: str | None = None,
) -> Optional[IdentifyResponse]:
    """Fallback identification via the OpenAI Responses API (Structured Outputs)."""
    if not settings.openai_api_key:
        return None
    try:
        llm = await identify_with_openai(
            [(data, ct) for _, data, ct in raw],
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            prompt_context=prompt_context,
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
            description=c.description,
            watering_interval_days=c.watering_interval_days,
            watering_notes=c.watering_notes,
            sunlight=c.sunlight,
            light_notes=c.light_notes,
            fertilizing_interval_days=c.fertilizing_interval_days,
            fertilizer_type=c.fertilizer_type,
            fertilizer_notes=c.fertilizer_notes,
            repotting_interval_months=c.repotting_interval_months,
            soil_type=c.soil_type,
            pot_size=c.pot_size,
            hardiness_zone=c.hardiness_zone,
            mature_size=c.mature_size,
            pruning_notes=c.pruning_notes,
            propagation_notes=c.propagation_notes,
            pests_notes=c.pests_notes,
            toxic_to_pets=c.toxic_to_pets,
            care_notes=c.care_notes,
        )
        for c in llm.candidates
    ]
    return IdentifyResponse(source="openai", candidates=candidates)


@router.post("", response_model=IdentifyResponse)
async def identify(
    images: list[UploadFile] = File(...),
    organs: list[str] | None = Form(default=None),
    prompt_context: str | None = Form(default=None),
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
    fallback = await _try_openai(raw, settings, prompt_context=prompt_context)
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


async def _read_images(images: list[UploadFile]) -> list[tuple[str, bytes, str]]:
    if not 1 <= len(images) <= _MAX_IMAGES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Provide between 1 and {_MAX_IMAGES} images.",
        )
    raw: list[tuple[str, bytes, str]] = []
    for img in images:
        content_type = img.content_type or "image/jpeg"
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Unsupported image type: {content_type}"
            )
        data = await img.read()
        raw.append((img.filename or "image.jpg", data, content_type))
    return raw


def _fmt_candidates(cands: list[IdentifyCandidate]) -> str:
    if not cands:
        return "none"
    return "; ".join(
        f"{c.scientific_name} ({c.common_name or 'n/a'}) p={c.score:.2f}"
        for c in cands[:5]
    )


def _enrichment_summary(cands: list[IdentifyCandidate]) -> str:
    if not cands:
        return "none"
    return json.dumps(
        [
            {
                "scientific_name": c.scientific_name,
                "common_name": c.common_name,
                "family": c.family,
                "genus": c.genus,
                "confidence": c.score,
                "agreed_by_both": c.agreed_by_both,
                "note": c.note,
            }
            for c in cands[:5]
        ]
    )


def _apply_enrichment(
    candidates: list[IdentifyCandidate],
    enriched: list,
) -> None:
    by_name = {
        (c.scientific_name_without_author or c.scientific_name or "").lower(): c
        for c in candidates
    }
    for item in enriched:
        key = (item.scientific_name or "").lower()
        target = by_name.get(key)
        if target is None:
            continue
        target.common_name = item.common_name or target.common_name
        target.family = item.family or target.family
        target.genus = item.genus or target.genus
        target.score = max(0.0, min(1.0, item.confidence))
        target.description = item.description or target.description
        target.watering_interval_days = item.watering_interval_days
        target.watering_notes = item.watering_notes
        target.sunlight = item.sunlight
        target.light_notes = item.light_notes
        target.fertilizing_interval_days = item.fertilizing_interval_days
        target.fertilizer_type = item.fertilizer_type
        target.fertilizer_notes = item.fertilizer_notes
        target.repotting_interval_months = item.repotting_interval_months
        target.soil_type = item.soil_type
        target.pot_size = item.pot_size
        target.hardiness_zone = item.hardiness_zone
        target.mature_size = item.mature_size
        target.pruning_notes = item.pruning_notes
        target.propagation_notes = item.propagation_notes
        target.pests_notes = item.pests_notes
        target.toxic_to_pets = item.toxic_to_pets
        target.care_notes = item.care_notes


def _candidate_lookup_names(candidate: IdentifyCandidate) -> list[str]:
    return list(candidate.common_names) or ([candidate.common_name] if candidate.common_name else [])


@router.post("/stream")
async def identify_stream(
    images: list[UploadFile] = File(...),
    prompt_context: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    """Ensemble identification with live progress (newline-delimited JSON).

    Runs Pl@ntNet and the GPT vision model concurrently, then asks GPT to
    consolidate both result sets. Emits one JSON object per line per step so the
    UI can show progress.
    """
    raw = await _read_images(images)
    has_pn = bool(settings.plantnet_api_key)
    has_ai = bool(settings.openai_api_key)
    if not has_pn and not has_ai:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Plant identification is not configured."
        )

    async def gen():
        def line(obj: dict) -> str:
            return json.dumps(obj) + "\n"

        yield line({"step": "start", "engines": {"plantnet": has_pn, "openai": has_ai}})

        pn_task = asyncio.create_task(_try_plantnet(raw, None, settings)) if has_pn else None
        ai_task = (
            asyncio.create_task(
                _try_openai(raw, settings, prompt_context=prompt_context)
            )
            if has_ai
            else None
        )

        yield line({"step": "plantnet", "status": "running" if has_pn else "skipped"})
        yield line({"step": "openai", "status": "running" if has_ai else "skipped"})

        pn_cands: list[IdentifyCandidate] = []
        if pn_task is not None:
            try:
                pn_result, pn_failed = await pn_task
            except Exception as exc:  # noqa: BLE001
                logger.warning("Pl@ntNet task error: %s", exc)
                pn_result, pn_failed = None, True
            pn_cands = pn_result.candidates if pn_result else []
            yield line(
                {
                    "step": "plantnet",
                    "status": "error" if pn_failed else "done",
                    "count": len(pn_cands),
                    "candidates": [c.model_dump() for c in pn_cands],
                }
            )

        ai_cands: list[IdentifyCandidate] = []
        if ai_task is not None:
            try:
                ai_result = await ai_task
            except Exception as exc:  # noqa: BLE001
                logger.warning("OpenAI task error: %s", exc)
                ai_result = None
            ai_cands = ai_result.candidates if ai_result else []
            yield line(
                {
                    "step": "openai",
                    "status": "error" if ai_result is None else "done",
                    "count": len(ai_cands),
                    "candidates": [c.model_dump() for c in ai_cands],
                }
            )

        final: list[IdentifyCandidate] = []
        summary: Optional[str] = None
        did_consolidate = False

        if has_ai and (pn_cands or ai_cands):
            yield line({"step": "consolidate", "status": "running"})
            try:
                cons = await consolidate_with_openai(
                    [(data, ct) for _, data, ct in raw],
                    _fmt_candidates(pn_cands),
                    _fmt_candidates(ai_cands),
                    api_key=settings.openai_api_key,
                    model=settings.openai_model,
                    prompt_context=prompt_context,
                )
                pn_by_name = {
                    (c.scientific_name_without_author or c.scientific_name or "").lower(): c
                    for c in pn_cands
                }
                for cc in cons.candidates:
                    match = pn_by_name.get((cc.scientific_name or "").lower())
                    final.append(
                        IdentifyCandidate(
                            scientific_name=cc.scientific_name,
                            scientific_name_without_author=cc.scientific_name,
                            common_name=cc.common_name,
                            common_names=[cc.common_name] if cc.common_name else [],
                            genus=cc.genus,
                            family=cc.family,
                            score=max(0.0, min(1.0, cc.confidence)),
                            image_url=match.image_url if match else None,
                            gbif_id=match.gbif_id if match else None,
                            powo_id=match.powo_id if match else None,
                            agreed_by_both=cc.agreed_by_both,
                            note=cc.note,
                        )
                    )
                summary = cons.summary
                did_consolidate = True
                yield line({"step": "consolidate", "status": "done"})
            except Exception as exc:  # noqa: BLE001
                logger.warning("Consolidation failed: %s", exc)
                yield line({"step": "consolidate", "status": "error"})
        else:
            yield line({"step": "consolidate", "status": "skipped"})

        if not final:
            # No consolidation → merge both lists, de-duplicated by binomial.
            seen: set[str] = set()
            for c in pn_cands + ai_cands:
                key = (c.scientific_name_without_author or c.scientific_name or "").lower()
                if key in seen:
                    continue
                seen.add(key)
                final.append(c)

        # Pet-toxicity lookup (ASPCA) for the top candidate.
        if final and settings.aspca_enabled:
            yield line({"step": "toxicity", "status": "running"})
            try:
                top = final[0]
                tox = await lookup_pet_toxicity(
                    top.scientific_name_without_author or top.scientific_name,
                    _candidate_lookup_names(top),
                )
                top.pet_toxicity = tox.model_dump()
                yield line(
                    {
                        "step": "toxicity",
                        "status": "done",
                        "label_level": tox.label_level,
                        "matched": tox.matched,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Toxicity lookup failed: %s", exc)
                yield line({"step": "toxicity", "status": "error"})
        else:
            yield line({"step": "toxicity", "status": "skipped"})

        yield line(
            {
                "step": "complete",
                "source": "consolidated" if did_consolidate else "merged",
                "summary": summary,
                "candidates": [c.model_dump() for c in final],
            }
        )

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/enrich-selected/stream")
async def enrich_selected_stream(
    images: list[UploadFile] = File(...),
    candidate_json: str = Form(...),
    prompt_context: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    raw = await _read_images(images)
    try:
        candidate = IdentifyCandidate.model_validate_json(candidate_json)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Invalid candidate payload.",
        ) from exc

    async def gen():
        def line(obj: dict) -> str:
            return json.dumps(obj) + "\n"

        selected = candidate.model_copy(deep=True)
        yield line({"step": "start", "mode": "enrich-selected"})

        if settings.aspca_enabled:
            yield line({"step": "toxicity", "status": "running"})
            try:
                tox = await lookup_pet_toxicity(
                    selected.scientific_name_without_author or selected.scientific_name,
                    _candidate_lookup_names(selected),
                )
                selected.pet_toxicity = tox.model_dump()
                yield line(
                    {
                        "step": "toxicity",
                        "status": "done",
                        "label_level": tox.label_level,
                        "matched": tox.matched,
                    }
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Toxicity lookup failed for selected candidate: %s", exc)
                yield line({"step": "toxicity", "status": "error"})
        else:
            yield line({"step": "toxicity", "status": "skipped"})

        if not settings.openai_api_key:
            yield line({"step": "articles", "status": "skipped"})
            yield line({"step": "enrich", "status": "skipped"})
            yield line({"step": "complete", "candidate": selected.model_dump()})
            return

        yield line({"step": "enrich", "status": "running"})

        article_events: asyncio.Queue[dict] = asyncio.Queue()
        article_count = 0

        async def on_tool_event(event: dict) -> None:
            await article_events.put(event)

        aspca_context = (
            json.dumps(selected.pet_toxicity)
            if selected.pet_toxicity is not None
            else None
        )

        enrich_task = asyncio.create_task(
            enrich_candidates_with_openai(
                [(data, ct) for _, data, ct in raw],
                _enrichment_summary([selected]),
                aspca_context,
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                wikipedia_client=_wikipedia,
                prompt_context=prompt_context,
                on_tool_event=on_tool_event,
            )
        )
        article_task = asyncio.create_task(article_events.get())
        article_error: Exception | None = None

        while not enrich_task.done():
            done, _ = await asyncio.wait(
                {enrich_task, article_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            if article_task in done:
                event = article_task.result()
                article_count = max(article_count, int(event.get("count", article_count or 0)))
                query = str(event.get("query", "")).strip()
                detail = f"Looking up {query}" if query else "Looking up article"
                yield line(
                    {
                        "step": "articles",
                        "status": "running",
                        "count": article_count,
                        "detail": detail,
                    }
                )
                article_task = asyncio.create_task(article_events.get())

        if not article_task.done():
            article_task.cancel()

        while not article_events.empty():
            event = await article_events.get()
            article_count = max(article_count, int(event.get("count", article_count or 0)))
            query = str(event.get("query", "")).strip()
            detail = f"Looking up {query}" if query else "Looking up article"
            yield line(
                {
                    "step": "articles",
                    "status": "running",
                    "count": article_count,
                    "detail": detail,
                }
            )

        try:
            enriched, references = await enrich_task
            _apply_enrichment([selected], enriched.candidates)
            apply_reference_metadata([selected], references)
        except Exception as exc:  # noqa: BLE001
            article_error = exc

        if article_count:
            yield line(
                {
                    "step": "articles",
                    "status": "done" if article_error is None else "error",
                    "count": article_count,
                    "detail": f"Checked {article_count} article{'s' if article_count != 1 else ''}",
                }
            )
        else:
            yield line({"step": "articles", "status": "skipped", "detail": "No article lookup needed"})

        if article_error is not None:
            logger.warning("Selected-candidate enrichment failed: %s", article_error)
            yield line(
                {
                    "step": "enrich",
                    "status": "error",
                    "detail": "Using the identification result",
                }
            )
            yield line({"step": "complete", "candidate": selected.model_dump()})
            return

        yield line({"step": "enrich", "status": "done"})
        yield line({"step": "complete", "candidate": selected.model_dump()})

    return StreamingResponse(
        gen(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


