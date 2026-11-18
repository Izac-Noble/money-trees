import pytest

from money_trees_api.settings import Settings, parse_app_env


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_app_env_defaults_to_development(raw: str | None) -> None:
    assert parse_app_env(raw) == "development"


def test_app_env_reads_value_and_strips_whitespace() -> None:
    assert parse_app_env("  production ") == "production"


def test_settings_from_empty_environment() -> None:
    assert Settings.from_env({}) == Settings(app_env="development")


def test_settings_reads_app_env() -> None:
    assert Settings.from_env({"APP_ENV": "staging"}) == Settings(app_env="staging")


def test_settings_ignores_removed_allowed_origins() -> None:
    settings = Settings.from_env({"ALLOWED_ORIGINS": "*"})
    assert settings == Settings(app_env="development")
