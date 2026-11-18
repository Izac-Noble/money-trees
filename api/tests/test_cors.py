from fastapi.testclient import TestClient

from money_trees_api.main import create_app
from money_trees_api.settings import Settings

ALLOWED = "https://app.example.com"
OTHER = "https://evil.example.net"


def client_for(*origins: str) -> TestClient:
    return TestClient(create_app(Settings(app_env="test", allowed_origins=origins)))


def test_allowed_origin_gets_cors_header() -> None:
    response = client_for(ALLOWED).get("/health", headers={"Origin": ALLOWED})
    assert response.headers.get("access-control-allow-origin") == ALLOWED


def test_disallowed_origin_gets_no_cors_header() -> None:
    response = client_for(ALLOWED).get("/health", headers={"Origin": OTHER})
    assert "access-control-allow-origin" not in response.headers


def test_never_responds_with_wildcard() -> None:
    response = client_for(ALLOWED).get("/health", headers={"Origin": ALLOWED})
    assert response.headers.get("access-control-allow-origin") != "*"


def test_preflight_allowed_origin() -> None:
    response = client_for(ALLOWED).options(
        "/health",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_preflight_disallowed_origin_is_rejected() -> None:
    response = client_for(ALLOWED).options(
        "/health",
        headers={"Origin": OTHER, "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_default_settings_allow_local_vite_only() -> None:
    client = TestClient(create_app(Settings.from_env({})))
    local = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert local.headers.get("access-control-allow-origin") == "http://localhost:5173"
    other = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert "access-control-allow-origin" not in other.headers
