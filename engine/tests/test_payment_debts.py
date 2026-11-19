"""Spec 3b: payment-based debts and more categories.

Expected values for cases P-X are copied from the spec's test-case table. They are not
generated from this code. Per the spec they must be hand-verified before merge.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from money_trees_engine.amortization import (
    MAX_TERM_MONTHS,
    AmortizationResult,
    LoanInputError,
    LumpSum,
    PaymentMode,
    PaymentTooSmallError,
    amortize,
    amortize_payment,
)
from money_trees_engine.debts import (
    CATEGORIES,
    CREDIT_CARD_NOTES,
    Debt,
    DebtCategory,
    DebtInputError,
    analyze_debts,
    notes_for_category,
)
from money_trees_engine.strategies import run_strategy

D = Decimal

PERSONAL = Debt("p1", "Personal loan", "personal", D("3000"), D("0.04"), 24)
CAR = Debt("c1", "Car loan", "auto", D("15000"), D("0.09"), 60)
STUDENT = Debt("s1", "Student loan", "student", D("20000"), D("0.06"), 120)
CARD = Debt(
    "cc",
    "Credit card",
    "credit_card",
    D("5000"),
    D("0.24"),
    None,
    payment_mode="fixed_payment",
    monthly_payment=D("200"),
)
FOUR = (PERSONAL, CAR, STUDENT, CARD)


def assert_invariants(result: AmortizationResult) -> None:
    schedule = result.schedule
    principal = result.assumptions.principal
    assert len(schedule) <= MAX_TERM_MONTHS
    assert schedule[0].starting_balance == principal
    for current, following in zip(schedule, schedule[1:], strict=False):
        assert current.ending_balance == following.starting_balance
    assert schedule[-1].ending_balance == D("0.00")
    assert all(row.ending_balance >= 0 for row in schedule)
    paid = sum((r.scheduled_principal + r.extra_principal for r in schedule), D("0"))
    assert paid == principal
    assert result.summary.total_paid == principal + result.summary.total_interest
    for row in schedule[:-1]:
        assert row.total_payment == result.summary.regular_payment + row.extra_principal


# --- Cases P-U: fixed_payment mode ----------------------------------------------------


def test_case_p_credit_card() -> None:
    result = amortize_payment(D("5000"), D("0.24"), D("200"))
    assert_invariants(result)
    assert result.schedule[0].interest == D("100.00")
    assert result.schedule[0].scheduled_principal == D("100.00")
    assert result.summary.payoff_month == 36
    assert result.schedule[-1].total_payment == D("0.57")
    assert result.summary.total_interest == D("2000.57")
    assert result.summary.regular_payment == D("200")


def test_case_q_smaller_payment() -> None:
    result = amortize_payment(D("5000"), D("0.24"), D("150"))
    assert_invariants(result)
    assert result.summary.payoff_month == 56
    assert result.schedule[-1].total_payment == D("72.17")
    assert result.summary.total_interest == D("3322.17")


def test_case_r_medical_plan() -> None:
    result = amortize_payment(D("2400"), D("0"), D("100"))
    assert_invariants(result)
    assert len(result.schedule) == 24
    assert all(row.total_payment == D("100.00") for row in result.schedule)
    assert result.summary.total_interest == D("0.00")


def test_case_s_rounding_without_a_term() -> None:
    result = amortize_payment(D("200000"), D("0.06"), D("1199.10"))
    assert_invariants(result)
    assert result.summary.payoff_month == 361
    assert result.schedule[-1].total_payment == D("1.05")
    assert result.summary.total_interest == D("231677.05")
    # Spec 1 case B absorbs those cents in month 360 instead.
    assert amortize(D("200000"), D("0.06"), 360).summary.payoff_month == 360


@pytest.mark.parametrize("payment", [D("100"), D("99")])
def test_case_t_payment_too_small(payment: Decimal) -> None:
    with pytest.raises(PaymentTooSmallError) as info:
        amortize_payment(D("5000"), D("0.24"), payment)
    assert info.value.field == "monthly_payment"
    assert info.value.min_interest == D("100.00")
    assert "doesn't cover the monthly interest" in str(info.value)


def test_case_u_over_50_years() -> None:
    with pytest.raises(LoanInputError) as info:
        amortize_payment(D("10000"), D("0.03"), D("25.50"))
    assert info.value.field == "monthly_payment"
    assert str(info.value) == "At this payment, this would take more than 50 years to pay off."


# --- fixed_payment behaviour ------------------------------------------------------------


def test_extras_shorten_a_fixed_payment_debt() -> None:
    base = amortize_payment(D("5000"), D("0.24"), D("200"))
    extra = amortize_payment(
        D("5000"), D("0.24"), D("200"), D("50"), [LumpSum(3, D("500")), LumpSum(600, D("1"))]
    )
    assert_invariants(extra)
    assert extra.summary.payoff_month < base.summary.payoff_month
    assert extra.summary.months_saved == base.summary.payoff_month - extra.summary.payoff_month
    assert (
        extra.summary.interest_saved == base.summary.total_interest - extra.summary.total_interest
    )
    assert base.summary.interest_saved is None


def test_payoff_in_first_month() -> None:
    result = amortize_payment(D("150"), D("0.12"), D("200"))
    assert_invariants(result)
    assert len(result.schedule) == 1
    assert result.schedule[0].total_payment == D("151.50")


def test_payment_one_cent_over_interest_still_pays_off() -> None:
    # Interest shrinks as the balance drops, so even one cent over still ends in time.
    result = amortize_payment(D("5000"), D("0.24"), D("100.01"))
    assert_invariants(result)
    assert result.summary.payoff_month <= MAX_TERM_MONTHS


def test_assumptions_record_the_mode() -> None:
    a = amortize_payment(D("5000"), D("0.24"), D("200")).assumptions
    assert a.payment_mode is PaymentMode.FIXED_PAYMENT
    assert a.monthly_payment == D("200")
    assert a.term_months is None
    assert amortize(D("1000"), D("0.12"), 12).assumptions.payment_mode is PaymentMode.FIXED_TERM


@pytest.mark.parametrize(
    ("args", "field"),
    [
        ((D("0"), D("0.24"), D("200")), "principal"),
        ((D("5000"), D("1"), D("200")), "annual_rate"),
        ((D("5000"), D("0.24"), D("0")), "monthly_payment"),
        ((D("5000"), D("0.24"), D("-5")), "monthly_payment"),
    ],
)
def test_fixed_payment_validation(args: tuple[Decimal, Decimal, Decimal], field: str) -> None:
    with pytest.raises(LoanInputError) as info:
        amortize_payment(*args)
    assert info.value.field == field


def test_lump_sum_month_limit_is_600() -> None:
    with pytest.raises(LoanInputError) as info:
        amortize_payment(D("5000"), D("0.24"), D("200"), lump_sums=[LumpSum(601, D("1"))])
    assert info.value.field == "lump_sums"


# --- Categories and notes ---------------------------------------------------------------


def test_category_table() -> None:
    table = {
        c.value: (i.label, i.default_mode.value, i.suggested_term_months)
        for c, i in CATEGORIES.items()
    }
    assert table == {
        "mortgage": ("Mortgage", "fixed_term", 360),
        "auto": ("Car loan", "fixed_term", 60),
        "student": ("Student loan", "fixed_term", 120),
        "personal": ("Personal loan", "fixed_term", 36),
        "credit_card": ("Credit card", "fixed_payment", None),
        "medical": ("Medical debt", "fixed_payment", None),
        "family_friend": ("Loan from family or friends", "fixed_payment", None),
        "tax": ("Tax debt", "fixed_payment", None),
        "other": ("Other", "fixed_payment", None),
    }


def test_notes_only_for_credit_cards() -> None:
    assert len(CREDIT_CARD_NOTES) == 4
    assert notes_for_category(DebtCategory.CREDIT_CARD) == CREDIT_CARD_NOTES
    assert notes_for_category("credit_card") == CREDIT_CARD_NOTES
    assert notes_for_category("medical") == ()
    result = analyze_debts(FOUR)
    assert {d.id: len(d.notes) for d in result.debts} == {"p1": 0, "c1": 0, "s1": 0, "cc": 4}


def test_any_category_can_use_either_mode() -> None:
    card_by_term = Debt("x", "Card plan", "credit_card", D("5000"), D("0.24"), 36)
    loan_by_payment = replace(
        CAR, term_months=None, payment_mode="fixed_payment", monthly_payment=D("400")
    )
    result = analyze_debts([card_by_term, loan_by_payment])
    assert [d.payment_mode.value for d in result.debts] == ["fixed_term", "fixed_payment"]


# --- Cases V-X: strategies with a credit card --------------------------------------------


def test_case_v_baseline() -> None:
    result = analyze_debts(FOUR)
    assert result.timeline[0].total_payment == D("863.69")
    assert {d.id: d.result.summary.payoff_month for d in result.debts} == {
        "p1": 24,
        "cc": 36,
        "c1": 60,
        "s1": 120,
    }
    assert result.summary.total_interest == D("12454.63")


def test_case_w_avalanche() -> None:
    result = run_strategy(FOUR, D("300"), "avalanche")
    assert result.priority_order == ("cc", "c1", "s1", "p1")
    assert {p.id: p.payoff_month for p in result.debts} == {"cc": 12, "p1": 24, "c1": 28, "s1": 43}
    assert result.total_interest == D("5950.62")
    assert result.interest_saved == D("6504.01")
    assert result.months_saved == 77
    assert result.baseline.summary.total_interest == D("12454.63")


def test_case_x_snowball() -> None:
    result = run_strategy(FOUR, D("300"), "snowball")
    assert result.priority_order == ("p1", "cc", "c1", "s1")
    assert {p.id: p.payoff_month for p in result.debts} == {"p1": 8, "cc": 15, "c1": 28, "s1": 43}
    assert result.total_interest == D("6384.27")
    assert result.interest_saved == D("6070.36")
    assert result.months_saved == 77


def test_strategy_results_carry_credit_card_notes() -> None:
    result = run_strategy(FOUR, D("300"), "avalanche")
    assert {p.id: len(p.notes) for p in result.debts} == {"p1": 0, "c1": 0, "s1": 0, "cc": 4}


# --- Debt validation --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("debt", "field"),
    [
        (replace(CARD, monthly_payment=None), "monthly_payment"),
        (replace(CARD, term_months=36), "term_months"),
        (replace(CAR, monthly_payment=D("300")), "monthly_payment"),
        (replace(CARD, monthly_payment=D("0")), "monthly_payment"),
        (replace(CARD, monthly_payment=D("-1")), "monthly_payment"),
        (replace(CARD, payment_mode="minimum_payment"), "payment_mode"),
        (replace(CAR, term_months=None), "term_months"),
        (replace(CARD, monthly_payment=D("100")), "monthly_payment"),
    ],
)
def test_debt_mode_validation(debt: Debt, field: str) -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([PERSONAL, debt])
    assert (info.value.debt_id, info.value.field) == (debt.id, field)


def test_payment_too_small_keeps_min_interest_through_debts() -> None:
    with pytest.raises(DebtInputError) as info:
        analyze_debts([replace(CARD, monthly_payment=D("100"))])
    cause = info.value.__cause__
    assert isinstance(cause, PaymentTooSmallError)
    assert cause.min_interest == D("100.00")
