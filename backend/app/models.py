"""Pydantic models for the Plant Library domain.

Design:
  * ``PlantClass``   -> a species/taxon (e.g. "Monstera Deliciosa") that holds
                        default care requirements shared by every specimen.
  * ``PlantInstance``-> an individual plant you own. It references a class and
                        inherits the class care defaults, but may override any
                        of them and keeps its own event/care log.
"""
from __future__ import annotations

import logging
import secrets
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field

logger = logging.getLogger("plantlibrary.models")


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


class MemberRole(str, Enum):
    owner = "owner"
    member = "member"


class TagScope(str, Enum):
    """Grouping scope for a tag.

    A ``None`` scope means an independent (ad-hoc) tag that is not bound to any
    level of the hierarchy. ``property`` spans an entire property; ``garden``
    is bound to a single garden.
    """

    property = "property"
    garden = "garden"


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


def new_property_id() -> str:
    return f"prop_{secrets.token_hex(6)}"


def new_garden_id() -> str:
    return f"garden_{secrets.token_hex(6)}"


def new_membership_id() -> str:
    return f"mem_{secrets.token_hex(6)}"


def new_tag_id() -> str:
    return f"tag_{secrets.token_hex(6)}"


def new_personal_access_token_id() -> str:
    return f"pat_{secrets.token_hex(8)}"


def _norm_email(email: str) -> str:
    normalized = email.strip().lower()
    if normalized != email:
        logger.debug("Normalized email input")
    return normalized


# --------------------------------------------------------------------------- #
# Shared care sub-models
# --------------------------------------------------------------------------- #
class TemperatureRange(BaseModel):
    min_c: Optional[float] = None
    max_c: Optional[float] = None


class HumidityRange(BaseModel):
    min_pct: Optional[int] = Field(default=None, ge=0, le=100)
    max_pct: Optional[int] = Field(default=None, ge=0, le=100)


class Position3D(BaseModel):
    x: float
    y: float
    z: float


class GardenScene(BaseModel):
    model_url: str
    model_filename: Optional[str] = None
    source: str = "polycam"


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
    reference_urls: list[str] = Field(default_factory=list)
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
    reference_urls: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    care_defaults: Optional[CareDefaults] = None
    hero_image_url: Optional[str] = None


class PlantClass(PlantClassBase):
    id: str = Field(default_factory=new_class_id)
    # Partition key: species are scoped to (owned by) a single property.
    property_id: str = ""
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
    garden_id: str = Field(..., description="Owning Garden id")
    nickname: Optional[str] = None
    location: Optional[str] = Field(default=None, description="Room / area")
    position_3d: Optional[Position3D] = None
    acquisition_date: Optional[date] = None
    pot_size: Optional[str] = None
    soil_type: Optional[str] = None
    health_status: HealthStatus = HealthStatus.healthy
    # Instance-level overrides of the class care defaults.
    care_overrides: CareDefaults = Field(default_factory=CareDefaults)
    image_urls: list[str] = Field(default_factory=list)
    tag_ids: list[str] = Field(default_factory=list)
    notes: Optional[str] = None


class PlantInstanceCreate(PlantInstanceBase):
    pass


class PlantInstanceUpdate(BaseModel):
    class_id: Optional[str] = None
    garden_id: Optional[str] = None
    nickname: Optional[str] = None
    location: Optional[str] = None
    position_3d: Optional[Position3D] = None
    acquisition_date: Optional[date] = None
    pot_size: Optional[str] = None
    soil_type: Optional[str] = None
    health_status: Optional[HealthStatus] = None
    care_overrides: Optional[CareDefaults] = None
    image_urls: Optional[list[str]] = None
    tag_ids: Optional[list[str]] = None
    notes: Optional[str] = None


class PlantInstance(PlantInstanceBase):
    id: str = Field(default_factory=new_plant_id)
    # Partition key: instances are scoped to (owned by) a single property.
    property_id: str = ""
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


# --------------------------------------------------------------------------- #
# Multitenancy: Property -> Garden -> Plant, plus Memberships and Tags.
# All tenancy documents live in a single container partitioned by
# ``property_id`` so a whole tenant is one logical partition.
# --------------------------------------------------------------------------- #
class GardenBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    scene: Optional[GardenScene] = None


class GardenCreate(GardenBase):
    is_home: bool = False


class GardenUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    scene: Optional[GardenScene] = None


class Garden(GardenBase):
    id: str = Field(default_factory=new_garden_id)
    property_id: str = ""
    doc_type: str = "garden"
    is_home: bool = False
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class PropertyBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    address: Optional[str] = None


class PropertyCreate(PropertyBase):
    # Optional home garden created together with the very first property.
    home_garden_name: Optional[str] = Field(default=None, max_length=120)


class PropertyUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    address: Optional[str] = None


class Property(PropertyBase):
    id: str = Field(default_factory=new_property_id)
    # For a property document, the partition key equals its own id.
    property_id: str = ""
    doc_type: str = "property"
    owner_oid: str = ""
    owner_email: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class Membership(BaseModel):
    id: str = Field(default_factory=new_membership_id)
    property_id: str = ""
    doc_type: str = "membership"
    # oid is unknown until the invited user logs in for the first time; the
    # membership is claimed by matching the (lower-cased) email.
    user_oid: Optional[str] = None
    user_email: str = ""
    user_name: Optional[str] = None
    role: MemberRole = MemberRole.member
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class MemberInvite(BaseModel):
    email: EmailStr
    role: MemberRole = MemberRole.member


class MemberRoleUpdate(BaseModel):
    role: MemberRole


class PersonalAccessTokenCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)


class PersonalAccessToken(BaseModel):
    id: str = Field(default_factory=new_personal_access_token_id)
    doc_type: str = "personal_access_token"
    user_oid: str
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    name: Optional[str] = None
    token_hash: str
    last_four: str
    expires_at: datetime
    last_used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class PersonalAccessTokenRead(BaseModel):
    id: str
    name: Optional[str] = None
    last_four: str
    expires_at: datetime
    last_used_at: Optional[datetime] = None
    created_at: datetime


class PersonalAccessTokenCreated(PersonalAccessTokenRead):
    token: str


class TagBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    color: Optional[str] = None
    scope: Optional[TagScope] = None
    # Required when scope == garden.
    garden_id: Optional[str] = None


class TagCreate(TagBase):
    pass


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    color: Optional[str] = None
    scope: Optional[TagScope] = None
    garden_id: Optional[str] = None


class Tag(TagBase):
    id: str = Field(default_factory=new_tag_id)
    property_id: str = ""
    doc_type: str = "tag"
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class TagAction(BaseModel):
    """A bulk care action applied to every plant carrying a tag."""

    type: EventType
    notes: Optional[str] = None
    treatment: Optional[str] = None
    new_health_status: Optional[HealthStatus] = None


class TagBulkInstances(BaseModel):
    instance_ids: list[str] = Field(default_factory=list)


# Enriched read models returned to the client.
class PropertyRead(Property):
    role: MemberRole = MemberRole.member
    gardens: list[Garden] = Field(default_factory=list)
    member_count: int = 0
