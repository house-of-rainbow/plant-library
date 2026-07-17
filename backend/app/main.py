"""Burien Station Plant Library — FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_db
from .logging_config import configure_logging
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
configured_log_level = configure_logging(settings.log_level)
logger = logging.getLogger("plantlibrary.app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.debug("Starting backend lifespan with log level %s", configured_log_level)
    await get_db().connect(settings)
    await get_storage().connect(settings)
    logger.debug("Backend startup complete")
    try:
        yield
    finally:
        logger.debug("Shutting down backend lifespan")
        await get_db().close()
        await get_storage().close()
        logger.debug("Backend shutdown complete")


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


@app.middleware("http")
async def log_request_response(request: Request, call_next):
    started_at = perf_counter()
    client_host = request.client.host if request.client else "unknown"
    logger.debug(
        "Request started %s %s from %s",
        request.method,
        request.url.path,
        client_host,
    )
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - started_at) * 1000
        logger.exception(
            "Request failed %s %s from %s in %.2fms",
            request.method,
            request.url.path,
            client_host,
            duration_ms,
        )
        raise

    duration_ms = (perf_counter() - started_at) * 1000
    logger.debug(
        "Request completed %s %s -> %s in %.2fms",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response

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
