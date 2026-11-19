"""Engine results to JSON. Money is always a string with exactly 2 decimal places.

Formatting only: no values are computed here.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from money_trees_engine.amortization import (
    AmortizationAssumptions,
    AmortizationResult,
    ScheduleRow,
)
from money_trees_engine.debts import DebtsResult
from money_trees_engine.household import GROUP_LABELS, HouseholdResult
from money_trees_engine.strategies import StrategyComparison, StrategyResult

JSON = dict[str, Any]
_CENT = Decimal("0.01")


def money(value: Decimal) -> str:
    return f"{value.quantize(_CENT, rounding=ROUND_HALF_UP):f}"


def money_or_none(value: Decimal | None) -> str | None:
    return None if value is None else money(value)


def rate(value: Decimal) -> str:
    """A rate as a plain decimal string, e.g. "0.06". Not rounded."""
    return f"{value:f}"


def schedule_row(row: ScheduleRow) -> JSON:
    return {
        "month": row.month,
        "starting_balance": money(row.starting_balance),
        "interest": money(row.interest),
        "scheduled_principal": money(row.scheduled_principal),
        "extra_principal": money(row.extra_principal),
        "payment": money(row.total_payment),
        "ending_balance": money(row.ending_balance),
    }


def _loan_assumptions(a: AmortizationAssumptions) -> JSON:
    return {
        "payment_mode": a.payment_mode.value,
        "principal": money(a.principal),
        "annual_rate": rate(a.annual_rate),
        "monthly_rate": rate(a.monthly_rate),
        "term_months": a.term_months,
        "monthly_payment": money_or_none(a.monthly_payment),
        "extra_monthly": money(a.extra_monthly),
        "lump_sums": [{"month": x.month, "amount": money(x.amount)} for x in a.lump_sums],
    }


def amortization(result: AmortizationResult, notes: tuple[str, ...] = ()) -> JSON:
    s = result.summary
    return {
        "summary": {
            "payment": money(s.regular_payment),
            "payoff_month": s.payoff_month,
            "total_interest": money(s.total_interest),
            "total_paid": money(s.total_paid),
            "interest_saved": money_or_none(s.interest_saved),
            "months_saved": s.months_saved,
        },
        "notes": list(notes),
        "schedule": [schedule_row(r) for r in result.schedule],
        "assumptions": _loan_assumptions(result.assumptions),
    }


def debts(result: DebtsResult) -> JSON:
    s = result.summary
    return {
        "debts": [
            {
                "id": d.id,
                "name": d.name,
                "category": d.category.value,
                "payment_mode": d.payment_mode.value,
                **amortization(d.result, d.notes),
            }
            for d in result.debts
        ],
        "summary": {
            "total_starting_balance": money(s.total_starting_balance),
            "total_regular_payment": money(s.total_regular_payment),
            "total_interest": money(s.total_interest),
            "total_paid": money(s.total_paid),
            "debt_free_month": s.debt_free_month,
            "debt_count": s.debt_count,
        },
        "timeline": [
            {
                "month": r.month,
                "total_payment": money(r.total_payment),
                "total_interest": money(r.total_interest),
                "total_ending_balance": money(r.total_ending_balance),
                "active_debts": r.active_debts,
            }
            for r in result.timeline
        ],
        "by_category": {
            category.value: {
                "starting_balance": money(t.starting_balance),
                "total_interest": money(t.total_interest),
            }
            for category, t in result.by_category.items()
        },
    }


def strategy(result: StrategyResult) -> JSON:
    a = result.assumptions
    baseline = result.baseline.summary
    return {
        "strategy": a.strategy.value,
        "priority_order": list(result.priority_order),
        "debt_free_month": result.debt_free_month,
        "total_interest": money(result.total_interest),
        "total_paid": money(result.total_paid),
        "first_payoff_month": result.first_payoff_month,
        "payoff_order": list(result.payoff_order),
        "interest_saved": money(result.interest_saved),
        "months_saved": result.months_saved,
        "debts": [
            {
                "id": p.id,
                "name": p.name,
                "category": p.category.value,
                "payoff_month": p.payoff_month,
                "total_interest": money(p.total_interest),
                "total_paid": money(p.total_paid),
                "notes": list(p.notes),
                "schedule": [schedule_row(r) for r in p.schedule],
            }
            for p in result.debts
        ],
        "timeline": [
            {
                "month": r.month,
                "total_payment": money(r.total_payment),
                "total_interest": money(r.total_interest),
                "total_ending_balance": money(r.total_ending_balance),
                "active_debts": r.active_debts,
                "leftover_applied": money(r.leftover_applied),
                "leftover_recipients": list(r.leftover_recipients),
            }
            for r in result.timeline
        ],
        "baseline": {
            "total_interest": money(baseline.total_interest),
            "total_paid": money(baseline.total_paid),
            "debt_free_month": baseline.debt_free_month,
            "timeline": [
                {
                    "month": r.month,
                    "total_ending_balance": money(r.total_ending_balance),
                }
                for r in result.baseline.timeline
            ],
        },
        "assumptions": {
            "strategy": a.strategy.value,
            "extra_monthly": money(a.extra_monthly),
            "monthly_budget": money(a.monthly_budget),
            "priority_order": list(a.priority_order),
        },
    }


def comparison(result: StrategyComparison) -> JSON:
    return {
        "avalanche": strategy(result.avalanche),
        "snowball": strategy(result.snowball),
        "differences": {
            "description": "snowball minus avalanche",
            "total_interest": money(result.total_interest_difference),
            "debt_free_month": result.debt_free_month_difference,
            "first_payoff_month": result.first_payoff_month_difference,
        },
    }


def ratio(value: Decimal | None) -> str | None:
    """A ratio with one decimal ("17.5"), or None. The engine has already rounded it."""
    return None if value is None else f"{value:f}"


def household(result: HouseholdResult) -> JSON:
    t = result.totals
    nw = result.net_worth
    return {
        "household_type": result.household_type.value,
        "people": [{"id": p.id, "name": p.name} for p in result.people],
        "incomes": [
            {"id": i.id, "label": i.label, "owner": i.owner, "monthly": money(i.monthly)}
            for i in result.incomes
        ],
        "lines": [
            {
                "id": line.id,
                "category": line.category.value,
                "group": line.group.value,
                "label": line.label,
                "owner": line.owner,
                "monthly": money(line.monthly),
                "source": line.source,
            }
            for line in result.lines
        ],
        "groups": [
            {"group": group.value, "label": GROUP_LABELS[group], "total": money(total)}
            for group, total in result.group_totals.items()
        ],
        "totals": {
            "income": money(t.income),
            "spending": money(t.spending),
            "debt_payments": money(t.debt_payments),
            "saving": money(t.saving),
            "total_out": money(t.total_out),
            "left_over": money(t.left_over),
        },
        "ratios": {
            "debt_payments_pct": ratio(result.ratios.debt_payments_pct),
            "housing_pct": ratio(result.ratios.housing_pct),
            "savings_rate_pct": ratio(result.ratios.savings_rate_pct),
            "emergency_fund_months": ratio(result.ratios.emergency_fund_months),
        },
        "net_worth": {
            "total_assets": money(nw.total_assets),
            "total_debt_balances": money(nw.total_debt_balances),
            "net_worth": money(nw.net_worth),
            "liquid_assets": money(nw.liquid_assets),
        },
        "by_owner": None
        if result.by_owner is None
        else {
            owner: {
                "income": money(o.income),
                "entered_expenses": money(o.entered_expenses),
                "debt_payments": money(o.debt_payments),
                "debt_balances": money(o.debt_balances),
                "assets": money(o.assets),
            }
            for owner, o in result.by_owner.items()
        },
        "notes": list(result.notes),
    }
