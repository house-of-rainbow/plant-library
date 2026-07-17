"""OpenAI vision fallback for plant identification.

Used when Pl@ntNet is unavailable or returns no match. Uses the OpenAI Responses
API with Structured Outputs so the model returns the plant schema (taxonomy +
care hints) with a confidence score, strongly typed.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Optional

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from .models import SunlightLevel
from .wikipedia import WikipediaArticle, WikipediaClient

logger = logging.getLogger("plantlibrary.identify.openai")

_PROMPT = (
    "You are an expert botanist and houseplant specialist. Identify the plant in "
    "the provided photo(s). Return up to 5 candidate species ordered by confidence "
    "(highest first). For each candidate provide the accepted scientific name "
    "(binomial, no author), a common name, family and genus, and a confidence "
    "between 0 and 1 reflecting how sure you are. Also provide typical prosumer "
    "care guidance (watering interval in days, sunlight level, fertilizing interval "
    "in days, fertilizer type, pet toxicity, and a short care note). If you cannot "
    "identify any plant, return an empty candidates list."
)


def _prompt_with_context(base_prompt: str, prompt_context: str | None) -> str:
    prompt_context = (prompt_context or "").strip()
    if not prompt_context:
        return base_prompt
    return (
        f"{base_prompt}\n\n"
        "Additional user-provided context about the plant. Treat this as a helpful clue, not a guaranteed fact; use it to break ties or guide harder identifications, but do not override clear visual evidence when the clue appears wrong.\n"
        f"User context: {prompt_context}"
    )


class LLMPlantCandidate(BaseModel):
    """The plant schema returned by the model, with a confidence score."""

    scientific_name: str = Field(description="Accepted binomial name without author")
    common_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    confidence: float = Field(description="Confidence 0..1", ge=0, le=1)
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


class LLMIdentification(BaseModel):
    candidates: list[LLMPlantCandidate]


class ConsolidatedCandidate(BaseModel):
    """A reconciled candidate produced by comparing both engines."""

    scientific_name: str
    common_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    confidence: float = Field(description="Consolidated confidence 0..1", ge=0, le=1)
    agreed_by_both: bool = Field(
        description="True when both Pl@ntNet and the vision model proposed this species"
    )
    note: Optional[str] = Field(
        default=None, description="Short reasoning about agreement/disagreement"
    )


class Consolidation(BaseModel):
    summary: str = Field(description="One-sentence summary of the consensus")
    candidates: list[ConsolidatedCandidate]


class EnrichedCandidate(BaseModel):
    scientific_name: str = Field(description="Accepted binomial name without author")
    common_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    confidence: float = Field(description="Confidence 0..1", ge=0, le=1)
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


class Enrichment(BaseModel):
    candidates: list[EnrichedCandidate]


_CONSOLIDATE_PROMPT = (
    "You are an expert botanist acting as a referee. Two independent plant "
    "identification engines analysed the SAME photo(s): 'Pl@ntNet' (a specialised "
    "plant-ID model) and an AI vision model. Their candidate lists are given below "
    "with confidence scores. Using the photos AND both lists, produce a single "
    "consolidated, de-duplicated ranking of the most likely species. Prefer species "
    "that BOTH engines agree on and raise their confidence; keep strong single-engine "
    "candidates but reflect the uncertainty. For each final candidate set "
    "'agreed_by_both' correctly, give a consolidated confidence 0..1, and a short note. "
    "Also give a one-sentence summary of the consensus."
)


_ENRICH_PROMPT = (
    "You are an expert botanist and horticulture editor finalizing species profiles "
    "for already-identified plant candidates. You will receive the final ranked "
    "candidate list, the plant photos, optional user-provided context, optional "
    "ASPCA pet-toxicity findings. When you need complete care or horticultural reference detail, "
    "use the Wikipedia article tool to fetch the full article text for a candidate. For each "
    "candidate, preserve the supplied identification unless the evidence clearly "
    "contradicts it, and produce a useful prosumer species profile: short description, "
    "watering interval in days, watering notes, sunlight level, light notes, "
    "fertilizing interval in days, fertilizer type, fertilizer notes, repotting "
    "interval in months, soil type or soil mix, pot size guidance, hardiness zone, "
    "mature size, pruning notes, propagation notes, pests notes, pet toxicity, and "
    "a short overall care note. Use the Wikipedia tool when helpful, but do not "
    "fabricate facts or URLs. If a field is uncertain, leave it null."
)


def _image_content(images: list[tuple[bytes, str]]) -> list[dict]:
    content: list[dict] = []
    for data, content_type in images:
        b64 = base64.b64encode(data).decode("ascii")
        content.append(
            {"type": "input_image", "image_url": f"data:{content_type};base64,{b64}"}
        )
    return content


async def identify_with_openai(
    images: list[tuple[bytes, str]],
    *,
    api_key: str,
    model: str,
    prompt_context: str | None = None,
) -> LLMIdentification:
    """Identify a plant from image bytes using the OpenAI Responses API.

    ``images`` is a list of ``(data, content_type)`` tuples.
    """
    client = AsyncOpenAI(api_key=api_key)

    content: list[dict] = [
        {"type": "input_text", "text": _prompt_with_context(_PROMPT, prompt_context)}
    ]
    for data, content_type in images:
        b64 = base64.b64encode(data).decode("ascii")
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:{content_type};base64,{b64}",
            }
        )

    response = await client.responses.parse(
        model=model,
        input=[{"role": "user", "content": content}],
        text_format=LLMIdentification,
    )

    parsed = response.output_parsed
    if parsed is None:
        return LLMIdentification(candidates=[])
    return parsed


async def consolidate_with_openai(
    images: list[tuple[bytes, str]],
    plantnet_summary: str,
    openai_summary: str,
    *,
    api_key: str,
    model: str,
    prompt_context: str | None = None,
) -> Consolidation:
    """Reconcile the two engines' candidate lists into a final ranking."""
    client = AsyncOpenAI(api_key=api_key)

    text = (
        f"{_prompt_with_context(_CONSOLIDATE_PROMPT, prompt_context)}\n\n"
        f"Pl@ntNet candidates: {plantnet_summary}\n"
        f"AI vision candidates: {openai_summary}\n"
    )
    content: list[dict] = [{"type": "input_text", "text": text}]
    content.extend(_image_content(images))

    response = await client.responses.parse(
        model=model,
        input=[{"role": "user", "content": content}],
        text_format=Consolidation,
    )
    parsed = response.output_parsed
    if parsed is None:
        return Consolidation(summary="", candidates=[])
    return parsed


async def enrich_candidates_with_openai(
    images: list[tuple[bytes, str]],
    candidate_summary: str,
    aspca_context: str | None,
    *,
    api_key: str,
    model: str,
    wikipedia_client: WikipediaClient,
    prompt_context: str | None = None,
) -> tuple[Enrichment, dict[str, WikipediaArticle]]:
    """Fill species-profile fields after identification and ASPCA enrichment."""
    client = AsyncOpenAI(api_key=api_key)

    text = (
        f"{_prompt_with_context(_ENRICH_PROMPT, prompt_context)}\n\n"
        f"Final candidate list: {candidate_summary}\n"
        f"Return valid JSON matching this schema: {json.dumps(Enrichment.model_json_schema())}\n"
    )
    if aspca_context:
        text += f"ASPCA findings: {aspca_context}\n"

    content: list[dict] = [{"type": "input_text", "text": text}]
    content.extend(_image_content(images))

    tools = [
        {
            "type": "function",
            "name": "get_wikipedia_article",
            "description": "Fetch the full text and URL of a Wikipedia article for a plant candidate when richer care or taxonomy context is needed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Scientific or common plant name to look up on Wikipedia.",
                    }
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        }
    ]

    fetched_references: dict[str, WikipediaArticle] = {}
    response = await client.responses.create(
        model=model,
        input=[{"role": "user", "content": content}],
        tools=tools,
    )

    for _ in range(6):
        tool_calls = [item for item in response.output if getattr(item, "type", None) == "function_call"]
        if not tool_calls:
            break

        tool_outputs: list[dict] = []
        for call in tool_calls:
            if getattr(call, "name", "") != "get_wikipedia_article":
                continue
            try:
                args = json.loads(call.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            query = str(args.get("query", "")).strip()
            article = await wikipedia_client.get_article(query)
            if article is not None:
                fetched_references[query.lower()] = article
                output = {
                    "found": True,
                    "title": article.title,
                    "url": article.url,
                    "text": article.text,
                }
            else:
                output = {"found": False, "query": query}
            tool_outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": call.call_id,
                    "output": json.dumps(output),
                }
            )

        response = await client.responses.create(
            model=model,
            previous_response_id=response.id,
            input=tool_outputs,
            tools=tools,
        )

    raw_text = getattr(response, "output_text", None) or ""
    if not raw_text.strip():
        return Enrichment(candidates=[]), fetched_references
    return Enrichment.model_validate_json(raw_text), fetched_references

