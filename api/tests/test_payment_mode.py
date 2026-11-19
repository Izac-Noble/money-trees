"""Spec 4 (revised): payment modes, credit card notes and min_interest."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from money_trees_api import serialize
from money_trees_api.main import create_app
from money_trees_api.settings import Settings
from money_trees_engine.amortization import amortize_payment
from money_trees_engine.debts import CREDIT_CARD_NOTES

D = Decimal

CARD: dict[str, Any] = {
    "id": "cc",
    "name": "Credit card",
    "category": "credit_card",
    "payment_mode": "fixed_payment",
    "principal": "5000",
    "annual_rate": "0.24",
    "monthly_payment": "200",
}
THREE: list[dict[str, Any]] = [
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


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(app_env="test")))


def errors(body: dict[str, Any]) -> dict[str | None, dict[str, Any]]:
    return {e["field"]: e for e in body["errors"]}


def test_case_p_matches_engine_with_notes(client: TestClient) -> None:
    response = client.post(
        "/api/amortization",
        json={
            "payment_mode": "fixed_payment",
            "category": "credit_card",
            "principal": "5000",
            "annual_rate": "0.24",
            "monthly_payment": "200",
        },
    )
    assert response.status_code == 200
    body = response.json()
    engine = amortize_payment(D("5000"), D("0.24"), D("200"))
    assert body == {
        "engine_version": "0.1.0",
        **serialize.amortization(engine, CREDIT_CARD_NOTES),
    }
    assert body["summary"]["payment"] == "200.00"
    assert body["summary"]["payoff_month"] == 36
    assert body["summary"]["total_interest"] == "2000.57"
    assert body["schedule"][-1]["payment"] == "0.57"
    assert len(body["notes"]) == 4
    assert body["assumptions"]["payment_mode"] == "fixed_payment"
    assert body["assumptions"]["term_months"] is None


def test_fixed_term_default_has_empty_notes(client: TestClient) -> None:
    body = client.post(
        "/api/amortization",
        json={"principal": "1000", "annual_rate": "0.12", "term_months": 12},
    ).json()
    assert body["notes"] == []
    assert body["assumptions"]["payment_mode"] == "fixed_term"
    assert body["assumptions"]["monthly_payment"] is None


@pytest.mark.parametrize("payment", ["100", "99"])
def test_case_t_returns_min_interest(client: TestClient, payment: str) -> None:
    response = client.post(
        "/api/amortization",
        json={
            "payment_mode": "fixed_payment",
            "principal": "5000",
            "annual_rate": "0.24",
            "monthly_payment": payment,
        },
    )
    assert response.status_code == 422
    error = errors(response.json())["monthly_payment"]
    assert error["min_interest"] == "100.00"
    assert "doesn't cover the monthly interest" in error["message"]


def test_case_u_too_long(client: TestClient) -> None:
    response = client.post(
        "/api/amortization",
        json={
            "payment_mode": "fixed_payment",
            "principal": "10000",
            "annual_rate": "0.03",
            "monthly_payment": "25.50",
        },
    )
    assert response.status_code == 422
    assert errors(response.json())["monthly_payment"]["message"] == (
        "At this payment, this would take more than 50 years to pay off."
    )


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        (
            {
                "principal": "1000",
                "annual_rate": "0.12",
                "term_months": 12,
                "monthly_payment": "90",
            },
            "monthly_payment",
        ),
        (
            {
                "payment_mode": "fixed_payment",
                "principal": "1000",
                "annual_rate": "0.12",
                "monthly_payment": "90",
                "term_months": 12,
            },
            "term_months",
        ),
        (
            {"payment_mode": "fixed_payment", "principal": "1000", "annual_rate": "0.12"},
            "monthly_payment",
        ),
        (
            {
                "payment_mode": "fixed_payment",
                "principal": "1000",
                "annual_rate": "0.12",
                "monthly_payment": "0",
            },
            "monthly_payment",
        ),
        (
            {
                "payment_mode": "fixed_payment",
                "principal": "1000",
                "annual_rate": "0.12",
                "monthly_payment": 90,
            },
            "monthly_payment",
        ),
        (
            {"payment_mode": "minimum", "principal": "1000", "annual_rate": "0.12"},
            "payment_mode",
        ),
    ],
)
def test_mode_validation(client: TestClient, payload: dict[str, Any], field: str) -> None:
    response = client.post("/api/amortization", json=payload)
    assert response.status_code == 422
    assert field in errors(response.json())


def test_debts_with_a_credit_card(client: TestClient) -> None:
    response = client.post("/api/debts", json={"debts": [*THREE, CARD]})
    assert response.status_code == 200
    body = response.json()
    assert body["timeline"][0]["total_payment"] == "863.69"
    assert body["summary"]["total_interest"] == "12454.63"
    by_id = {d["id"]: d for d in body["debts"]}
    assert by_id["cc"]["payment_mode"] == "fixed_payment"
    assert len(by_id["cc"]["notes"]) == 4
    assert by_id["p1"]["notes"] == []


def test_every_too_small_payment_is_reported(client: TestClient) -> None:
    second = {**CARD, "id": "cc2", "monthly_payment": "50"}
    response = client.post(
        "/api/debts", json={"debts": [{**CARD, "monthly_payment": "100"}, second]}
    )
    assert response.status_code == 422
    found = errors(response.json())
    assert found["debts[0].monthly_payment"]["min_interest"] == "100.00"
    assert found["debts[1].monthly_payment"]["min_interest"] == "100.00"


def test_compare_with_a_credit_card(client: TestClient) -> None:
    response = client.post(
        "/api/strategies/compare", json={"debts": [*THREE, CARD], "extra_monthly": "300"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["avalanche"]["total_interest"] == "5950.62"
    assert body["snowball"]["total_interest"] == "6384.27"
    card = next(d for d in body["avalanche"]["debts"] if d["id"] == "cc")
    assert len(card["notes"]) == 4
