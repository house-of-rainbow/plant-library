"""Care-status computation: merges class defaults with instance overrides and
derives watering/fertilizing due dates and overdue flags.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .models import (
    CareDefaults,
    CareStatus,
    PlantClass,
    PlantInstance,
)


def _merge_field(instance_val, class_val):
    return instance_val if instance_val is not None else class_val


def effective_care(instance: PlantInstance, plant_class: PlantClass | None) -> CareDefaults:
    """Combine instance overrides on top of the owning class defaults."""
    defaults = plant_class.care_defaults if plant_class else CareDefaults()
    overrides = instance.care_overrides
    return CareDefaults(
        watering_interval_days=_merge_field(
            overrides.watering_interval_days, defaults.watering_interval_days
        ),
        sunlight=_merge_field(overrides.sunlight, defaults.sunlight),
        fertilizing_interval_days=_merge_field(
            overrides.fertilizing_interval_days, defaults.fertilizing_interval_days
        ),
        repotting_interval_months=_merge_field(
            overrides.repotting_interval_months, defaults.repotting_interval_months
        ),
        soil_type=_merge_field(overrides.soil_type, defaults.soil_type),
        pot_size=_merge_field(overrides.pot_size, defaults.pot_size),
        humidity=_merge_field(overrides.humidity, defaults.humidity),
        temperature=_merge_field(overrides.temperature, defaults.temperature),
        toxic_to_pets=_merge_field(overrides.toxic_to_pets, defaults.toxic_to_pets),
        care_notes=_merge_field(overrides.care_notes, defaults.care_notes),
    )


def _due(last: datetime | None, interval_days: int | None) -> tuple[date | None, bool, int | None]:
    if interval_days is None or interval_days <= 0 or last is None:
        return None, False, None
    next_due = (last + timedelta(days=interval_days)).date()
    today = datetime.now(timezone.utc).date()
    days_until = (next_due - today).days
    return next_due, days_until < 0, days_until


def compute_care_status(
    instance: PlantInstance, plant_class: PlantClass | None
) -> CareStatus:
    care = effective_care(instance, plant_class)

    watering_due, watering_overdue, days_until = _due(
        instance.last_watered_at, care.watering_interval_days
    )
    fert_due, fert_overdue, _ = _due(
        instance.last_fertilized_at, care.fertilizing_interval_days
    )

    return CareStatus(
        watering_next_due=watering_due,
        watering_overdue=watering_overdue,
        days_until_watering=days_until,
        fertilizing_next_due=fert_due,
        fertilizing_overdue=fert_overdue,
        effective_care=care,
    )
