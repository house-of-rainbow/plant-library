"""Burien Station Plant Library — FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_db
from .routers import (
    classes,
    dashboard,
    identify,
    images,
    instances,
    pats,
    properties,
    scan,
    tags,
)
from .storage import get_storage

settings = get_settings()
logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_db().connect(settings)
    await get_storage().connect(settings)
    yield
    await get_db().close()
    await get_storage().close()


app = FastAPI(
    title="Burien Station Plant Library API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(classes.router)
app.include_router(instances.router)
app.include_router(scan.router)
app.include_router(images.router)
app.include_router(dashboard.router)
app.include_router(identify.router)
app.include_router(properties.router)
app.include_router(pats.router)
app.include_router(tags.router)


@app.get("/api/health", tags=["health"])
async def health():
    return {"status": "ok", "env": settings.app_env, "auth_disabled": settings.auth_disabled}
