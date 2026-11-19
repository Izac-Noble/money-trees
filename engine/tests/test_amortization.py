"""Tests for the amortization schedule.

Expected values for cases A-F are copied from the spec's test-case table. They are not
generated from this code. Per the spec they must be hand-verified before merge.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from money_trees_engine.amortization import (
    AmortizationResult,
    LumpSum,
    amortize,
    regular_payment,
)

D = Decimal
NO_EXTRA = Decimal("0")


def case_b(
    extra_monthly: Decimal = NO_EXTRA, lump_sums: tuple[LumpSum, ...] = ()
) -> AmortizationResult:
    """Spec case B: $200,000 at 6% over 360 months, with optional extras."""
    return amortize(D("200000"), D("0.06"), 360, extra_monthly, lump_sums)


def assert_invariants(result: AmortizationResult) -> None:
    schedule = result.schedule
    principal = result.assumptions.principal
    assert schedule, "schedule must have at least one row"
    assert result.assumptions.term_months is not None
    assert len(schedule) <= result.assumptions.term_months
    assert [row.month for row in schedule] == list(range(1, len(schedule) + 1))
    assert schedule[0].starting_balance == principal
    for current, following in zip(schedule, schedule[1:], strict=False):
        assert current.ending_balance == following.starting_balance
    assert schedule[-1].ending_balance == D("0.00")
    for row in schedule:
        assert row.starting_balance >= 0
        assert row.ending_balance >= 0
        assert row.total_payment == row.interest + row.scheduled_principal + row.extra_principal
        assert row.ending_balance == (
            row.starting_balance - row.scheduled_principal - row.extra_principal
        )
        for amount in (
            row.starting_balance,
            row.interest,
            row.scheduled_principal,
            row.extra_principal,
            row.total_payment,
            row.ending_balance,
        ):
            assert amount == amount.quantize(D("0.01"))
    principal_paid = sum(
        (row.scheduled_principal + row.extra_principal for row in schedule), D("0")
    )
    assert principal_paid == principal
    summary = result.summary
    assert summary.payoff_month == len(schedule)
    assert summary.total_paid == principal + summary.total_interest


# --- Spec cases A-F --------------------------------------------------------------------


def test_case_a_small_loan() -> None:
    result = amortize(D("1000"), D("0.12"), 12)
    assert_invariants(result)
    assert result.summary.regular_payment == D("88.85")
    first = result.schedule[0]
    assert first.interest == D("10.00")
    assert first.scheduled_principal == D("78.85")
    assert first.ending_balance == D("921.15")
    assert result.schedule[-1].total_payment == D("88.84")
    assert result.summary.total_interest == D("66.19")


def test_case_b_typical_mortgage() -> None:
    result = case_b()
    assert_invariants(result)
    assert result.summary.regular_payment == D("1199.10")
    assert result.schedule[0].interest == D("1000.00")
    assert result.schedule[0].scheduled_principal == D("199.10")
    assert result.schedule[1].interest == D("999.00")
    assert result.summary.payoff_month == 360
    assert result.schedule[-1].total_payment == D("1200.14")
    assert result.summary.total_interest == D("231677.04")
    assert result.summary.interest_saved is None
    assert result.summary.months_saved is None


def test_case_c_zero_interest() -> None:
    result = amortize(D("12000"), D("0"), 12)
    assert_invariants(result)
    assert result.summary.regular_payment == D("1000.00")
    assert all(row.interest == D("0.00") for row in result.schedule)
    assert result.summary.total_interest == D("0.00")


def test_case_d_one_month() -> None:
    result = amortize(D("1000"), D("0.12"), 1)
    assert_invariants(result)
    assert len(result.schedule) == 1
    assert result.schedule[0].total_payment == D("1010.00")
    assert result.schedule[0].interest == D("10.00")


def test_case_e_extra_monthly() -> None:
    result = case_b(extra_monthly=D("200"))
    assert_invariants(result)
    assert result.summary.payoff_month == 252
    assert result.summary.months_saved == 108
    assert result.summary.total_interest == D("151876.18")
    assert result.summary.interest_saved == D("79800.86")


def test_case_f_lump_sum() -> None:
    result = case_b(lump_sums=(LumpSum(12, D("10000")),))
    assert_invariants(result)
    assert result.summary.payoff_month == 318
    assert result.summary.months_saved == 42
    assert result.summary.total_interest == D("190632.68")
    assert result.summary.interest_saved == D("41044.36")


# --- Behaviour rules -------------------------------------------------------------------


def test_extra_payments_never_change_regular_payment() -> None:
    base = case_b()
    extra = case_b(extra_monthly=D("500"), lump_sums=(LumpSum(1, D("5000")),))
    assert extra.summary.regular_payment == base.summary.regular_payment
    assert_invariants(extra)


def test_lump_sums_in_same_month_add_together() -> None:
    split = case_b(
        lump_sums=(
            LumpSum(12, D("4000")),
            LumpSum(12, D("6000")),
        )
    )
    single = case_b(lump_sums=(LumpSum(12, D("10000")),))
    assert split.schedule == single.schedule
    assert split.schedule[11].extra_principal == D("10000.00")


def test_lump_sum_after_payoff_is_ignored() -> None:
    early = case_b(extra_monthly=D("200"))
    with_late_lump = case_b(extra_monthly=D("200"), lump_sums=(LumpSum(300, D("1")),))
    assert with_late_lump.schedule == early.schedule
    assert_invariants(with_late_lump)


def test_payoff_in_first_month_from_lump_sum() -> None:
    result = case_b(lump_sums=(LumpSum(1, D("250000")),))
    assert_invariants(result)
    assert len(result.schedule) == 1
    row = result.schedule[0]
    assert row.total_payment == D("200000.00") + row.interest
    assert result.summary.months_saved == 359


def test_payment_rounding_is_half_up() -> None:
    # A 0% loan makes the payment exactly principal / term: 0.25 / 2 = 0.125.
    # HALF_UP gives 0.13; Python's default HALF_EVEN would give 0.12.
    assert regular_payment(D("0.25"), D("0"), 2) == D("0.13")


def test_zero_rate_with_uneven_split_still_balances() -> None:
    result = amortize(D("100"), D("0"), 3)
    assert_invariants(result)
    assert result.summary.regular_payment == D("33.33")
    assert result.schedule[-1].total_payment == D("33.34")


def test_very_long_horizon() -> None:
    result = amortize(D("500000"), D("0.07"), 600)
    assert_invariants(result)
    assert result.summary.payoff_month == 600


def test_assumptions_are_returned() -> None:
    lumps = (LumpSum(12, D("10000")),)
    result = case_b(extra_monthly=D("200"), lump_sums=lumps)
    a = result.assumptions
    assert a.principal == D("200000")
    assert a.annual_rate == D("0.06")
    assert a.monthly_rate == D("0.005")
    assert a.term_months == 360
    assert a.extra_monthly == D("200")
    assert a.lump_sums == tuple(lumps)


def test_is_deterministic() -> None:
    assert case_b(extra_monthly=D("123.45")) == case_b(extra_monthly=D("123.45"))


# --- Validation ------------------------------------------------------------------------


@pytest.mark.parametrize("principal", [D("0"), D("-1")])
def test_rejects_non_positive_principal(principal: Decimal) -> None:
    with pytest.raises(ValueError, match="principal"):
        amortize(principal, D("0.06"), 360)


@pytest.mark.parametrize("rate", [D("-0.01"), D("1"), D("1.5")])
def test_rejects_rate_out_of_range(rate: Decimal) -> None:
    with pytest.raises(ValueError, match="annual_rate"):
        amortize(D("1000"), rate, 12)


@pytest.mark.parametrize("term", [0, -1, 601])
def test_rejects_term_out_of_range(term: int) -> None:
    with pytest.raises(ValueError, match="term_months"):
        amortize(D("1000"), D("0.06"), term)


def test_rejects_negative_extra_monthly() -> None:
    with pytest.raises(ValueError, match="extra_monthly"):
        case_b(extra_monthly=D("-1"))


@pytest.mark.parametrize(
    "lump",
    [LumpSum(0, D("100")), LumpSum(361, D("100")), LumpSum(12, D("0")), LumpSum(12, D("-5"))],
)
def test_rejects_bad_lump_sum(lump: LumpSum) -> None:
    with pytest.raises(ValueError, match="lump sum"):
        case_b(lump_sums=(lump,))


def test_rejects_float_money() -> None:
    with pytest.raises(TypeError, match="principal"):
        amortize(1000.0, D("0.06"), 12)  # type: ignore[arg-type]
