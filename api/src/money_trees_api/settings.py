"""Runtime configuration read from environment variables."""

from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_APP_ENV = "development"
DEFAULT_ALLOWED_ORIGINS: tuple[str, ...] = ("http://localhost:5173",)


def parse_app_env(raw: str | None) -> str:
    """Return APP_ENV, or "development" when it is unset or blank."""
    value = (raw or "").strip()
    return value or DEFAULT_APP_ENV


def parse_allowed_origins(raw: str | None) -> tuple[str, ...]:
    """Parse a comma-separated ALLOWED_ORIGINS value.

    Unset or blank falls back to the local Vite dev server only. A wildcard is
    rejected outright so a misconfigured deploy fails at startup instead of
    silently opening the API to every site.
    """
    if raw is None or not raw.strip():
        return DEFAULT_ALLOWED_ORIGINS

    origins: list[str] = []
    for part in raw.split(","):
        origin = part.strip().rstrip("/")
        if not origin:
            continue
        if "*" in origin:
            raise ValueError("ALLOWED_ORIGINS must not contain '*'; list each origin explicitly")
        if not origin.startswith(("http://", "https://")):
            raise ValueError(
                f"ALLOWED_ORIGINS entry {origin!r} must start with http:// or https://"
            )
        if origin not in origins:
            origins.append(origin)

    return tuple(origins) or DEFAULT_ALLOWED_ORIGINS


@dataclass(frozen=True)
class Settings:
    app_env: str
    allowed_origins: tuple[str, ...]

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> "Settings":
        return cls(
            app_env=parse_app_env(environ.get("APP_ENV")),
            allowed_origins=parse_allowed_origins(environ.get("ALLOWED_ORIGINS")),
        )
