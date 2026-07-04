"""Dashboard summary: care due/overdue aggregation for the Operations view."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import CurrentUser, get_current_user
from ..care import compute_care_status
from ..config import Settings, get_settings
from ..deps import class_repo, instance_repo
from ..models import PlantInstanceRead
from ..repositories import PlantClassRepository, PlantInstanceRepository
from .instances import _to_read

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(
    repo: PlantInstanceRepository = Depends(instance_repo),
    classes: PlantClassRepository = Depends(class_repo),
    settings: Settings = Depends(get_settings),
    _: CurrentUser = Depends(get_current_user),
):
    all_classes = await classes.list()
    class_map = {c.id: c for c in all_classes}
    instances = await repo.list()

    total = len(instances)
    watering_overdue: list[PlantInstanceRead] = []
    watering_due_soon: list[PlantInstanceRead] = []
    needs_attention: list[PlantInstanceRead] = []

    for inst in instances:
        pc = class_map.get(inst.class_id)
        cs = compute_care_status(inst, pc)
        read = await _to_read(inst, classes, settings)
        if cs.watering_overdue:
            watering_overdue.append(read)
        elif cs.days_until_watering is not None and cs.days_until_watering <= 2:
            watering_due_soon.append(read)
        if inst.health_status.value in {"struggling", "critical"}:
            needs_attention.append(read)

    return {
        "total_plants": total,
        "total_species": len(all_classes),
        "watering_overdue_count": len(watering_overdue),
        "watering_due_soon_count": len(watering_due_soon),
        "needs_attention_count": len(needs_attention),
        "watering_overdue": watering_overdue,
        "watering_due_soon": watering_due_soon,
        "needs_attention": needs_attention,
    }
