"""Pydantic models for the Plant Library domain.

Design:
  * ``PlantClass``   -> a species/taxon (e.g. "Monstera Deliciosa") that holds
                        default care requirements shared by every specimen.
  * ``PlantInstance``-> an individual plant you own. It references a class and
                        inherits the class care defaults, but may override any
                        of them and keeps its own event/care log.
"""
from __future__ import annotations

import secrets
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class SunlightLevel(str, Enum):
    low = "low"
    medium = "medium"
    bright_indirect = "bright_indirect"
    direct = "direct"


class HealthStatus(str, Enum):
    thriving = "thriving"
    healthy = "healthy"
    struggling = "struggling"
    critical = "critical"
    dormant = "dormant"
    deceased = "deceased"


class EventType(str, Enum):
    watered = "watered"
    fertilized = "fertilized"
    repotted = "repotted"
    pruned = "pruned"
    pest_treatment = "pest_treatment"
    note = "note"
    health_change = "health_change"
    moved = "moved"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_plant_id() -> str:
    """Stable short id used in QR / NFC scan URIs, e.g. ``plant_ab12cd34ef``."""
    return f"plant_{secrets.token_hex(6)}"


def new_class_id() -> str:
    return f"class_{secrets.token_hex(6)}"


# --------------------------------------------------------------------------- #
# Shared care sub-models
# --------------------------------------------------------------------------- #
class TemperatureRange(BaseModel):
    min_c: Optional[float] = None
    max_c: Optional[float] = None


class HumidityRange(BaseModel):
    min_pct: Optional[int] = Field(default=None, ge=0, le=100)
    max_pct: Optional[int] = Field(default=None, ge=0, le=100)


class CareDefaults(BaseModel):
    """Care requirements. Used as defaults on a class and as overrides on an
    instance (every field optional so an instance overrides only what it needs).
    """

    watering_interval_days: Optional[int] = Field(default=None, ge=0)
    watering_notes: Optional[str] = None
    sunlight: Optional[SunlightLevel] = None
    light_notes: Optional[str] = None
    fertilizing_interval_days: Optional[int] = Field(default=None, ge=0)
    fertilizer_type: Optional[str] = None
    fertilizer_notes: Optional[str] = None
    repotting_interval_months: Optional[int] = Field(default=None, ge=0)
    soil_type: Optional[str] = None
    pot_size: Optional[str] = None
    humidity: Optional[HumidityRange] = None
    temperature: Optional[TemperatureRange] = None
    hardiness_zone: Optional[str] = None
    mature_size: Optional[str] = None
    pruning_notes: Optional[str] = None
    propagation_notes: Optional[str] = None
    pests_notes: Optional[str] = None
    toxic_to_pets: Optional[bool] = None
    care_notes: Optional[str] = None


# --------------------------------------------------------------------------- #
# Plant Class (species / taxon)
# --------------------------------------------------------------------------- #
class PlantClassBase(BaseModel):
    common_name: str = Field(..., min_length=1, max_length=200)
    scientific_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    care_defaults: CareDefaults = Field(default_factory=CareDefaults)
    hero_image_url: Optional[str] = None


class PlantClassCreate(PlantClassBase):
    pass


class PlantClassUpdate(BaseModel):
    common_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    scientific_name: Optional[str] = None
    family: Optional[str] = None
    genus: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    care_defaults: Optional[CareDefaults] = None
    hero_image_url: Optional[str] = None


class PlantClass(PlantClassBase):
    id: str = Field(default_factory=new_class_id)
    # Partition key for the classes container.
    pk: str = "class"
    doc_type: str = "plant_class"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Care / event log
# --------------------------------------------------------------------------- #
class CareEventCreate(BaseModel):
    type: EventType
    occurred_at: Optional[datetime] = None
    notes: Optional[str] = None
    # For pest treatments
    treatment: Optional[str] = None
    # For health_change events
    new_health_status: Optional[HealthStatus] = None


class CareEvent(CareEventCreate):
    id: str = Field(default_factory=lambda: f"evt_{secrets.token_hex(6)}")
    occurred_at: datetime = Field(default_factory=_now)
    created_at: datetime = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Plant Instance (an individual owned plant)
# --------------------------------------------------------------------------- #
class PlantInstanceBase(BaseModel):
    class_id: str = Field(..., description="Owning PlantClass id")
    nickname: Optional[str] = None
    location: Optional[str] = Field(default=None, description="Room / area")
    acquisition_date: Optional[date] = None
    pot_size: Optional[str] = None
    soil_type: Optional[str] = None
    health_status: HealthStatus = HealthStatus.healthy
    # Instance-level overrides of the class care defaults.
    care_overrides: CareDefaults = Field(default_factory=CareDefaults)
    image_urls: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


class PlantInstanceCreate(PlantInstanceBase):
    pass


class PlantInstanceUpdate(BaseModel):
    class_id: Optional[str] = None
    nickname: Optional[str] = None
    location: Optional[str] = None
    acquisition_date: Optional[date] = None
    pot_size: Optional[str] = None
    soil_type: Optional[str] = None
    health_status: Optional[HealthStatus] = None
    care_overrides: Optional[CareDefaults] = None
    image_urls: Optional[list[str]] = None
    notes: Optional[str] = None


class PlantInstance(PlantInstanceBase):
    id: str = Field(default_factory=new_plant_id)
    # Partition key: instances are partitioned by their owning class for
    # efficient "all specimens of this species" queries.
    pk: str = ""
    doc_type: str = "plant_instance"
    last_watered_at: Optional[datetime] = None
    last_fertilized_at: Optional[datetime] = None
    last_repotted_at: Optional[datetime] = None
    events: list[CareEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# --------------------------------------------------------------------------- #
# Response models enriched with computed care state
# --------------------------------------------------------------------------- #
class CareStatus(BaseModel):
    watering_next_due: Optional[date] = None
    watering_overdue: bool = False
    days_until_watering: Optional[int] = None
    fertilizing_next_due: Optional[date] = None
    fertilizing_overdue: bool = False
    effective_care: CareDefaults = Field(default_factory=CareDefaults)


class PlantInstanceRead(PlantInstance):
    care_status: CareStatus = Field(default_factory=CareStatus)
    scan_url: Optional[str] = None
    plant_class: Optional[PlantClass] = None
