from fastapi.testclient import TestClient

from money_trees_api.main import app

client = TestClient(app)


def test_health_reports_ok_and_engine_version() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["engine_version"] == "0.1.0"
