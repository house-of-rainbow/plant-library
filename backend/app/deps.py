"""Shared FastAPI dependencies."""
from __future__ import annotations

from .db import Database, get_db
from .repositories import PlantClassRepository, PlantInstanceRepository


def class_repo() -> PlantClassRepository:
    return PlantClassRepository(get_db())


def instance_repo() -> PlantInstanceRepository:
    return PlantInstanceRepository(get_db())
