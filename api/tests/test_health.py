from fastapi.testclient import TestClient

from money_trees_api.main import create_app
from money_trees_api.settings import Settings


def make_client(app_env: str = "development") -> TestClient:
    return TestClient(
        create_app(Settings(app_env=app_env, allowed_origins=("http://localhost:5173",)))
    )


def test_health_reports_ok_and_engine_version() -> None:
    body = make_client().get("/health").json()
    assert body["status"] == "ok"
    assert body["engine_version"] == "0.1.0"


def test_health_returns_app_env() -> None:
    assert make_client("staging").get("/health").json()["app_env"] == "staging"
