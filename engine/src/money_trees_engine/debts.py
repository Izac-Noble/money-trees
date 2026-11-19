"""A list of debts, each amortized on its own, plus the combined picture.

Spec: "Spec 2: Debts List". Educational estimates only.

Each debt runs through the Spec 1 engine (:func:`amortize`) independently; no money
moves between debts. The combined timeline adds up the per-debt rows month by month
until the last debt is paid off. A debt that is already paid off contributes 0.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType

from money_trees_engine.amortization import (
    AmortizationResult,
    LoanInputError,
    LoanInputTypeError,
    LumpSum,
    PaymentMode,
    amortize,
    amortize_payment,
)

__all__ = [
    "CATEGORIES",
    "CREDIT_CARD_NOTES",
    "CategoryInfo",
    "CategoryTotals",
    "CombinedRow",
    "CombinedSummary",
    "Debt",
    "DebtCategory",
    "DebtInputError",
    "DebtResult",
    "DebtsResult",
    "MAX_DEBTS",
    "MAX_NAME_LENGTH",
    "SUGGESTED_TERM_MONTHS",
    "analyze_debts",
    "notes_for_category",
]

MAX_DEBTS = 20
MAX_NAME_LENGTH = 60
_ZERO = Decimal("0.00")


class DebtCategory(StrEnum):
    MORTGAGE = "mortgage"
    AUTO = "auto"
    STUDENT = "student"
    PERSONAL = "personal"
    CREDIT_CARD = "credit_card"
    MEDICAL = "medical"
    FAMILY_FRIEND = "family_friend"
    TAX = "tax"
    OTHER = "other"


@dataclass(frozen=True)
class CategoryInfo:
    label: str
    default_mode: PaymentMode  # the mode the UI pre-selects; any category may use either
    suggested_term_months: int | None


CATEGORIES: Mapping[DebtCategory, CategoryInfo] = MappingProxyType(
    {
        DebtCategory.MORTGAGE: CategoryInfo("Mortgage", PaymentMode.FIXED_TERM, 360),
        DebtCategory.AUTO: CategoryInfo("Car loan", PaymentMode.FIXED_TERM, 60),
        DebtCategory.STUDENT: CategoryInfo("Student loan", PaymentMode.FIXED_TERM, 120),
        DebtCategory.PERSONAL: CategoryInfo("Personal loan", PaymentMode.FIXED_TERM, 36),
        DebtCategory.CREDIT_CARD: CategoryInfo("Credit card", PaymentMode.FIXED_PAYMENT, None),
        DebtCategory.MEDICAL: CategoryInfo("Medical debt", PaymentMode.FIXED_PAYMENT, None),
        DebtCategory.FAMILY_FRIEND: CategoryInfo(
            "Loan from family or friends", PaymentMode.FIXED_PAYMENT, None
        ),
        DebtCategory.TAX: CategoryInfo("Tax debt", PaymentMode.FIXED_PAYMENT, None),
        DebtCategory.OTHER: CategoryInfo("Other", PaymentMode.FIXED_PAYMENT, None),
    }
)
"""Spec 3b category table: labels, default payment mode and suggested term."""

SUGGESTED_TERM_MONTHS: Mapping[DebtCategory, int | None] = MappingProxyType(
    {category: info.suggested_term_months for category, info in CATEGORIES.items()}
)
"""Suggested remaining terms the UI may pre-fill. The calculation never applies them."""

CREDIT_CARD_NOTES: tuple[str, ...] = (
    "Interest is estimated monthly (yearly rate / 12). Most cards charge daily, so real "
    "interest can be slightly higher.",
    "No new purchases are added.",
    "The payment stays the same each month. A card's minimum payment usually shrinks as the "
    "balance drops, which takes much longer.",
    "Promotional rates, fees and penalty rates are not included.",
)
"""The simplifications behind a credit card estimate. The UI must show them."""


def notes_for_category(category: DebtCategory | str | None) -> tuple[str, ...]:
    """Limits the UI must show alongside a result for this category."""
    return CREDIT_CARD_NOTES if category == DebtCategory.CREDIT_CARD else ()


class DebtInputError(ValueError):
    """Invalid debt list. ``debt_id`` is ``None`` for list-level problems."""

    def __init__(self, debt_id: str | None, field: str, message: str) -> None:
        prefix = f"debt {debt_id!r}: " if debt_id is not None else ""
        super().__init__(f"{prefix}{field}: {message}")
        self.debt_id = debt_id
        self.field = field


@dataclass(frozen=True)
class Debt:
    """One debt as entered: the current balance, not the original loan.

    In ``fixed_term`` mode give ``term_months`` (months remaining); in
    ``fixed_payment`` mode give ``monthly_payment`` instead and leave ``term_months``
    as ``None``.
    """

    id: str
    name: str
    category: DebtCategory | str
    principal: Decimal
    annual_rate: Decimal
    term_months: int | None
    extra_monthly: Decimal = _ZERO
    lump_sums: tuple[LumpSum, ...] = field(default_factory=tuple)
    payment_mode: PaymentMode | str = PaymentMode.FIXED_TERM
    monthly_payment: Decimal | None = None
    # Spec 6: whose debt this is ("p1", "p2" or "joint"). Checked by the household.
    owner: str = "p1"


@dataclass(frozen=True)
class DebtResult:
    id: str
    name: str
    category: DebtCategory
    payment_mode: PaymentMode
    result: AmortizationResult
    notes: tuple[str, ...]  # limits the UI must show (credit cards)


@dataclass(frozen=True)
class CombinedSummary:
    total_starting_balance: Decimal
    total_regular_payment: Decimal  # sum of every debt's regular payment in month 1
    total_interest: Decimal
    total_paid: Decimal
    debt_free_month: int
    debt_count: int


@dataclass(frozen=True)
class CombinedRow:
    month: int
    total_payment: Decimal
    total_interest: Decimal
    total_ending_balance: Decimal
    active_debts: int


@dataclass(frozen=True)
class CategoryTotals:
    starting_balance: Decimal
    total_interest: Decimal


@dataclass(frozen=True)
class DebtsResult:
    debts: tuple[DebtResult, ...]
    summary: CombinedSummary
    timeline: tuple[CombinedRow, ...]
    # Only categories present, in DebtCategory order.
    by_category: Mapping[DebtCategory, CategoryTotals]


def _parse_category(debt_id: str, raw: DebtCategory | str) -> DebtCategory:
    if isinstance(raw, DebtCategory):
        return raw
    if isinstance(raw, str):
        try:
            return DebtCategory(raw)
        except ValueError:
            pass
    allowed = ", ".join(c.value for c in DebtCategory)
    raise DebtInputError(debt_id, "category", f"must be one of {allowed}, got {raw!r}")


def _validate_identity(debt: Debt, seen_ids: set[str]) -> None:
    if not isinstance(debt.id, str) or not debt.id.strip():
        raise DebtInputError(None, "id", "every debt needs a non-blank id")
    if debt.id in seen_ids:
        raise DebtInputError(debt.id, "id", "is used by more than one debt")
    seen_ids.add(debt.id)
    if not isinstance(debt.name, str) or not debt.name.strip():
        raise DebtInputError(debt.id, "name", "must not be blank")
    if len(debt.name) > MAX_NAME_LENGTH:
        raise DebtInputError(
            debt.id, "name", f"must be at most {MAX_NAME_LENGTH} characters, got {len(debt.name)}"
        )


def _parse_mode(debt: Debt) -> PaymentMode:
    raw = debt.payment_mode
    if isinstance(raw, PaymentMode):
        return raw
    if isinstance(raw, str):
        try:
            return PaymentMode(raw)
        except ValueError:
            pass
    allowed = ", ".join(m.value for m in PaymentMode)
    raise DebtInputError(debt.id, "payment_mode", f"must be one of {allowed}, got {raw!r}")


def _amortize_debt(debt: Debt, mode: PaymentMode) -> AmortizationResult:
    if mode is PaymentMode.FIXED_TERM:
        if debt.monthly_payment is not None:
            raise DebtInputError(
                debt.id, "monthly_payment", "is only used with the fixed_payment mode"
            )
        if debt.term_months is None:
            raise DebtInputError(debt.id, "term_months", "is required in fixed_term mode")
    else:
        if debt.term_months is not None:
            raise DebtInputError(debt.id, "term_months", "is only used with the fixed_term mode")
        if debt.monthly_payment is None:
            raise DebtInputError(debt.id, "monthly_payment", "is required in fixed_payment mode")
    try:
        if mode is PaymentMode.FIXED_TERM:
            assert debt.term_months is not None
            return amortize(
                debt.principal,
                debt.annual_rate,
                debt.term_months,
                debt.extra_monthly,
                debt.lump_sums,
            )
        assert debt.monthly_payment is not None
        return amortize_payment(
            debt.principal,
            debt.annual_rate,
            debt.monthly_payment,
            debt.extra_monthly,
            debt.lump_sums,
        )
    except (LoanInputError, LoanInputTypeError) as exc:
        raise DebtInputError(debt.id, exc.field, str(exc)) from exc


def _combine(results: Sequence[DebtResult]) -> tuple[CombinedRow, ...]:
    debt_free_month = max(d.result.summary.payoff_month for d in results)
    rows: list[CombinedRow] = []
    for month in range(1, debt_free_month + 1):
        payment = interest = balance = _ZERO
        active = 0
        for debt in results:
            schedule = debt.result.schedule
            if month <= len(schedule):
                row = schedule[month - 1]
                payment += row.total_payment
                interest += row.interest
                balance += row.ending_balance
                active += 1
        rows.append(
            CombinedRow(
                month=month,
                total_payment=payment,
                total_interest=interest,
                total_ending_balance=balance,
                active_debts=active,
            )
        )
    return tuple(rows)


def analyze_debts(debts: Iterable[Debt]) -> DebtsResult:
    """Amortize each debt on its own and build the combined summary and timeline.

    Invalid input raises :class:`DebtInputError` naming the debt's ``id`` and the field.
    Nothing is defaulted or corrected.
    """
    debt_list = tuple(debts)
    if not debt_list:
        raise DebtInputError(None, "debts", "enter at least one debt")
    if len(debt_list) > MAX_DEBTS:
        raise DebtInputError(
            None, "debts", f"at most {MAX_DEBTS} debts are allowed, got {len(debt_list)}"
        )

    seen_ids: set[str] = set()
    categories: list[DebtCategory] = []
    modes: list[PaymentMode] = []
    for debt in debt_list:
        _validate_identity(debt, seen_ids)
        categories.append(_parse_category(debt.id, debt.category))
        modes.append(_parse_mode(debt))

    results = tuple(
        DebtResult(
            id=d.id,
            name=d.name,
            category=c,
            payment_mode=mode,
            result=_amortize_debt(d, mode),
            notes=notes_for_category(c),
        )
        for d, c, mode in zip(debt_list, categories, modes, strict=True)
    )
    timeline = _combine(results)

    summaries = [d.result.summary for d in results]
    summary = CombinedSummary(
        total_starting_balance=sum((d.result.assumptions.principal for d in results), _ZERO),
        total_regular_payment=sum((s.regular_payment for s in summaries), _ZERO),
        total_interest=sum((s.total_interest for s in summaries), _ZERO),
        total_paid=sum((s.total_paid for s in summaries), _ZERO),
        debt_free_month=len(timeline),
        debt_count=len(results),
    )

    by_category: dict[DebtCategory, CategoryTotals] = {}
    for category in DebtCategory:
        members = [d for d in results if d.category is category]
        if members:
            by_category[category] = CategoryTotals(
                starting_balance=sum((d.result.assumptions.principal for d in members), _ZERO),
                total_interest=sum((d.result.summary.total_interest for d in members), _ZERO),
            )

    return DebtsResult(
        debts=results,
        summary=summary,
        timeline=timeline,
        by_category=MappingProxyType(by_category),
    )
