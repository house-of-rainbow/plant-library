"""Plant class (species/taxon) CRUD endpoints — scoped to a property."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth import CurrentUser, get_current_user
from ..deps import authorize, class_repo, tenancy_repo
from ..models import PlantClass, PlantClassCreate, PlantClassUpdate
from ..repositories import PlantClassRepository, TenancyRepository

router = APIRouter(prefix="/api/classes", tags=["classes"])


@router.get("", response_model=list[PlantClass])
async def list_classes(
    property_id: str = Query(...),
    repo: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    return await repo.list(property_id)


@router.post("", response_model=PlantClass, status_code=status.HTTP_201_CREATED)
async def create_class(
    payload: PlantClassCreate,
    property_id: str = Query(...),
    repo: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    return await repo.create(property_id, payload)


@router.get("/{class_id}", response_model=PlantClass)
async def get_class(
    class_id: str,
    property_id: str = Query(...),
    repo: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    entity = await repo.get(property_id, class_id)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
    return entity


@router.patch("/{class_id}", response_model=PlantClass)
async def update_class(
    class_id: str,
    payload: PlantClassUpdate,
    property_id: str = Query(...),
    repo: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    entity = await repo.update(property_id, class_id, payload)
    if entity is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
    return entity


@router.delete("/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_class(
    class_id: str,
    property_id: str = Query(...),
    repo: PlantClassRepository = Depends(class_repo),
    tenancy: TenancyRepository = Depends(tenancy_repo),
    user: CurrentUser = Depends(get_current_user),
):
    await authorize(tenancy, property_id, user)
    if not await repo.delete(property_id, class_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plant class not found")
