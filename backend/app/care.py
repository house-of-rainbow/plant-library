"""Care-status computation: merges class defaults with instance overrides and
derives watering/fertilizing due dates and overdue flags.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone

from .models import (
    CareDefaults,
    CareStatus,
    PlantClass,
    PlantInstance,
)

logger = logging.getLogger("plantlibrary.care")


def _merge_field(instance_val, class_val):
    return instance_val if instance_val is not None else class_val


def effective_care(instance: PlantInstance, plant_class: PlantClass | None) -> CareDefaults:
    """Combine instance overrides on top of the owning class defaults.

    Every ``CareDefaults`` field is merged the same way: an instance value wins
    when set (not None), otherwise the class default is used.
    """
    defaults = plant_class.care_defaults if plant_class else CareDefaults()
    overrides = instance.care_overrides
    merged = {
        field: _merge_field(getattr(overrides, field), getattr(defaults, field))
        for field in CareDefaults.model_fields
    }
    logger.debug(
        "Merged care defaults for instance=%s class=%s",
        instance.id,
        plant_class.id if plant_class else None,
    )
    return CareDefaults(**merged)


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

    status = CareStatus(
        watering_next_due=watering_due,
        watering_overdue=watering_overdue,
        days_until_watering=days_until,
        fertilizing_next_due=fert_due,
        fertilizing_overdue=fert_overdue,
        effective_care=care,
    )
    logger.debug(
        "Computed care status for instance=%s watering_due=%s fertilizing_due=%s overdue=%s",
        instance.id,
        watering_due,
        fert_due,
        watering_overdue or fert_overdue,
    )
    return status
