"""Spec 4: calculation endpoints. Values must match the engine exactly."""

from __future__ import annotations

import logging
import re
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from money_trees_api import main as api_main
from money_trees_api import serialize
from money_trees_api.main import DISCLAIMER, create_app
from money_trees_api.settings import Settings
from money_trees_engine.amortization import amortize
from money_trees_engine.debts import Debt, analyze_debts
from money_trees_engine.strategies import run_strategy

D = Decimal
RATE_KEYS = {"annual_rate", "monthly_rate"}
NUMERIC_STRING = re.compile(r"^-?\d+(\.\d+)?$")
MONEY_STRING = re.compile(r"^-?\d+\.\d{2}$")

THREE_DEBTS: list[dict[str, Any]] = [
    {
        "id": "p1",
        "name": "Personal loan",
        "category": "personal",
        "principal": "3000",
        "annual_rate": "0.04",
        "term_months": 24,
    },
    {
        "id": "c1",
        "name": "Car loan",
        "category": "auto",
        "principal": "15000",
        "annual_rate": "0.09",
        "term_months": 60,
    },
    {
        "id": "s1",
        "name": "Student loan",
        "category": "student",
        "principal": "20000",
        "annual_rate": "0.06",
        "term_months": 120,
    },
]
ENGINE_DEBTS = [
    Debt("p1", "Personal loan", "personal", D("3000"), D("0.04"), 24),
    Debt("c1", "Car loan", "auto", D("15000"), D("0.09"), 60),
    Debt("s1", "Student loan", "student", D("20000"), D("0.06"), 120),
]


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(app_env="development")))


def money_strings(value: object, key: str | None = None) -> list[str]:
    """Every numeric string in a response that isn't a rate."""
    found: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            found += money_strings(v, k)
    elif isinstance(value, list):
        for item in value:
            found += money_strings(item, key)
    elif isinstance(value, str) and key not in RATE_KEYS and NUMERIC_STRING.match(value):
        found.append(value)
    return found


def assert_money_formatted(body: object) -> None:
    values = money_strings(body)
    assert values, "expected money values in the response"
    bad = [v for v in values if not MONEY_STRING.match(v)]
    assert not bad, f"money values without exactly 2 decimals: {bad[:5]}"


def errors_by_field(body: dict[str, Any]) -> dict[str | None, str]:
    return {e["field"]: e["message"] for e in body["errors"]}


# --- Engine parity -----------------------------------------------------------------------


def test_case_a_matches_engine(client: TestClient) -> None:
    response = client.post(
        "/api/amortization",
        json={"principal": "1000", "annual_rate": "0.12", "term_months": 12},
    )
    assert response.status_code == 200
    body = response.json()
    expected = serialize.amortization(amortize(D("1000"), D("0.12"), 12))
    assert body == {"engine_version": "0.1.0", **expected}
    assert body["summary"]["payment"] == "88.85"
    assert body["summary"]["total_interest"] == "66.19"
    assert body["schedule"][-1]["payment"] == "88.84"
    assert_money_formatted(body)


def test_case_b_matches_spec_example(client: TestClient) -> None:
    body = client.post(
        "/api/amortization",
        json={
            "principal": "200000",
            "annual_rate": "0.06",
            "term_months": 360,
            "extra_monthly": "0",
            "lump_sums": [],
        },
    ).json()
    assert body["engine_version"] == "0.1.0"
    assert body["summary"] == {
        "payment": "1199.10",
        "payoff_month": 360,
        "total_interest": "231677.04",
        "total_paid": "431677.04",
        "interest_saved": None,
        "months_saved": None,
    }
    assert body["schedule"][0] == {
        "month": 1,
        "starting_balance": "200000.00",
        "interest": "1000.00",
        "scheduled_principal": "199.10",
        "extra_principal": "0.00",
        "payment": "1199.10",
        "ending_balance": "199800.90",
    }
    assert body == {
        "engine_version": "0.1.0",
        **serialize.amortization(amortize(D("200000"), D("0.06"), 360)),
    }
    assert_money_formatted(body)


def test_amortization_with_extras(client: TestClient) -> None:
    body = client.post(
        "/api/amortization",
        json={
            "principal": "200000",
            "annual_rate": "0.06",
            "term_months": 360,
            "lump_sums": [{"month": 12, "amount": "10000"}],
        },
    ).json()
    assert body["summary"]["payoff_month"] == 318
    assert body["summary"]["interest_saved"] == "41044.36"
    assert body["summary"]["months_saved"] == 42
    assert body["assumptions"]["lump_sums"] == [{"month": 12, "amount": "10000.00"}]


def test_case_g_matches_engine(client: TestClient) -> None:
    response = client.post("/api/debts", json={"debts": THREE_DEBTS})
    assert response.status_code == 200
    body = response.json()
    assert body == {"engine_version": "0.1.0", **serialize.debts(analyze_debts(ENGINE_DEBTS))}
    assert [d["summary"]["payment"] for d in body["debts"]] == ["130.27", "311.38", "222.04"]
    assert body["summary"]["total_regular_payment"] == "663.69"
    assert body["summary"]["total_interest"] == "10454.06"
    assert body["summary"]["debt_free_month"] == 120
    assert body["by_category"]["auto"] == {
        "starting_balance": "15000.00",
        "total_interest": "3682.46",
    }
    assert_money_formatted(body)


def test_case_k_matches_engine(client: TestClient) -> None:
    response = client.post(
        "/api/strategies",
        json={"debts": THREE_DEBTS, "extra_monthly": "300", "strategy": "avalanche"},
    )
    assert response.status_code == 200
    body = response.json()
    engine = run_strategy(ENGINE_DEBTS, D("300"), "avalanche")
    assert body == {"engine_version": "0.1.0", **serialize.strategy(engine)}
    assert body["priority_order"] == ["c1", "s1", "p1"]
    assert body["debt_free_month"] == 45
    assert body["total_interest"] == "5004.74"
    assert body["interest_saved"] == "5449.32"
    assert body["months_saved"] == 75
    assert {d["id"]: d["payoff_month"] for d in body["debts"]} == {"p1": 24, "c1": 27, "s1": 45}
    assert_money_formatted(body)


def test_custom_strategy(client: TestClient) -> None:
    body = client.post(
        "/api/strategies",
        json={
            "debts": THREE_DEBTS,
            "extra_monthly": "300",
            "strategy": "custom",
            "custom_order": ["c1", "s1", "p1"],
        },
    ).json()
    assert body["strategy"] == "custom"
    assert body["total_interest"] == "5004.74"


def test_compare(client: TestClient) -> None:
    response = client.post(
        "/api/strategies/compare", json={"debts": THREE_DEBTS, "extra_monthly": "300"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["engine_version"] == "0.1.0"
    assert body["avalanche"]["total_interest"] == "5004.74"
    assert body["snowball"]["total_interest"] == "5137.11"
    assert body["differences"] == {
        "description": "snowball minus avalanche",
        "total_interest": "132.37",
        "debt_free_month": 0,
        "first_payoff_month": -16,
    }
    assert body["avalanche"]["baseline"]["total_interest"] == "10454.06"
    assert len(body["avalanche"]["baseline"]["timeline"]) == 120
    assert_money_formatted(body)


def test_meta(client: TestClient) -> None:
    body = client.get("/api/meta").json()
    assert body["disclaimer"] == DISCLAIMER
    assert DISCLAIMER == "Estimates for learning and planning, not financial advice."
    assert body["categories"] == [
        {"value": "mortgage", "suggested_term_months": 360},
        {"value": "auto", "suggested_term_months": 60},
        {"value": "student", "suggested_term_months": 120},
        {"value": "personal", "suggested_term_months": 36},
        {"value": "other", "suggested_term_months": None},
    ]
    assert body["engine_version"] == "0.1.0"
    assert body["limits"]["max_debts"] == 20


# --- Validation and errors ---------------------------------------------------------------


def test_money_as_number_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/amortization", json={"principal": 1000, "annual_rate": "0.06", "term_months": 12}
    )
    assert response.status_code == 422
    message = errors_by_field(response.json())["principal"]
    assert "string" in message


def test_rate_as_number_in_debt_has_path(client: TestClient) -> None:
    debts = [dict(d) for d in THREE_DEBTS]
    debts[1]["annual_rate"] = 0.09
    response = client.post("/api/debts", json={"debts": debts})
    assert response.status_code == 422
    assert "string" in errors_by_field(response.json())["debts[1].annual_rate"]


def test_reports_every_invalid_field(client: TestClient) -> None:
    debts = [dict(d) for d in THREE_DEBTS]
    debts[0]["name"] = " "
    debts[1]["annual_rate"] = "1.5"
    debts[2]["category"] = "credit_card"
    debts[2]["term_months"] = 0
    response = client.post("/api/debts", json={"debts": debts})
    assert response.status_code == 422
    errors = errors_by_field(response.json())
    assert set(errors) == {
        "debts[0].name",
        "debts[1].annual_rate",
        "debts[2].category",
        "debts[2].term_months",
    }
    assert errors["debts[1].annual_rate"] == "Rate must be below 1 (100%)."


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"annual_rate": "0.06", "term_months": 12}, "principal"),
        ({"principal": "0", "annual_rate": "0.06", "term_months": 12}, "principal"),
        ({"principal": "10.123", "annual_rate": "0.06", "term_months": 12}, "principal"),
        ({"principal": "1e5", "annual_rate": "0.06", "term_months": 12}, "principal"),
        ({"principal": "1000", "annual_rate": "0.0612345", "term_months": 12}, "annual_rate"),
        ({"principal": "1000", "annual_rate": "-0.01", "term_months": 12}, "annual_rate"),
        ({"principal": "1000", "annual_rate": "0.06", "term_months": 601}, "term_months"),
        ({"principal": "1000", "annual_rate": "0.06", "term_months": "12"}, "term_months"),
        ({"principal": "1000", "annual_rate": "0.06", "term_months": True}, "term_months"),
        (
            {"principal": "1000", "annual_rate": "0.06", "term_months": 12, "extra_monthly": "-1"},
            "extra_monthly",
        ),
        (
            {
                "principal": "1000",
                "annual_rate": "0.06",
                "term_months": 12,
                "lump_sums": [{"month": 13, "amount": "5"}],
            },
            "lump_sums[0].month",
        ),
        (
            {"principal": "1000", "annual_rate": "0.06", "term_months": 12, "rate": "0.06"},
            "rate",
        ),
    ],
)
def test_amortization_validation(client: TestClient, payload: dict[str, Any], field: str) -> None:
    response = client.post("/api/amortization", json=payload)
    assert response.status_code == 422
    assert field in errors_by_field(response.json())


def test_strategy_validation(client: TestClient) -> None:
    debts = [dict(d) for d in THREE_DEBTS]
    debts[0]["extra_monthly"] = "10"
    response = client.post(
        "/api/strategies",
        json={"debts": debts, "extra_monthly": "-5", "strategy": "custom"},
    )
    assert response.status_code == 422
    assert set(errors_by_field(response.json())) == {
        "debts[0].extra_monthly",
        "extra_monthly",
        "custom_order",
    }


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"strategy": "highest_rate"}, "strategy"),
        ({"strategy": "custom", "custom_order": ["c1", "s1"]}, "custom_order"),
        ({"strategy": "custom", "custom_order": ["c1", "s1", "x9"]}, "custom_order"),
        ({"strategy": "avalanche", "custom_order": ["c1", "s1", "p1"]}, "custom_order"),
    ],
)
def test_strategy_choice_validation(
    client: TestClient, changes: dict[str, Any], field: str
) -> None:
    payload = {"debts": THREE_DEBTS, "extra_monthly": "300", **changes}
    response = client.post("/api/strategies", json=payload)
    assert response.status_code == 422
    assert field in errors_by_field(response.json())


@pytest.mark.parametrize(
    "debts",
    [[], [THREE_DEBTS[0] | {"id": f"d{i}"} for i in range(21)]],
)
def test_debt_count_limits(client: TestClient, debts: list[dict[str, Any]]) -> None:
    response = client.post("/api/debts", json={"debts": debts})
    assert response.status_code == 422
    assert "debts" in errors_by_field(response.json())


def test_body_must_be_object(client: TestClient) -> None:
    response = client.post("/api/debts", json=[1, 2])
    assert response.status_code == 422
    assert errors_by_field(response.json()) == {None: "Expected a JSON object."}


@pytest.mark.parametrize("body", [b"{not json", b"", b'{"principal": NaN}'])
def test_malformed_json_is_400(client: TestClient, body: bytes) -> None:
    response = client.post(
        "/api/amortization", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json() == {
        "errors": [{"field": None, "message": "Request body is not valid JSON."}]
    }


def test_oversized_body_is_413(client: TestClient) -> None:
    big = b'{"debts": "' + b"x" * (100 * 1024) + b'"}'
    response = client.post("/api/debts", content=big, headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert response.json()["errors"][0]["field"] is None


def test_internal_error_is_generic_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def explode(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("secret detail 987654.32")

    monkeypatch.setattr(api_main, "amortize", explode)
    with caplog.at_level(logging.DEBUG):
        response = client.post(
            "/api/amortization",
            json={"principal": "987654.32", "annual_rate": "0.06", "term_months": 12},
        )
    assert response.status_code == 500
    assert response.json() == {
        "errors": [{"field": None, "message": "Something went wrong. Please try again."}]
    }
    assert "secret" not in response.text
    assert "Traceback" not in response.text
    assert "987654.32" not in caplog.text
    assert "secret" not in caplog.text


def test_request_bodies_are_not_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        client.post(
            "/api/amortization",
            json={"principal": "424242.42", "annual_rate": "0.0777", "term_months": 123},
        )
        client.post(
            "/api/amortization",
            json={"principal": 424242.42, "annual_rate": "0.0777", "term_months": 123},
        )
    assert "/api/amortization" in caplog.text  # path and status are logged
    for secret in ("424242", "0.0777", "123 "):
        assert secret not in caplog.text
