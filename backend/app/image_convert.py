"""Image normalization helpers.

iOS devices commonly produce HEIC/HEIF photos. Neither Pl@ntNet, the OpenAI
vision API, nor browsers reliably handle HEIC, so we transcode those uploads to
JPEG at the API boundary. Everything downstream then only sees standard formats.
"""
from __future__ import annotations

import io
import logging

logger = logging.getLogger("plantlibrary.images")

_HEIC_CONTENT_TYPES = {
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
}
_HEIC_EXTENSIONS = (".heic", ".heif")

_heif_registered = False


def _ensure_heif_opener() -> bool:
    """Register the pillow-heif opener with Pillow once. Returns availability."""
    global _heif_registered
    if _heif_registered:
        return True
    try:
        import pillow_heif

        pillow_heif.register_heif_opener()
        _heif_registered = True
        return True
    except Exception as exc:  # noqa: BLE001 - optional dependency / platform wheel
        logger.warning("pillow-heif unavailable; HEIC conversion disabled: %s", exc)
        return False


def is_heic(content_type: str | None, filename: str | None) -> bool:
    if (content_type or "").lower() in _HEIC_CONTENT_TYPES:
        return True
    return (filename or "").lower().endswith(_HEIC_EXTENSIONS)


def _to_jpeg(data: bytes) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(data)) as image:
        rgb = image.convert("RGB")
        out = io.BytesIO()
        rgb.save(out, format="JPEG", quality=90)
        return out.getvalue()


def normalize_image(
    data: bytes,
    content_type: str | None,
    filename: str | None = None,
) -> tuple[bytes, str | None]:
    """Convert HEIC/HEIF uploads to JPEG.

    Returns ``(data, content_type)`` unchanged for non-HEIC input, or the
    transcoded JPEG bytes with ``image/jpeg`` when conversion succeeds. On
    failure the original bytes/type are returned so the caller's validation can
    still reject them with a clear error.
    """
    if not is_heic(content_type, filename):
        return data, content_type
    if not _ensure_heif_opener():
        return data, content_type
    try:
        return _to_jpeg(data), "image/jpeg"
    except Exception as exc:  # noqa: BLE001 - never crash the request on a bad image
        logger.warning("HEIC conversion failed filename=%s: %s", filename, exc)
        return data, content_type
