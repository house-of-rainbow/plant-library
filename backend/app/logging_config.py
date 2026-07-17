from __future__ import annotations

import logging
from logging.config import dictConfig
from typing import Any

_VALID_LOG_LEVELS = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}
logger = logging.getLogger("plantlibrary.logging")


def normalize_log_level(level: str | None) -> str:
    value = (level or "DEBUG").upper()
    if value in _VALID_LOG_LEVELS:
        return value
    return "DEBUG"


def build_logging_config(level: str | None) -> dict[str, Any]:
    normalized_level = normalize_log_level(level)

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s %(levelname)s [%(name)s] %(message)s",
            },
            "access": {
                "()": "uvicorn.logging.AccessFormatter",
                "fmt": '%(asctime)s %(levelprefix)s [%(name)s] %(client_addr)s - "%(request_line)s" %(status_code)s',
            },
        },
        "handlers": {
            "default": {
                "class": "logging.StreamHandler",
                "formatter": "standard",
                "stream": "ext://sys.stdout",
            },
            "access": {
                "class": "logging.StreamHandler",
                "formatter": "access",
                "stream": "ext://sys.stdout",
            },
        },
        "root": {
            "handlers": ["default"],
            "level": normalized_level,
        },
        "loggers": {
            "plantlibrary": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "uvicorn": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["access"],
                "level": normalized_level,
                "propagate": False,
            },
            "fastapi": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "azure": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "httpx": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "httpcore": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
            "openai": {
                "handlers": ["default"],
                "level": normalized_level,
                "propagate": False,
            },
        },
    }


def configure_logging(level: str | None) -> str:
    normalized_level = normalize_log_level(level)
    dictConfig(build_logging_config(normalized_level))
    logger.debug("Configured application logging level=%s", normalized_level)
    return normalized_level