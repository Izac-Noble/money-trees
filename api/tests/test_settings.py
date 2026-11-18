import pytest

from money_trees_api.settings import (
    DEFAULT_ALLOWED_ORIGINS,
    Settings,
    parse_allowed_origins,
    parse_app_env,
)


class TestAppEnv:
    @pytest.mark.parametrize("raw", [None, "", "   "])
    def test_defaults_to_development(self, raw: str | None) -> None:
        assert parse_app_env(raw) == "development"

    def test_reads_value_and_strips_whitespace(self) -> None:
        assert parse_app_env("  production ") == "production"


class TestAllowedOrigins:
    @pytest.mark.parametrize("raw", [None, "", "  ", " , ,"])
    def test_unset_or_blank_allows_only_local_vite(self, raw: str | None) -> None:
        assert parse_allowed_origins(raw) == ("http://localhost:5173",)

    def test_single_origin(self) -> None:
        assert parse_allowed_origins("https://app.example.com") == ("https://app.example.com",)

    def test_multiple_origins_trimmed_and_trailing_slash_removed(self) -> None:
        raw = " https://app.example.com/ ,https://staging.example.com,, "
        assert parse_allowed_origins(raw) == (
            "https://app.example.com",
            "https://staging.example.com",
        )

    def test_duplicates_removed(self) -> None:
        raw = "https://a.example.com,https://a.example.com/"
        assert parse_allowed_origins(raw) == ("https://a.example.com",)

    @pytest.mark.parametrize(
        "raw", ["*", " * ", "https://a.example.com,*", "https://*.example.com"]
    )
    def test_wildcard_is_rejected(self, raw: str) -> None:
        with pytest.raises(ValueError, match=r"\*"):
            parse_allowed_origins(raw)

    @pytest.mark.parametrize("raw", ["app.example.com", "ftp://app.example.com"])
    def test_origin_without_http_scheme_is_rejected(self, raw: str) -> None:
        with pytest.raises(ValueError, match="http"):
            parse_allowed_origins(raw)


class TestSettingsFromEnv:
    def test_empty_environment_uses_defaults(self) -> None:
        settings = Settings.from_env({})
        assert settings.app_env == "development"
        assert settings.allowed_origins == DEFAULT_ALLOWED_ORIGINS

    def test_reads_both_variables(self) -> None:
        settings = Settings.from_env(
            {"APP_ENV": "staging", "ALLOWED_ORIGINS": "https://staging.example.com"}
        )
        assert settings == Settings(
            app_env="staging", allowed_origins=("https://staging.example.com",)
        )

    def test_wildcard_fails_at_startup(self) -> None:
        with pytest.raises(ValueError):
            Settings.from_env({"ALLOWED_ORIGINS": "*"})
