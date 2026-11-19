"""Tests for the debts list.

Expected values for cases G-J are copied from the spec's test-case table. They are not
generated from this code. Per the spec they must be hand-verified before merge.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from money_trees_engine.amortization import LumpSum, amortize
from money_trees_engine.debts import (
    MAX_DEBTS,
    SUGGESTED_TERM_MONTHS,
    Debt,
    DebtCategory,
    DebtInputError,
    DebtsResult,
    analyze_debts,
)

D = Decimal

PERSONAL = Debt("p1", "Personal loan", "personal", D("3000"), D("0.04"), 24)
CAR = Debt("c1", "Car loan", "auto", D("15000"), D("0.09"), 60)
STUDENT = Debt("s1", "Student loan", "student", D("20000"), D("0.06"), 120)
THREE = (PERSONAL, CAR, STUDENT)


def assert_invariants(result: DebtsResult) -> None:
    timeline = result.timeline
    summary = result.summary
    assert len(timeline) == summary.debt_free_month
    assert summary.debt_free_month == max(d.result.summary.payoff_month for d in result.debts)
    assert [row.month for row in timeline] == list(range(1, len(timeline) + 1))
    for row in timeline:
        matching = [
            d.result.schedule[row.month - 1]
            for d in result.debts
            if row.month <= len(d.result.schedule)
        ]
        assert row.active_debts == len(matching)
        assert row.total_payment == sum((r.total_payment for r in matching), D("0"))
        assert row.total_interest == sum((r.interest for r in matching), D("0"))
        assert row.total_ending_balance == sum((r.ending_balance for r in matching), D("0"))
    assert timeline[-1].total_ending_balance == D("0.00")
    assert summary.total_interest == sum(
        (d.result.summary.total_interest for d in result.debts), D("0")
    )
    assert summary.total_interest == sum((row.total_interest for row in timeline), D("0"))
    assert summary.total_paid == summary.total_starting_balance + summary.total_interest
    assert summary.debt_count == len(result.debts)


# --- Spec cases G-J --------------------------------------------------------------------


def test_case_g_three_debts() -> None:
    result = analyze_debts(THREE)
    assert_invariants(result)
    by_id = {d.id: d.result.summary for d in result.debts}
    assert by_id["p1"].regular_payment == D("130.27")
    assert by_id["c1"].regular_payment == D("311.38")
    assert by_id["s1"].regular_payment == D("222.04")
    assert result.timeline[0].total_payment == D("663.69")
    assert result.summary.total_regular_payment == D("663.69")
    assert [by_id[i].payoff_month for i in ("p1", "c1", "s1")] == [24, 60, 120]
    assert by_id["p1"].total_interest == D("126.58")
    assert by_id["c1"].total_interest == D("3682.46")
    assert by_id["s1"].total_interest == D("6645.02")
    assert result.summary.total_interest == D("10454.06")
    assert result.summary.debt_free_month == 120
    assert result.summary.debt_count == 3
    assert result.summary.total_starting_balance == D("38000")


def test_case_h_timeline_drop() -> None:
    result = analyze_debts(THREE)
    month_25 = result.timeline[24]
    assert month_25.active_debts == 2
    assert month_25.total_payment == D("533.42")
    month_61 = result.timeline[60]
    assert month_61.active_debts == 1
    assert month_61.total_payment == D("222.04")


def test_case_i_one_debt_matches_spec_1_case_b() -> None:
    mortgage = Debt("m1", "Home", "mortgage", D("200000"), D("0.06"), 360)
    result = analyze_debts([mortgage])
    assert_invariants(result)
    spec_1 = amortize(D("200000"), D("0.06"), 360)
    assert result.debts[0].result == spec_1
    assert result.summary.total_interest == spec_1.summary.total_interest == D("231677.04")
    assert result.summary.total_regular_payment == D("1199.10")
    assert result.summary.debt_free_month == 360
    for row, spec_row in zip(result.timeline, spec_1.schedule, strict=True):
        assert row.total_payment == spec_row.total_payment
        assert row.total_interest == spec_row.interest
        assert row.total_ending_balance == spec_row.ending_balance


def test_case_j_by_category() -> None:
    result = analyze_debts(THREE)
    assert list(result.by_category) == [
        DebtCategory.AUTO,
        DebtCategory.STUDENT,
        DebtCategory.PERSONAL,
    ]
    personal = result.by_category[DebtCategory.PERSONAL]
    assert (personal.starting_balance, personal.total_interest) == (D("3000"), D("126.58"))
    auto = result.by_category[DebtCategory.AUTO]
    assert (auto.starting_balance, auto.total_interest) == (D("15000"), D("3682.46"))
    student = result.by_category[DebtCategory.STUDENT]
    assert (student.starting_balance, student.total_interest) == (D("20000"), D("6645.02"))


# --- Behaviour -------------------------------------------------------------------------


def test_per_debt_output_carries_identity() -> None:
    result = analyze_debts(THREE)
    assert [(d.id, d.name, d.category) for d in result.debts] == [
        ("p1", "Personal loan", DebtCategory.PERSONAL),
        ("c1", "Car loan", DebtCategory.AUTO),
        ("s1", "Student loan", DebtCategory.STUDENT),
    ]


def test_each_debt_is_independent_of_the_others() -> None:
    together = analyze_debts(THREE)
    for debt, combined in zip(THREE, together.debts, strict=True):
        alone = analyze_debts([debt]).debts[0]
        assert combined.result == alone.result


def test_extras_stay_on_their_own_debt() -> None:
    car_with_extra = replace(CAR, extra_monthly=D("100"), lump_sums=(LumpSum(3, D("500")),))
    result = analyze_debts([PERSONAL, car_with_extra, STUDENT])
    assert_invariants(result)
    base = analyze_debts(THREE)
    assert result.debts[0].result == base.debts[0].result
    assert result.debts[2].result == base.debts[2].result
    assert result.debts[1].result.summary.payoff_month < 60


def test_same_category_is_summed() -> None:
    second_car = Debt("c2", "Second car", "auto", D("5000"), D("0.05"), 36)
    result = analyze_debts([CAR, second_car])
    assert_invariants(result)
    auto = result.by_category[DebtCategory.AUTO]
    assert auto.starting_balance == D("20000")
    assert auto.total_interest == sum(
        (d.result.summary.total_interest for d in result.debts), D("0")
    )


def test_category_enum_is_accepted() -> None:
    result = analyze_debts([replace(PERSONAL, category=DebtCategory.OTHER)])
    assert result.debts[0].category is DebtCategory.OTHER


def test_twenty_debts_allowed() -> None:
    debts = [replace(PERSONAL, id=f"d{i}") for i in range(MAX_DEBTS)]
    result = analyze_debts(debts)
    assert_invariants(result)
    assert result.summary.debt_count == MAX_DEBTS


def test_zero_rate_and_one_month_debts_mix() -> None:
    debts = [
        Debt("z", "Family loan", "other", D("1200"), D("0"), 12),
        Debt("o", "Tiny loan", "personal", D("1000"), D("0.12"), 1),
    ]
    result = analyze_debts(debts)
    assert_invariants(result)
    assert result.timeline[0].active_debts == 2
    assert result.timeline[1].active_debts == 1


def test_suggested_terms() -> None:
    assert dict(SUGGESTED_TERM_MONTHS) == {
        DebtCategory.MORTGAGE: 360,
        DebtCategory.AUTO: 60,
        DebtCategory.STUDENT: 120,
        DebtCategory.PERSONAL: 36,
        DebtCategory.OTHER: None,
    }


def test_credit_card_is_not_a_category() -> None:
    assert "credit_card" not in {c.value for c in DebtCategory}


# --- Validation ------------------------------------------------------------------------


def test_rejects_empty_list() -> None:
    with pytest.raises(DebtInputError, match="at least one debt"):
        analyze_debts([])


def test_rejects_more_than_twenty() -> None:
    debts = [replace(PERSONAL, id=f"d{i}") for i in range(MAX_DEBTS + 1)]
    with pytest.raises(DebtInputError, match="at most 20"):
        analyze_debts(debts)


def test_rejects_duplicate_id() -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([PERSONAL, replace(CAR, id="p1")])
    assert (info.value.debt_id, info.value.field) == ("p1", "id")


def test_rejects_blank_id() -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([replace(PERSONAL, id="  ")])
    assert info.value.field == "id"


@pytest.mark.parametrize("category", ["credit_card", "boat", "", "Auto"])
def test_rejects_unknown_category(category: str) -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([PERSONAL, replace(CAR, category=category)])
    assert (info.value.debt_id, info.value.field) == ("c1", "category")


@pytest.mark.parametrize("name", ["", "   ", "x" * 61])
def test_rejects_bad_name(name: str) -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([replace(STUDENT, name=name)])
    assert (info.value.debt_id, info.value.field) == ("s1", "name")


def test_accepts_sixty_character_name() -> None:
    analyze_debts([replace(STUDENT, name="x" * 60)])


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"principal": D("0")}, "principal"),
        ({"annual_rate": D("1")}, "annual_rate"),
        ({"term_months": 601}, "term_months"),
        ({"extra_monthly": D("-1")}, "extra_monthly"),
        ({"lump_sums": (LumpSum(61, D("100")),)}, "lump_sums"),
        ({"principal": 15000.0}, "principal"),
    ],
)
def test_spec_1_errors_name_the_debt(changes: dict[str, object], field: str) -> None:
    bad_car = replace(CAR, **changes)  # type: ignore[arg-type]
    with pytest.raises(DebtInputError) as info:
        analyze_debts([PERSONAL, bad_car, STUDENT])
    assert (info.value.debt_id, info.value.field) == ("c1", field)
    assert "c1" in str(info.value)
