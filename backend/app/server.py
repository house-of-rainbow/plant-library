from __future__ import annotations

import argparse
import logging
from logging.config import dictConfig

import uvicorn

from .config import get_settings
from .logging_config import build_logging_config, normalize_log_level

logger = logging.getLogger("plantlibrary.server")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Plant Library backend server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    settings = get_settings()
    log_level = normalize_log_level(settings.log_level)
    dictConfig(build_logging_config(log_level))
    logger.info(
        "Starting backend server host=%s port=%s reload=%s log_level=%s",
        args.host,
        args.port,
        args.reload,
        log_level,
    )

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        access_log=True,
        log_level=log_level.lower(),
        log_config=build_logging_config(log_level),
    )


if __name__ == "__main__":
    main()