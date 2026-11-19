"""Fixed-rate amortization schedules with extra monthly payments and lump sums.

Spec: "Amortization Schedule with Extra Payments". Educational estimates only.

Rules in brief:
- Monthly rate is ``annual_rate / 12``.
- The regular payment comes from the standard annuity formula (or ``principal / term``
  at 0%), rounded to cents once, and never changes.
- Each month: interest on the starting balance (rounded to cents), scheduled principal =
  payment - interest, extra principal = ``extra_monthly`` + that month's lump sums.
- The loan ends at ``term_months`` or the first month where scheduled + extra principal
  would meet or exceed the balance. That final payment is exactly balance + interest.
- Extra payments shorten the loan; they never lower the regular payment.
- Every stored amount is rounded to cents with ``ROUND_HALF_UP``.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext

__all__ = [
    "AmortizationAssumptions",
    "AmortizationResult",
    "AmortizationSummary",
    "LoanInputError",
    "LoanInputTypeError",
    "LumpSum",
    "MAX_TERM_MONTHS",
    "ScheduleRow",
    "amortize",
    "regular_payment",
]

MAX_TERM_MONTHS = 600
_CENT = Decimal("0.01")
_ZERO = Decimal("0.00")
_MONTHS_PER_YEAR = 12
# Plenty of precision for (1 + r) ** -600 before the single rounding to cents.
_PRECISION = 50


class LoanInputError(ValueError):
    """Invalid loan input. ``field`` names the offending input (e.g. ``"principal"``)."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


class LoanInputTypeError(TypeError):
    """Loan input of the wrong type (e.g. a float for money). ``field`` names the input."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def _to_cents(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class LumpSum:
    """A one-off extra principal payment made in ``month`` (1-based)."""

    month: int
    amount: Decimal


@dataclass(frozen=True)
class ScheduleRow:
    month: int
    starting_balance: Decimal
    interest: Decimal
    scheduled_principal: Decimal
    extra_principal: Decimal
    total_payment: Decimal
    ending_balance: Decimal


@dataclass(frozen=True)
class AmortizationAssumptions:
    """The inputs a projection was computed from, returned with every result."""

    principal: Decimal
    annual_rate: Decimal
    monthly_rate: Decimal
    term_months: int
    extra_monthly: Decimal
    lump_sums: tuple[LumpSum, ...]


@dataclass(frozen=True)
class AmortizationSummary:
    regular_payment: Decimal
    payoff_month: int
    total_interest: Decimal
    total_paid: Decimal
    # Set only when extra payments were given; compared with the same loan without extras.
    interest_saved: Decimal | None
    months_saved: int | None


@dataclass(frozen=True)
class AmortizationResult:
    summary: AmortizationSummary
    schedule: tuple[ScheduleRow, ...]
    assumptions: AmortizationAssumptions


def _validate_loan(principal: Decimal, annual_rate: Decimal, term_months: int) -> None:
    if not isinstance(principal, Decimal):
        raise LoanInputTypeError("principal", "principal must be a Decimal")
    if not isinstance(annual_rate, Decimal):
        raise LoanInputTypeError("annual_rate", "annual_rate must be a Decimal")
    if isinstance(term_months, bool) or not isinstance(term_months, int):
        raise LoanInputTypeError("term_months", "term_months must be an int")
    if not principal.is_finite() or principal <= 0:
        raise LoanInputError("principal", f"principal must be greater than 0, got {principal}")
    if not annual_rate.is_finite() or annual_rate < 0 or annual_rate >= 1:
        raise LoanInputError(
            "annual_rate",
            f"annual_rate must be a fraction at least 0 and below 1, got {annual_rate}",
        )
    if term_months < 1 or term_months > MAX_TERM_MONTHS:
        raise LoanInputError(
            "term_months", f"term_months must be between 1 and {MAX_TERM_MONTHS}, got {term_months}"
        )


def _validate_extras(
    term_months: int, extra_monthly: Decimal, lump_sums: Sequence[LumpSum]
) -> None:
    if not isinstance(extra_monthly, Decimal):
        raise LoanInputTypeError("extra_monthly", "extra_monthly must be a Decimal")
    if not extra_monthly.is_finite() or extra_monthly < 0:
        raise LoanInputError(
            "extra_monthly", f"extra_monthly must be at least 0, got {extra_monthly}"
        )
    for lump in lump_sums:
        if isinstance(lump.month, bool) or not isinstance(lump.month, int):
            raise LoanInputTypeError("lump_sums", "lump sum month must be an int")
        if not isinstance(lump.amount, Decimal):
            raise LoanInputTypeError("lump_sums", "lump sum amount must be a Decimal")
        if lump.month < 1 or lump.month > term_months:
            raise LoanInputError(
                "lump_sums", f"lump sum month must be between 1 and {term_months}, got {lump.month}"
            )
        if not lump.amount.is_finite() or lump.amount <= 0:
            raise LoanInputError(
                "lump_sums", f"lump sum amount must be greater than 0, got {lump.amount}"
            )


def regular_payment(principal: Decimal, annual_rate: Decimal, term_months: int) -> Decimal:
    """The fixed monthly payment, rounded to cents (ROUND_HALF_UP)."""
    _validate_loan(principal, annual_rate, term_months)
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        if annual_rate == 0:
            return _to_cents(principal / term_months)
        r = annual_rate / _MONTHS_PER_YEAR
        exact = principal * r / (1 - (1 + r) ** -term_months)
        return _to_cents(exact)


def _build_schedule(
    principal: Decimal,
    monthly_rate: Decimal,
    term_months: int,
    payment: Decimal,
    extra_monthly: Decimal,
    lump_by_month: dict[int, Decimal],
) -> tuple[ScheduleRow, ...]:
    rows: list[ScheduleRow] = []
    balance = _to_cents(principal)
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        for month in range(1, term_months + 1):
            interest = _to_cents(balance * monthly_rate)
            scheduled = payment - interest
            extra = _to_cents(extra_monthly + lump_by_month.get(month, _ZERO))
            if month == term_months or scheduled + extra >= balance:
                # Final payment: pay off exactly what's left plus this month's interest.
                # Scheduled principal is capped at the balance; anything beyond the
                # scheduled amount needed to clear it is reported as extra principal.
                final_scheduled = min(scheduled, balance)
                final_extra = balance - final_scheduled
                rows.append(
                    ScheduleRow(
                        month=month,
                        starting_balance=balance,
                        interest=interest,
                        scheduled_principal=final_scheduled,
                        extra_principal=final_extra,
                        total_payment=balance + interest,
                        ending_balance=_ZERO,
                    )
                )
                break
            ending = balance - scheduled - extra
            rows.append(
                ScheduleRow(
                    month=month,
                    starting_balance=balance,
                    interest=interest,
                    scheduled_principal=scheduled,
                    extra_principal=extra,
                    total_payment=scheduled + extra + interest,
                    ending_balance=ending,
                )
            )
            balance = ending
    return tuple(rows)


def _totals(schedule: Sequence[ScheduleRow]) -> tuple[Decimal, Decimal]:
    total_interest = sum((row.interest for row in schedule), _ZERO)
    total_paid = sum((row.total_payment for row in schedule), _ZERO)
    return total_interest, total_paid


def amortize(
    principal: Decimal,
    annual_rate: Decimal,
    term_months: int,
    extra_monthly: Decimal = _ZERO,
    lump_sums: Iterable[LumpSum] = (),
) -> AmortizationResult:
    """Build the month-by-month schedule and summary for a fixed-rate loan.

    ``annual_rate`` is a fraction (6% is ``Decimal("0.06")``). Invalid input raises
    ``ValueError`` (or ``TypeError`` for wrong types); nothing is silently corrected.
    """
    lumps = tuple(lump_sums)
    _validate_loan(principal, annual_rate, term_months)
    _validate_extras(term_months, extra_monthly, lumps)

    payment = regular_payment(principal, annual_rate, term_months)
    monthly_rate = annual_rate / _MONTHS_PER_YEAR

    lump_by_month: dict[int, Decimal] = {}
    for lump in lumps:
        lump_by_month[lump.month] = lump_by_month.get(lump.month, _ZERO) + lump.amount

    schedule = _build_schedule(
        principal, monthly_rate, term_months, payment, extra_monthly, lump_by_month
    )
    total_interest, total_paid = _totals(schedule)

    interest_saved: Decimal | None = None
    months_saved: int | None = None
    if extra_monthly > 0 or lumps:
        baseline = _build_schedule(principal, monthly_rate, term_months, payment, _ZERO, {})
        baseline_interest, _ = _totals(baseline)
        interest_saved = baseline_interest - total_interest
        months_saved = len(baseline) - len(schedule)

    return AmortizationResult(
        summary=AmortizationSummary(
            regular_payment=payment,
            payoff_month=len(schedule),
            total_interest=total_interest,
            total_paid=total_paid,
            interest_saved=interest_saved,
            months_saved=months_saved,
        ),
        schedule=schedule,
        assumptions=AmortizationAssumptions(
            principal=principal,
            annual_rate=annual_rate,
            monthly_rate=monthly_rate,
            term_months=term_months,
            extra_monthly=extra_monthly,
            lump_sums=lumps,
        ),
    )
