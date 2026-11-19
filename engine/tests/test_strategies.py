"""Tests for debt payoff strategies.

Expected values for cases K-O are copied from the spec's test-case table. They are not
generated from this code. Per the spec they must be hand-verified before merge.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from money_trees_engine.amortization import LumpSum
from money_trees_engine.debts import Debt, DebtInputError
from money_trees_engine.strategies import (
    Strategy,
    StrategyResult,
    compare_strategies,
    priority_order,
    run_strategy,
)

D = Decimal

PERSONAL = Debt("p1", "Personal loan", "personal", D("3000"), D("0.04"), 24)
CAR = Debt("c1", "Car loan", "auto", D("15000"), D("0.09"), 60)
STUDENT = Debt("s1", "Student loan", "student", D("20000"), D("0.06"), 120)
THREE = (PERSONAL, CAR, STUDENT)


def payoff_months(result: StrategyResult) -> dict[str, int]:
    return {p.id: p.payoff_month for p in result.debts}


def assert_invariants(result: StrategyResult) -> None:
    budget = result.assumptions.monthly_budget
    baseline = result.baseline.summary
    assert len(result.timeline) == result.debt_free_month
    for row in result.timeline:
        assert row.leftover_applied >= 0
        rows = [p.schedule[row.month - 1] for p in result.debts if row.month <= len(p.schedule)]
        assert row.active_debts == len(rows)
        assert row.total_payment == sum((r.total_payment for r in rows), D("0"))
        assert row.total_interest == sum((r.interest for r in rows), D("0"))
        assert row.total_ending_balance == sum((r.ending_balance for r in rows), D("0"))
        assert row.leftover_applied == sum((r.extra_principal for r in rows), D("0"))
        if row.total_payment > budget:
            # Cents rule: only possible when no leftover was applied that month.
            assert row.leftover_applied == 0
            assert row.total_payment - budget < D("1.00")
    for payoff, debt in zip(result.debts, result.baseline.debts, strict=True):
        schedule = payoff.schedule
        principal = debt.result.assumptions.principal
        assert schedule[0].starting_balance == principal
        for current, following in zip(schedule, schedule[1:], strict=False):
            assert current.ending_balance == following.starting_balance
        assert schedule[-1].ending_balance == D("0.00")
        assert all(r.ending_balance >= 0 for r in schedule)
        assert all(r.ending_balance > 0 for r in schedule[:-1])
        assert sum((r.scheduled_principal + r.extra_principal for r in schedule), D("0")) == (
            principal
        )
        assert payoff.payoff_month <= debt.result.summary.payoff_month
    assert result.timeline[-1].total_ending_balance == D("0.00")
    assert result.total_paid == baseline.total_starting_balance + result.total_interest
    assert result.debt_free_month <= baseline.debt_free_month
    assert result.total_interest <= baseline.total_interest
    assert result.interest_saved == baseline.total_interest - result.total_interest
    assert result.months_saved == baseline.debt_free_month - result.debt_free_month


# --- Spec cases K-O --------------------------------------------------------------------


def test_case_k_avalanche() -> None:
    result = run_strategy(THREE, D("300"), "avalanche")
    assert_invariants(result)
    assert result.priority_order == ("c1", "s1", "p1")
    assert payoff_months(result) == {"p1": 24, "c1": 27, "s1": 45}
    assert result.debt_free_month == 45
    assert result.total_interest == D("5004.74")
    assert result.interest_saved == D("5449.32")
    assert result.months_saved == 75
    assert result.baseline.summary.total_interest == D("10454.06")
    assert result.baseline.summary.debt_free_month == 120


def test_case_l_snowball() -> None:
    result = run_strategy(THREE, D("300"), "snowball")
    assert_invariants(result)
    assert result.priority_order == ("p1", "c1", "s1")
    assert payoff_months(result) == {"p1": 8, "c1": 27, "s1": 45}
    assert result.debt_free_month == 45
    assert result.total_interest == D("5137.11")
    assert result.interest_saved == D("5316.95")
    assert result.months_saved == 75


def test_case_m_comparison() -> None:
    comparison = compare_strategies(THREE, D("300"))
    assert comparison.total_interest_difference == D("132.37")
    assert comparison.debt_free_month_difference == 0
    assert comparison.snowball.first_payoff_month == 8
    assert comparison.avalanche.first_payoff_month == 24
    assert comparison.first_payoff_month_difference == -16


def test_case_n_rollover_only() -> None:
    result = run_strategy(THREE, D("0"), "avalanche")
    assert_invariants(result)
    assert payoff_months(result) == {"p1": 24, "c1": 49, "s1": 70}
    assert result.debt_free_month == 70
    assert result.total_interest == D("8182.56")
    assert result.interest_saved == D("2271.50")
    assert result.months_saved == 50


def test_case_o_custom_matches_avalanche() -> None:
    custom = run_strategy(THREE, D("300"), "custom", ["c1", "s1", "p1"])
    avalanche = run_strategy(THREE, D("300"), "avalanche")
    assert_invariants(custom)
    assert custom.assumptions.strategy is Strategy.CUSTOM
    assert replace(custom, assumptions=avalanche.assumptions) == avalanche


# --- Behaviour -------------------------------------------------------------------------


def test_month_one_of_avalanche() -> None:
    result = run_strategy(THREE, D("300"), "avalanche")
    first = result.timeline[0]
    assert first.total_payment == D("963.69")
    assert first.leftover_applied == D("300.00")
    assert first.leftover_recipients == ("c1",)
    assert result.assumptions.monthly_budget == D("963.69")


def test_leftover_spills_to_next_debt_in_payoff_month() -> None:
    result = run_strategy(THREE, D("300"), "avalanche")
    car_payoff = result.timeline[26]  # month 27
    assert car_payoff.leftover_recipients == ("c1", "s1")
    assert car_payoff.total_payment == D("963.69")


def test_payoff_order_and_first_payoff() -> None:
    avalanche = run_strategy(THREE, D("300"), "avalanche")
    assert avalanche.payoff_order == ("p1", "c1", "s1")
    assert avalanche.first_payoff_month == 24


def test_single_debt_with_no_extra_matches_baseline() -> None:
    result = run_strategy([CAR], D("0"), "snowball")
    assert_invariants(result)
    baseline = result.baseline.debts[0].result
    assert result.debts[0].schedule == baseline.schedule
    assert result.interest_saved == D("0.00")
    assert result.months_saved == 0


def test_large_extra_pays_everything_in_month_one() -> None:
    result = run_strategy(THREE, D("100000"), "avalanche")
    assert_invariants(result)
    assert result.debt_free_month == 1
    assert result.timeline[0].total_ending_balance == D("0.00")
    assert result.timeline[0].total_payment < result.assumptions.monthly_budget


def test_zero_rate_debt() -> None:
    family = Debt("f1", "Family loan", "other", D("1200"), D("0"), 12)
    result = run_strategy([family, PERSONAL], D("50"), "avalanche")
    assert_invariants(result)
    assert result.priority_order == ("p1", "f1")


def test_avalanche_ties_go_to_smaller_balance_then_id() -> None:
    a = Debt("b", "B", "other", D("5000"), D("0.05"), 36)
    b = Debt("a", "A", "other", D("5000"), D("0.05"), 36)
    c = Debt("c", "C", "other", D("1000"), D("0.05"), 36)
    assert priority_order([a, b, c], "avalanche") == ("c", "a", "b")


def test_snowball_ties_go_to_higher_rate_then_id() -> None:
    a = Debt("b", "B", "other", D("5000"), D("0.05"), 36)
    b = Debt("a", "A", "other", D("5000"), D("0.05"), 36)
    c = Debt("c", "C", "other", D("5000"), D("0.08"), 36)
    assert priority_order([a, b, c], "snowball") == ("c", "a", "b")


def test_strategy_enum_is_accepted() -> None:
    assert run_strategy(THREE, D("300"), Strategy.SNOWBALL).priority_order == ("p1", "c1", "s1")


def test_debts_are_returned_in_input_order() -> None:
    result = run_strategy(THREE, D("300"), "avalanche")
    assert [p.id for p in result.debts] == ["p1", "c1", "s1"]


def test_is_deterministic() -> None:
    assert run_strategy(THREE, D("123.45"), "snowball") == run_strategy(
        THREE, D("123.45"), "snowball"
    )


# --- Validation ------------------------------------------------------------------------


def test_rejects_debt_with_its_own_extra() -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy([PERSONAL, replace(CAR, extra_monthly=D("10"))], D("300"), "avalanche")
    assert (info.value.debt_id, info.value.field) == ("c1", "extra_monthly")


def test_rejects_debt_with_lump_sums() -> None:
    bad = replace(STUDENT, lump_sums=(LumpSum(3, D("100")),))
    with pytest.raises(DebtInputError) as info:
        run_strategy([PERSONAL, bad], D("300"), "avalanche")
    assert (info.value.debt_id, info.value.field) == ("s1", "lump_sums")


def test_rejects_negative_extra() -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy(THREE, D("-1"), "avalanche")
    assert info.value.field == "extra_monthly"


def test_rejects_float_extra() -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy(THREE, 300.0, "avalanche")  # type: ignore[arg-type]
    assert info.value.field == "extra_monthly"


@pytest.mark.parametrize(
    ("order", "bad_id"),
    [
        (None, None),
        (["c1", "s1"], "p1"),
        (["c1", "s1", "p1", "x9"], "x9"),
        (["c1", "s1", "c1", "p1"], "c1"),
    ],
)
def test_rejects_bad_custom_order(order: list[str] | None, bad_id: str | None) -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy(THREE, D("300"), "custom", order)
    assert (info.value.debt_id, info.value.field) == (bad_id, "custom_order")


def test_rejects_custom_order_without_custom_strategy() -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy(THREE, D("300"), "avalanche", ["c1", "s1", "p1"])
    assert info.value.field == "custom_order"


@pytest.mark.parametrize("name", ["highest_rate", "", "Avalanche"])
def test_rejects_unknown_strategy(name: str) -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy(THREE, D("300"), name)
    assert info.value.field == "strategy"


def test_spec_2_rules_still_apply() -> None:
    with pytest.raises(DebtInputError) as info:
        run_strategy([replace(CAR, category="car_loan")], D("300"), "avalanche")
    assert (info.value.debt_id, info.value.field) == ("c1", "category")
