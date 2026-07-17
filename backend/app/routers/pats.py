"""Personal access token management for the current user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import CurrentUser, get_current_user
from ..deps import pat_repo
from ..models import (
    PersonalAccessTokenCreate,
    PersonalAccessTokenCreated,
)
from ..repositories import PersonalAccessTokenRepository

router = APIRouter(prefix="/api/auth/pats", tags=["personal-access-tokens"])


@router.get("", response_model=list[str])
async def list_personal_access_tokens(
    repo: PersonalAccessTokenRepository = Depends(pat_repo),
    user: CurrentUser = Depends(get_current_user),
):
    tokens = await repo.list_for_user(user.oid)
    return [token.id for token in tokens]


@router.post(
    "", response_model=PersonalAccessTokenCreated, status_code=status.HTTP_201_CREATED
)
async def create_personal_access_token(
    payload: PersonalAccessTokenCreate,
    repo: PersonalAccessTokenRepository = Depends(pat_repo),
    user: CurrentUser = Depends(get_current_user),
):
    token, plaintext = await repo.create(user.oid, user.email, user.name, payload)
    return PersonalAccessTokenCreated(
        id=token.id,
        name=token.name,
        last_four=token.last_four,
        expires_at=token.expires_at,
        last_used_at=token.last_used_at,
        created_at=token.created_at,
        token=plaintext,
    )


@router.delete("/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_personal_access_token(
    token_id: str,
    repo: PersonalAccessTokenRepository = Depends(pat_repo),
    user: CurrentUser = Depends(get_current_user),
):
    if not await repo.revoke(user.oid, token_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")