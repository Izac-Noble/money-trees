"""Spec 7a: POST /api/household and the household lists in /api/meta."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient

from money_trees_api import serialize
from money_trees_api.main import create_app
from money_trees_api.settings import Settings
from money_trees_engine.debts import Debt
from money_trees_engine.household import (
    Asset,
    Expense,
    Household,
    Income,
    Person,
    analyze_household,
)

D = Decimal
J = "joint"

H2_EXPENSES = [
    ("housing", "1500", "monthly"),
    ("utilities", "180", "monthly"),
    ("phone", "120", "monthly"),
    ("internet", "70", "monthly"),
    ("insurance", "1200", "semiannual"),
    ("groceries", "600", "monthly"),
    ("gas", "250", "monthly"),
    ("eating_out", "300", "monthly"),
    ("miscellaneous", "150", "monthly"),
    ("giving", "400", "monthly"),
    ("emergency_fund", "300", "monthly"),
]
H2_JSON: dict[str, Any] = {
    "household_type": "couple",
    "people": [{"id": "p1", "name": "Sam"}, {"id": "p2", "name": "Alex"}],
    "incomes": [
        {
            "id": "i1",
            "label": "Sam's job",
            "owner": "p1",
            "amount": "2000",
            "frequency": "biweekly",
        },
        {
            "id": "i2",
            "label": "Alex's job",
            "owner": "p2",
            "amount": "1800",
            "frequency": "semimonthly",
        },
        {
            "id": "i3",
            "label": "Alex's side job",
            "owner": "p2",
            "amount": "150",
            "frequency": "weekly",
        },
    ],
    "expenses": [
        {"id": f"e{i}", "category": c, "owner": J, "amount": a, "frequency": f}
        for i, (c, a, f) in enumerate(H2_EXPENSES)
    ],
    "assets": [
        {"id": "a1", "type": "cash", "owner": J, "value": "4000"},
        {"id": "a2", "type": "emergency_fund", "owner": J, "value": "6000"},
        {"id": "a3", "type": "retirement", "owner": "p1", "value": "15000"},
        {"id": "a4", "type": "retirement", "owner": "p2", "value": "10000"},
        {"id": "a5", "type": "vehicle", "owner": J, "value": "18000"},
    ],
    "debts": [
        {
            "id": "pl",
            "name": "Personal loan",
            "category": "personal",
            "owner": "p1",
            "principal": "3000",
            "annual_rate": "0.04",
            "term_months": 24,
        },
        {
            "id": "car",
            "name": "Car loan",
            "category": "auto",
            "owner": J,
            "principal": "15000",
            "annual_rate": "0.09",
            "term_months": 60,
        },
        {
            "id": "stu",
            "name": "Student loan",
            "category": "student",
            "owner": "p2",
            "principal": "20000",
            "annual_rate": "0.06",
            "term_months": 120,
        },
        {
            "id": "cc",
            "name": "Credit card",
            "category": "credit_card",
            "owner": "p1",
            "payment_mode": "fixed_payment",
            "principal": "5000",
            "annual_rate": "0.24",
            "monthly_payment": "200",
        },
    ],
}
H2_ENGINE = Household(
    "couple",
    (Person("p1", "Sam"), Person("p2", "Alex")),
    incomes=(
        Income("i1", "Sam's job", "p1", D("2000"), "biweekly"),
        Income("i2", "Alex's job", "p2", D("1800"), "semimonthly"),
        Income("i3", "Alex's side job", "p2", D("150"), "weekly"),
    ),
    expenses=tuple(Expense(f"e{i}", c, J, D(a), f) for i, (c, a, f) in enumerate(H2_EXPENSES)),
    assets=(
        Asset("a1", "cash", J, D("4000")),
        Asset("a2", "emergency_fund", J, D("6000")),
        Asset("a3", "retirement", "p1", D("15000")),
        Asset("a4", "retirement", "p2", D("10000")),
        Asset("a5", "vehicle", J, D("18000")),
    ),
    debts=(
        Debt("pl", "Personal loan", "personal", D("3000"), D("0.04"), 24, owner="p1"),
        Debt("car", "Car loan", "auto", D("15000"), D("0.09"), 60, owner=J),
        Debt("stu", "Student loan", "student", D("20000"), D("0.06"), 120, owner="p2"),
        Debt(
            "cc",
            "Credit card",
            "credit_card",
            D("5000"),
            D("0.24"),
            None,
            payment_mode="fixed_payment",
            monthly_payment=D("200"),
            owner="p1",
        ),
    ),
)

H4_EXPENSES = [
    ("housing", "1400", "monthly"),
    ("utilities", "150", "monthly"),
    ("phone", "80", "monthly"),
    ("internet", "60", "monthly"),
    ("insurance", "600", "yearly"),
    ("groceries", "450", "monthly"),
    ("gas", "200", "monthly"),
    ("eating_out", "350", "monthly"),
    ("miscellaneous", "200", "monthly"),
    ("giving", "100", "monthly"),
    ("credit_cards", "250", "monthly"),
]
H4_JSON: dict[str, Any] = {
    "household_type": "single",
    "people": [{"id": "p1", "name": "Jordan"}],
    "incomes": [
        {"id": "i1", "label": "Pay", "owner": "p1", "amount": "1500", "frequency": "biweekly"}
    ],
    "expenses": [
        {"id": f"e{i}", "category": c, "owner": "p1", "amount": a, "frequency": f}
        for i, (c, a, f) in enumerate(H4_EXPENSES)
    ],
    "assets": [{"id": "a1", "type": "cash", "owner": "p1", "value": "1200"}],
}
H4_ENGINE = Household(
    "single",
    (Person("p1", "Jordan"),),
    incomes=(Income("i1", "Pay", "p1", D("1500"), "biweekly"),),
    expenses=tuple(Expense(f"e{i}", c, "p1", D(a), f) for i, (c, a, f) in enumerate(H4_EXPENSES)),
    assets=(Asset("a1", "cash", "p1", D("1200")),),
)

MONEY = re.compile(r"^-?\d+\.\d{2}$")
RATIO = re.compile(r"^\d+\.\d$")


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(app_env="test")))


def errors(body: dict[str, Any]) -> dict[str | None, str]:
    return {e["field"]: e["message"] for e in body["errors"]}


def test_case_h2_matches_engine(client: TestClient) -> None:
    response = client.post("/api/household", json=H2_JSON)
    assert response.status_code == 200
    body = response.json()
    assert body == {
        "engine_version": "0.1.0",
        **serialize.household(analyze_household(H2_ENGINE)),
    }
    assert body["totals"] == {
        "income": "8583.33",
        "spending": "3770.00",
        "debt_payments": "863.69",
        "saving": "300.00",
        "total_out": "4933.69",
        "left_over": "3649.64",
    }
    assert body["ratios"] == {
        "debt_payments_pct": "10.1",
        "housing_pct": "17.5",
        "savings_rate_pct": "3.5",
        "emergency_fund_months": "1.3",
    }
    assert body["net_worth"]["net_worth"] == "10000.00"
    assert body["by_owner"]["p1"]["debt_payments"] == "330.27"
    assert body["by_owner"]["joint"]["assets"] == "28000.00"
    for value in body["totals"].values():
        assert MONEY.match(value)
    for value in body["ratios"].values():
        assert RATIO.match(value)


def test_case_h4_matches_engine(client: TestClient) -> None:
    body = client.post("/api/household", json=H4_JSON).json()
    assert body == {
        "engine_version": "0.1.0",
        **serialize.household(analyze_household(H4_ENGINE)),
    }
    assert body["totals"]["left_over"] == "-40.00"
    assert body["ratios"]["housing_pct"] == "43.1"
    assert body["by_owner"] is None
    assert any("entered only as a monthly payment" in note for note in body["notes"])


def test_ratios_are_null_with_no_income(client: TestClient) -> None:
    body = client.post(
        "/api/household",
        json={"household_type": "single", "people": [{"id": "p1", "name": "Kim"}]},
    ).json()
    assert body["ratios"] == {
        "debt_payments_pct": None,
        "housing_pct": None,
        "savings_rate_pct": None,
        "emergency_fund_months": None,
    }


def test_hand_entered_car_payment_conflicts_with_a_car_loan(client: TestClient) -> None:
    payload = {
        **H2_JSON,
        "expenses": [
            *H2_JSON["expenses"],
            {
                "id": "dup",
                "category": "car_payment",
                "owner": J,
                "amount": "300",
                "frequency": "monthly",
            },
        ],
    }
    response = client.post("/api/household", json=payload)
    assert response.status_code == 422
    assert errors(response.json()) == {
        f"expenses[{len(H2_EXPENSES)}].category": "This is already counted from your Debts tab."
    }


def test_reports_every_invalid_item_with_exact_paths(client: TestClient) -> None:
    payload = {
        "household_type": "single",
        "people": [{"id": "p1", "name": "Jordan"}],
        "incomes": [
            {"id": "i", "label": "Pay", "owner": "p1", "amount": "0", "frequency": "daily"}
        ],
        "expenses": [
            {"id": "a", "category": "phone", "owner": "p1", "amount": "50", "frequency": "monthly"},
            {
                "id": "b",
                "category": "mortgage",
                "owner": "p1",
                "amount": "50",
                "frequency": "monthly",
            },
            {"id": "c", "category": "custom", "owner": "p1", "amount": "5", "frequency": "monthly"},
            {
                "id": "d",
                "category": "gas",
                "owner": "joint",
                "amount": "-1",
                "frequency": "monthly",
            },
        ],
        "assets": [{"id": "x", "type": "boat", "owner": "p1", "value": 100}],
    }
    response = client.post("/api/household", json=payload)
    assert response.status_code == 422
    assert set(errors(response.json())) == {
        "incomes[0].amount",
        "incomes[0].frequency",
        "expenses[1].category",
        "expenses[2].label",
        "expenses[3].owner",
        "expenses[3].amount",
        "assets[0].type",
        "assets[0].value",
    }


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"household_type": "couple", "people": [{"id": "p1", "name": "Sam"}]}, "people"),
        (
            {
                "household_type": "single",
                "people": [{"id": "p1", "name": "Sam"}, {"id": "p2", "name": "Alex"}],
            },
            "people",
        ),
        ({"household_type": "single", "people": [{"id": "p1", "name": " "}]}, "people[0].name"),
        ({"household_type": "trio", "people": []}, "household_type"),
    ],
)
def test_people_validation(client: TestClient, payload: dict[str, Any], field: str) -> None:
    response = client.post("/api/household", json=payload)
    assert response.status_code == 422
    assert field in errors(response.json())


def test_joint_debt_in_single_household(client: TestClient) -> None:
    payload = {**H4_JSON, "expenses": [], "debts": [{**H2_JSON["debts"][1]}]}
    response = client.post("/api/household", json=payload)
    assert response.status_code == 422
    assert "debts[0].owner" in errors(response.json())


def test_too_small_payment_in_household_debts(client: TestClient) -> None:
    card = {**H2_JSON["debts"][3], "monthly_payment": "100"}
    response = client.post("/api/household", json={**H2_JSON, "debts": [card]})
    assert response.status_code == 422
    assert response.json()["errors"][0]["min_interest"] == "100.00"


def test_meta_lists_household_options(client: TestClient) -> None:
    body = client.get("/api/meta").json()
    assert body["household_types"] == [
        {"value": "single", "label": "Just me"},
        {"value": "couple", "label": "Couple"},
    ]
    assert [f["value"] for f in body["frequencies"]] == [
        "weekly",
        "biweekly",
        "semimonthly",
        "monthly",
        "quarterly",
        "semiannual",
        "yearly",
    ]
    assert body["frequencies"][1] == {"value": "biweekly", "label": "Every two weeks"}
    categories = {c["value"]: c for c in body["expense_categories"]}
    assert len(categories) == 18
    assert categories["mortgage"] == {
        "value": "mortgage",
        "label": "Mortgage",
        "group": "housing",
        "enterable": False,
        "from_debts": True,
    }
    assert categories["car_payment"]["enterable"] is True
    assert categories["groceries"]["group"] == "everyday"
    assert [g["value"] for g in body["expense_groups"]] == [
        "housing",
        "debt_payments",
        "bills",
        "everyday",
        "giving",
        "saving",
        "other",
    ]
    assert {t["value"]: t["liquid"] for t in body["asset_types"]} == {
        "cash": True,
        "emergency_fund": True,
        "investments": True,
        "retirement": False,
        "home": False,
        "vehicle": False,
        "other": False,
    }
