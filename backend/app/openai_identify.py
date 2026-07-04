"""OpenAI vision fallback for plant identification.

Used when Pl@ntNet is unavailable or returns no match. Uses the OpenAI Responses
API with Structured Outputs so the model returns the plant schema (taxonomy +
care hints) with a confidence score, strongly typed.
"""
from __future__ import annotations

import base64
import logging
from typing import Optional

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from .models import SunlightLevel

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


class LLMPlantCandidate(BaseModel):
    """The plant schema returned by the model, with a confidence score."""

    scientific_name: str = Field(description="Accepted binomial name without author")
    common_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    confidence: float = Field(description="Confidence 0..1", ge=0, le=1)
    watering_interval_days: Optional[int] = None
    sunlight: Optional[SunlightLevel] = None
    fertilizing_interval_days: Optional[int] = None
    fertilizer_type: Optional[str] = None
    toxic_to_pets: Optional[bool] = None
    care_notes: Optional[str] = None


class LLMIdentification(BaseModel):
    candidates: list[LLMPlantCandidate]


async def identify_with_openai(
    images: list[tuple[bytes, str]],
    *,
    api_key: str,
    model: str,
) -> LLMIdentification:
    """Identify a plant from image bytes using the OpenAI Responses API.

    ``images`` is a list of ``(data, content_type)`` tuples.
    """
    client = AsyncOpenAI(api_key=api_key)

    content: list[dict] = [{"type": "input_text", "text": _PROMPT}]
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
