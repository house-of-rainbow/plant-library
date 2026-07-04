"""ASPCA pet-toxicity lookup.

Best-effort adapter over the public ASPCA "Toxic and Non-Toxic Plants" pages.
Given a scientific/common name it fetches the matching detail page, parses the
per-animal toxicity fields, and returns a conservative safety assessment.

Design (per the ingestion spec):
  * Per-animal results (dogs / cats / horses), never a single boolean.
  * "No ASPCA match" => UNKNOWN, never "safe".
  * Severity comes from the clinical signs (kidney/liver failure, death, …).

This is a best-effort live lookup with short timeouts; it enriches results but
never blocks identification. Results are cached in-process for the day.
"""
from __future__ import annotations

import logging
import re
from typing import Literal, Optional

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel

logger = logging.getLogger("plantlibrary.aspca")

_BASES = [
    "https://www.aspca.org/pet-care/animal-poison-control/toxic-and-non-toxic-plants",
    "https://www.aspca.org/pet-care/aspca-poison-control/toxic-and-non-toxic-plants",
]

_SEVERE_SIGNS = [
    "kidney failure",
    "renal failure",
    "liver failure",
    "liver damage",
    "hepatic",
    "death",
    "cardiac",
    "arrhythmia",
    "heart",
    "seizure",
    "collapse",
    "coma",
    "hemorrhage",
    "tremor",
]

_FIELD_LABELS = [
    "Additional Common Names",
    "Scientific Name",
    "Family",
    "Toxicity",
    "Non-Toxicity",
    "Toxic Principles",
    "Clinical Signs",
]

AnimalStatus = Literal["toxic", "non_toxic", "unknown"]
LabelLevel = Literal["safe", "caution", "toxic", "danger", "unknown"]

# Simple in-process cache: query -> result.
_cache: dict[str, "PetToxicity"] = {}


class PetToxicity(BaseModel):
    matched: bool = False
    source: str = "ASPCA"
    source_url: Optional[str] = None
    matched_scientific_name: Optional[str] = None
    matched_common_name: Optional[str] = None
    dogs: AnimalStatus = "unknown"
    cats: AnimalStatus = "unknown"
    horses: AnimalStatus = "unknown"
    toxic_principles: Optional[str] = None
    clinical_signs: Optional[str] = None
    severity: Literal["none", "mild", "severe", "unknown"] = "unknown"
    label_level: LabelLevel = "unknown"
    toxic_to_pets: Optional[bool] = None
    summary: str = ""


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def _slug_candidates(scientific_name: str, common_names: list[str]) -> list[str]:
    slugs: list[str] = []
    for name in [*common_names, scientific_name]:
        if not name:
            continue
        s = _slugify(name)
        if s and s not in slugs:
            slugs.append(s)
    return slugs[:3]


def _field(text: str, label: str) -> Optional[str]:
    others = [re.escape(o) for o in _FIELD_LABELS if o != label]
    pattern = (
        re.escape(label)
        + r"\s*:\s*(.*?)(?=(?:"
        + "|".join(others)
        + r")\s*:|$)"
    )
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    if not m:
        return None
    value = re.sub(r"\s+", " ", m.group(1)).strip(" .;,")
    return value or None


def _animal_status(animal: str, toxicity: str, non_toxicity: str) -> AnimalStatus:
    if re.search(rf"non-?toxic to {animal}", non_toxicity, re.IGNORECASE):
        return "non_toxic"
    if re.search(rf"toxic to {animal}", toxicity, re.IGNORECASE):
        return "toxic"
    return "unknown"


def _parse(html: str, url: str) -> Optional[PetToxicity]:
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1")
    title = h1.get_text(" ", strip=True) if h1 else None

    # Field values live in the main content; parse from normalized page text.
    text = soup.get_text("\n", strip=True)
    text = re.sub(r"[ \t]+", " ", text)

    scientific = _field(text, "Scientific Name")
    family = _field(text, "Family")
    toxicity = _field(text, "Toxicity") or ""
    non_toxicity = _field(text, "Non-Toxicity") or ""
    toxic_principles = _field(text, "Toxic Principles")
    clinical_signs = _field(text, "Clinical Signs")

    # Must look like an ASPCA plant detail page.
    if not scientific and not toxicity and not non_toxicity:
        return None

    dogs = _animal_status("dogs", toxicity, non_toxicity)
    cats = _animal_status("cats", toxicity, non_toxicity)
    horses = _animal_status("horses", toxicity, non_toxicity)

    result = PetToxicity(
        matched=True,
        source_url=url,
        matched_scientific_name=scientific,
        matched_common_name=title,
        dogs=dogs,
        cats=cats,
        horses=horses,
        toxic_principles=toxic_principles,
        clinical_signs=clinical_signs,
    )
    _decide(result)
    _ = family  # captured for potential future matching use
    return result


def _decide(r: PetToxicity) -> None:
    """Conservative per-animal → label decision (household-relevant: cats/dogs)."""
    household = [r.cats, r.dogs]
    signs = (r.clinical_signs or "").lower()
    severe = any(term in signs for term in _SEVERE_SIGNS)
    r.severity = "severe" if severe else ("mild" if "toxic" in household else "none")

    if "toxic" in household:
        r.toxic_to_pets = True
        r.label_level = "danger" if severe else "toxic"
        animals = [a for a, s in (("cats", r.cats), ("dogs", r.dogs)) if s == "toxic"]
        r.summary = (
            f"ASPCA-listed toxic to {', '.join(animals)}"
            + (" — severe risk." if severe else ".")
        )
    elif r.cats == "non_toxic" and r.dogs == "non_toxic":
        r.toxic_to_pets = False
        r.label_level = "safe"
        r.summary = "ASPCA-listed non-toxic to cats and dogs (do not encourage chewing)."
    else:
        r.toxic_to_pets = None
        r.label_level = "unknown"
        r.summary = "No confident ASPCA match — pet toxicity unknown."


def _verify(result: PetToxicity, scientific_name: str, common_names: list[str]) -> bool:
    """Guard against wrong-slug hits: require a loose taxonomic/name overlap."""
    q_genus = (scientific_name or "").strip().lower().split(" ")[0]
    src_sci = (result.matched_scientific_name or "").lower()
    if q_genus and q_genus in src_sci:
        return True
    src_common = (result.matched_common_name or "").lower()
    for cn in common_names:
        if cn and cn.strip().lower() in src_common:
            return True
    return False


async def lookup_pet_toxicity(
    scientific_name: str,
    common_names: Optional[list[str]] = None,
    *,
    timeout: float = 12.0,
) -> PetToxicity:
    """Look up ASPCA pet toxicity. Returns an UNKNOWN result on no match/error."""
    common_names = [c for c in (common_names or []) if c]
    cache_key = (scientific_name or "").lower()
    if cache_key in _cache:
        return _cache[cache_key]

    unknown = PetToxicity(
        matched=False,
        label_level="unknown",
        summary="No ASPCA match — pet toxicity unknown.",
    )

    slugs = _slug_candidates(scientific_name, common_names)
    if not slugs:
        return unknown

    headers = {"User-Agent": "BurienStationPlantLibrary/1.0 (+plant care app)"}
    try:
        async with httpx.AsyncClient(
            timeout=timeout, follow_redirects=True, headers=headers
        ) as client:
            for slug in slugs:
                for base in _BASES:
                    try:
                        resp = await client.get(f"{base}/{slug}")
                    except httpx.HTTPError:
                        continue
                    if resp.status_code != 200:
                        continue
                    parsed = _parse(resp.text, str(resp.url))
                    if parsed and _verify(parsed, scientific_name, common_names):
                        _cache[cache_key] = parsed
                        return parsed
    except Exception as exc:  # noqa: BLE001 - enrichment must never crash the flow
        logger.warning("ASPCA lookup failed for %s: %s", scientific_name, exc)

    _cache[cache_key] = unknown
    return unknown
