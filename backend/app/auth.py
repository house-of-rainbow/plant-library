"""EntraID (Azure AD) authentication.

Validates bearer access tokens against the tenant's JWKS. For local
development set ``AUTH_DISABLED=true`` to inject a stub user and skip
validation entirely.

All authenticated users are treated as full admins (per project decision).
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from .config import Settings, get_settings

logger = logging.getLogger("plantlibrary.auth")

bearer_scheme = HTTPBearer(auto_error=False)


class CurrentUser:
    def __init__(self, oid: str, name: str, email: Optional[str] = None) -> None:
        self.oid = oid
        self.name = name
        self.email = email

    def as_dict(self) -> dict:
        return {"oid": self.oid, "name": self.name, "email": self.email}


_STUB_USER = CurrentUser(oid="local-dev", name="Local Developer", email="dev@localhost")

# Cache of PyJWKClient keyed by tenant to avoid re-fetching signing keys.
_jwks_clients: dict[str, PyJWKClient] = {}


def _jwks_client(tenant_id: str) -> PyJWKClient:
    if tenant_id not in _jwks_clients:
        url = f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
        _jwks_clients[tenant_id] = PyJWKClient(url)
    return _jwks_clients[tenant_id]


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if settings.auth_disabled:
        return _STUB_USER

    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        signing_key = _jwks_client(settings.entra_tenant_id).get_signing_key_from_jwt(
            token
        )
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.entra_api_audience or settings.entra_client_id,
            options={"require": ["exp", "iss"]},
        )
    except Exception as exc:  # noqa: BLE001 - surface a clean 401
        logger.warning("Token validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return CurrentUser(
        oid=claims.get("oid", claims.get("sub", "unknown")),
        name=claims.get("name", "Unknown"),
        email=claims.get("preferred_username") or claims.get("email"),
    )
