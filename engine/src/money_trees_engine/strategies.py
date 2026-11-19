"""Debt payoff strategies: where a shared monthly budget's extra money goes.

Spec: "Spec 3: Debt Payoff Strategies". Educational estimates only. This module shows
outcomes and trade-offs; it never labels a strategy as best.

The monthly budget is the sum of every debt's Spec 1 regular payment plus
``extra_monthly``, held constant until every debt is paid off, so a paid-off debt's
payment rolls over to the next. Each month:

1. Every active debt charges interest (Spec 1 rounding) and takes its required payment:
   the regular payment, or the exact payoff amount in its final month.
2. Leftover = budget - required payments, never below 0 (the cents rule).
3. The leftover goes to debts in a priority order fixed at the start; each debt takes at
   most its remaining balance and the rest moves on to the next debt that month.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

from money_trees_engine.amortization import ScheduleRow
from money_trees_engine.debts import (
    Debt,
    DebtCategory,
    DebtInputError,
    DebtsResult,
    analyze_debts,
)

__all__ = [
    "DebtPayoff",
    "Strategy",
    "StrategyAssumptions",
    "StrategyComparison",
    "StrategyResult",
    "StrategyRow",
    "compare_strategies",
    "priority_order",
    "run_strategy",
]

_ZERO = Decimal("0.00")
_CENT = Decimal("0.01")
_MONTHS_PER_YEAR = 12


class Strategy(StrEnum):
    AVALANCHE = "avalanche"  # highest rate first
    SNOWBALL = "snowball"  # smallest starting balance first
    CUSTOM = "custom"  # the order the user gives


@dataclass(frozen=True)
class StrategyRow:
    """Spec 2's combined-timeline row plus where that month's leftover went."""

    month: int
    total_payment: Decimal
    total_interest: Decimal
    total_ending_balance: Decimal
    active_debts: int
    leftover_applied: Decimal
    # Ids that received leftover this month, in the order it was applied.
    leftover_recipients: tuple[str, ...]


@dataclass(frozen=True)
class DebtPayoff:
    id: str
    name: str
    category: DebtCategory
    payoff_month: int
    total_interest: Decimal
    total_paid: Decimal
    # Spec 1 row shape; extra_principal is the leftover this debt received.
    schedule: tuple[ScheduleRow, ...]


@dataclass(frozen=True)
class StrategyAssumptions:
    strategy: Strategy
    extra_monthly: Decimal
    monthly_budget: Decimal
    priority_order: tuple[str, ...]


@dataclass(frozen=True)
class StrategyResult:
    priority_order: tuple[str, ...]
    debt_free_month: int
    total_interest: Decimal
    total_paid: Decimal
    first_payoff_month: int
    payoff_order: tuple[str, ...]
    interest_saved: Decimal  # vs. the Spec 2 baseline (no extra money, no rollover)
    months_saved: int
    debts: tuple[DebtPayoff, ...]  # in input order
    timeline: tuple[StrategyRow, ...]
    baseline: DebtsResult
    assumptions: StrategyAssumptions


@dataclass(frozen=True)
class StrategyComparison:
    """Avalanche and snowball side by side. Differences are snowball minus avalanche."""

    avalanche: StrategyResult
    snowball: StrategyResult
    total_interest_difference: Decimal
    debt_free_month_difference: int
    first_payoff_month_difference: int


def _to_cents(value: Decimal) -> Decimal:
    return value.quantize(_CENT, rounding=ROUND_HALF_UP)


def _parse_strategy(raw: Strategy | str) -> Strategy:
    if isinstance(raw, Strategy):
        return raw
    if isinstance(raw, str):
        try:
            return Strategy(raw)
        except ValueError:
            pass
    allowed = ", ".join(s.value for s in Strategy)
    raise DebtInputError(None, "strategy", f"must be one of {allowed}, got {raw!r}")


def _validate_custom_order(debts: Sequence[Debt], custom_order: Sequence[str]) -> None:
    ids = [d.id for d in debts]
    seen: set[str] = set()
    for debt_id in custom_order:
        if debt_id not in ids:
            raise DebtInputError(debt_id, "custom_order", "is not one of the debts")
        if debt_id in seen:
            raise DebtInputError(debt_id, "custom_order", "appears more than once")
        seen.add(debt_id)
    missing = [i for i in ids if i not in seen]
    if missing:
        raise DebtInputError(missing[0], "custom_order", "is missing from the order")


def priority_order(
    debts: Sequence[Debt],
    strategy: Strategy | str,
    custom_order: Sequence[str] | None = None,
) -> tuple[str, ...]:
    """The fixed order leftover money goes to, set from starting balances and rates."""
    chosen = _parse_strategy(strategy)
    if chosen is Strategy.CUSTOM:
        if custom_order is None:
            raise DebtInputError(None, "custom_order", "is required for the custom strategy")
        _validate_custom_order(debts, custom_order)
        return tuple(custom_order)
    if custom_order is not None:
        raise DebtInputError(None, "custom_order", "is only used with the custom strategy")
    if chosen is Strategy.AVALANCHE:
        ranked = sorted(debts, key=lambda d: (-d.annual_rate, d.principal, d.id))
    else:
        ranked = sorted(debts, key=lambda d: (d.principal, -d.annual_rate, d.id))
    return tuple(d.id for d in ranked)


@dataclass
class _DebtState:
    debt: Debt
    payment: Decimal
    monthly_rate: Decimal
    balance: Decimal
    rows: list[ScheduleRow]


def _simulate(
    baseline: DebtsResult,
    debts: Sequence[Debt],
    order: Sequence[str],
    budget: Decimal,
) -> tuple[list[_DebtState], list[StrategyRow]]:
    states = {
        d.id: _DebtState(
            debt=d,
            payment=r.result.summary.regular_payment,
            monthly_rate=d.annual_rate / _MONTHS_PER_YEAR,
            balance=_to_cents(d.principal),
            rows=[],
        )
        for d, r in zip(debts, baseline.debts, strict=True)
    }
    timeline: list[StrategyRow] = []
    month = 0
    while any(s.balance > 0 for s in states.values()):
        month += 1
        active = [s for s in states.values() if s.balance > 0]
        # 1. Interest and required payment for every active debt.
        pending: dict[str, tuple[Decimal, Decimal, Decimal, Decimal]] = {}
        required_total = _ZERO
        for s in active:
            start = s.balance
            interest = _to_cents(start * s.monthly_rate)
            scheduled = s.payment - interest
            if month >= s.debt.term_months or scheduled >= start:
                scheduled = start  # final month: exact payoff amount
            required_total += scheduled + interest
            pending[s.debt.id] = (start, interest, scheduled, start - scheduled)
        # 2-3. Leftover (never negative) goes to debts in priority order.
        leftover = max(budget - required_total, _ZERO)
        applied: dict[str, Decimal] = {}
        for debt_id in order:
            if leftover <= 0:
                break
            if debt_id not in pending:
                continue
            remaining = pending[debt_id][3]
            if remaining <= 0:
                continue
            amount = min(leftover, remaining)
            applied[debt_id] = amount
            leftover -= amount
        # 4. Record rows; debts at 0.00 drop out next month.
        payment_total = interest_total = balance_total = _ZERO
        for s in active:
            start, interest, scheduled, after_required = pending[s.debt.id]
            extra = applied.get(s.debt.id, _ZERO)
            ending = after_required - extra
            s.rows.append(
                ScheduleRow(
                    month=month,
                    starting_balance=start,
                    interest=interest,
                    scheduled_principal=scheduled,
                    extra_principal=extra,
                    total_payment=interest + scheduled + extra,
                    ending_balance=ending,
                )
            )
            s.balance = ending
            payment_total += interest + scheduled + extra
            interest_total += interest
            balance_total += ending
        timeline.append(
            StrategyRow(
                month=month,
                total_payment=payment_total,
                total_interest=interest_total,
                total_ending_balance=balance_total,
                active_debts=len(active),
                leftover_applied=sum(applied.values(), _ZERO),
                leftover_recipients=tuple(applied),
            )
        )
    return [states[d.id] for d in debts], timeline


def run_strategy(
    debts: Iterable[Debt],
    extra_monthly: Decimal,
    strategy: Strategy | str,
    custom_order: Sequence[str] | None = None,
) -> StrategyResult:
    """Pay off ``debts`` with a shared budget, sending leftover money in priority order.

    Invalid input raises :class:`DebtInputError`. Every debt must have no
    ``extra_monthly`` and no ``lump_sums``: here all extra money comes from the budget.
    """
    debt_list = tuple(debts)
    baseline = analyze_debts(debt_list)  # validates every debt (Spec 2 rules)
    for d in debt_list:
        if d.extra_monthly != 0:
            raise DebtInputError(
                d.id, "extra_monthly", "must be 0; extra money comes from the shared budget"
            )
        if d.lump_sums:
            raise DebtInputError(
                d.id, "lump_sums", "must be empty; extra money comes from the shared budget"
            )
    if not isinstance(extra_monthly, Decimal):
        raise DebtInputError(None, "extra_monthly", "must be a Decimal")
    if not extra_monthly.is_finite() or extra_monthly < 0:
        raise DebtInputError(None, "extra_monthly", f"must be at least 0, got {extra_monthly}")
    chosen = _parse_strategy(strategy)
    order = priority_order(debt_list, chosen, custom_order)

    budget = baseline.summary.total_regular_payment + extra_monthly
    states, timeline = _simulate(baseline, debt_list, order, budget)

    by_id = {r.id: r for r in baseline.debts}
    payoffs = tuple(
        DebtPayoff(
            id=s.debt.id,
            name=s.debt.name,
            category=by_id[s.debt.id].category,
            payoff_month=len(s.rows),
            total_interest=sum((row.interest for row in s.rows), _ZERO),
            total_paid=sum((row.total_payment for row in s.rows), _ZERO),
            schedule=tuple(s.rows),
        )
        for s in states
    )
    rank = {debt_id: i for i, debt_id in enumerate(order)}
    payoff_order = tuple(p.id for p in sorted(payoffs, key=lambda p: (p.payoff_month, rank[p.id])))
    total_interest = sum((p.total_interest for p in payoffs), _ZERO)
    debt_free_month = len(timeline)

    return StrategyResult(
        priority_order=order,
        debt_free_month=debt_free_month,
        total_interest=total_interest,
        total_paid=sum((p.total_paid for p in payoffs), _ZERO),
        first_payoff_month=min(p.payoff_month for p in payoffs),
        payoff_order=payoff_order,
        interest_saved=baseline.summary.total_interest - total_interest,
        months_saved=baseline.summary.debt_free_month - debt_free_month,
        debts=payoffs,
        timeline=tuple(timeline),
        baseline=baseline,
        assumptions=StrategyAssumptions(
            strategy=chosen,
            extra_monthly=extra_monthly,
            monthly_budget=budget,
            priority_order=order,
        ),
    )


def compare_strategies(debts: Iterable[Debt], extra_monthly: Decimal) -> StrategyComparison:
    """Run avalanche and snowball on the same inputs. Differences are snowball - avalanche."""
    debt_list = tuple(debts)
    avalanche = run_strategy(debt_list, extra_monthly, Strategy.AVALANCHE)
    snowball = run_strategy(debt_list, extra_monthly, Strategy.SNOWBALL)
    return StrategyComparison(
        avalanche=avalanche,
        snowball=snowball,
        total_interest_difference=snowball.total_interest - avalanche.total_interest,
        debt_free_month_difference=snowball.debt_free_month - avalanche.debt_free_month,
        first_payoff_month_difference=snowball.first_payoff_month - avalanche.first_payoff_month,
    )
