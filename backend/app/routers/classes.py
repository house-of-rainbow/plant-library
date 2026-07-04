"""Plant class (species/taxon) CRUD endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import CurrentUser, get_current_user
from ..deps import class_repo
from ..models import PlantClass, PlantClassCreate, PlantClassUpdate
from ..repositories import PlantClassRepository

router = APIRouter(prefix="/api/classes", tags=["classes"])


@router.get("", response_model=list[PlantClass])
async def list_classes(
    repo: PlantClassRepository = Depends(class_repo),
    _: CurrentUser = Depends(get_current_user),
):
    return await repo.list()


@router.post("", response_model=PlantClass, status_code=status.HTTP_201_CREATED)
async def create_class(
    payload: PlantClassCreate,
    repo: PlantClassRepository = Depends(class_repo),
    _: CurrentUser = Depends(get_current_user),
):
    return await repo.create(payload)


@router.get("/{class_id}", response_model=PlantClass)
async def get_class(
    class_id: str,
    repo: PlantClassRepository = Depends(class_repo),
    _: CurrentUser = Depends(get_current_user),
):
    entity = await repo.get(class_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
    return entity


@router.patch("/{class_id}", response_model=PlantClass)
async def update_class(
    class_id: str,
    payload: PlantClassUpdate,
    repo: PlantClassRepository = Depends(class_repo),
    _: CurrentUser = Depends(get_current_user),
):
    entity = await repo.update(class_id, payload)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
    return entity


@router.delete("/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_class(
    class_id: str,
    repo: PlantClassRepository = Depends(class_repo),
    _: CurrentUser = Depends(get_current_user),
):
    if not await repo.delete(class_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
