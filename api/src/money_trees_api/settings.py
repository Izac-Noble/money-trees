"""Runtime configuration read from environment variables."""

from collections.abc import Mapping
from dataclasses import dataclass

DEFAULT_APP_ENV = "development"


def parse_app_env(raw: str | None) -> str:
    """Return APP_ENV, or "development" when it is unset or blank."""
    value = (raw or "").strip()
    return value or DEFAULT_APP_ENV


@dataclass(frozen=True)
class Settings:
    app_env: str

    @classmethod
    def from_env(cls, environ: Mapping[str, str]) -> "Settings":
        return cls(app_env=parse_app_env(environ.get("APP_ENV")))
