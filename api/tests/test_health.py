from fastapi.testclient import TestClient

from money_trees_api.main import create_app
from money_trees_api.settings import Settings


def make_client(app_env: str = "development") -> TestClient:
    return TestClient(create_app(Settings(app_env=app_env)))


def test_health_reports_ok_and_engine_version() -> None:
    body = make_client().get("/api/health").json()
    assert body["status"] == "ok"
    assert body["engine_version"] == "0.1.0"


def test_health_returns_app_env() -> None:
    assert make_client("staging").get("/api/health").json()["app_env"] == "staging"


def test_routes_live_only_under_api_prefix() -> None:
    assert make_client().get("/health").status_code == 404


def test_docs_served_under_api_prefix() -> None:
    client = make_client()
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 404


def test_no_cors_headers_since_requests_are_same_origin() -> None:
    response = make_client().get("/api/health", headers={"Origin": "https://other.example.net"})
    assert "access-control-allow-origin" not in response.headers


def test_vercel_entrypoint_exposes_app() -> None:
    import importlib.util
    from pathlib import Path

    from fastapi import FastAPI

    path = Path(__file__).resolve().parents[1] / "index.py"
    spec = importlib.util.spec_from_file_location("vercel_index", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert isinstance(module.app, FastAPI)
