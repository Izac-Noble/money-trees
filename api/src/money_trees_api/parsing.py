"""Turn untrusted JSON into engine inputs, collecting every problem found.

No math happens here. Rules mirror the engine's (Specs 1-3) so the API can report
every invalid field at once with a path the UI can attach to the right input; the
engine still validates again and any error it raises is reported too.

Money and rates must arrive as strings: JSON numbers become floats in many tools.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from money_trees_engine.amortization import MAX_TERM_MONTHS, LumpSum
from money_trees_engine.debts import MAX_DEBTS, MAX_NAME_LENGTH, Debt, DebtCategory
from money_trees_engine.strategies import Strategy

_MONEY_RE = re.compile(r"^-?\d+(\.\d{1,2})?$")
_RATE_RE = re.compile(r"^-?\d+(\.\d{1,6})?$")
_ZERO = Decimal("0")
_CATEGORY_LIST = "mortgage, auto, student, personal or other"


@dataclass(frozen=True)
class FieldError:
    field: str | None
    message: str


class InvalidInput(Exception):
    """One or more fields are invalid. Reported as HTTP 422."""

    def __init__(self, errors: Sequence[FieldError]) -> None:
        super().__init__(f"{len(errors)} invalid field(s)")
        self.errors = tuple(errors)


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


class _Reader:
    """Reads fields from one JSON object, recording errors instead of stopping."""

    def __init__(self, errors: list[FieldError]) -> None:
        self.errors = errors

    def fail(self, field: str | None, message: str) -> None:
        self.errors.append(FieldError(field, message))

    def obj(self, value: object, path: str, allowed: set[str]) -> dict[str, object] | None:
        if not isinstance(value, dict):
            self.fail(path or None, "Expected a JSON object.")
            return None
        for key in value:
            if key not in allowed:
                self.fail(_join(path, str(key)), "Unknown field.")
        return value

    def decimal(
        self,
        data: dict[str, object],
        key: str,
        path: str,
        *,
        kind: str,
        default: str | None = None,
    ) -> Decimal | None:
        field = _join(path, key)
        if key not in data:
            if default is not None:
                return Decimal(default)
            self.fail(field, "This field is required.")
            return None
        raw = data[key]
        example = '"1000.00"' if kind == "money" else '"0.06"'
        if isinstance(raw, bool) or not isinstance(raw, str):
            if isinstance(raw, int | float):
                self.fail(
                    field, f"Send this value as a string, for example {example}, not a number."
                )
            else:
                self.fail(field, f"Expected a string, for example {example}.")
            return None
        pattern = _MONEY_RE if kind == "money" else _RATE_RE
        if not pattern.match(raw):
            if kind == "money":
                self.fail(
                    field, "Enter an amount like 1000 or 1000.50, with up to 2 decimal places."
                )
            else:
                self.fail(
                    field,
                    'Enter the rate as a fraction with up to 6 decimal places, for example "0.06" '
                    "for 6%.",
                )
            return None
        return Decimal(raw)

    def integer(self, data: dict[str, object], key: str, path: str) -> int | None:
        field = _join(path, key)
        if key not in data:
            self.fail(field, "This field is required.")
            return None
        raw = data[key]
        if isinstance(raw, bool) or not isinstance(raw, int):
            self.fail(field, "Enter a whole number.")
            return None
        return raw

    def string(self, data: dict[str, object], key: str, path: str) -> str | None:
        field = _join(path, key)
        if key not in data:
            self.fail(field, "This field is required.")
            return None
        raw = data[key]
        if not isinstance(raw, str):
            self.fail(field, "Expected text.")
            return None
        return raw

    def array(self, data: dict[str, object], key: str, path: str) -> list[object] | None:
        field = _join(path, key)
        if key not in data:
            return []
        raw = data[key]
        if not isinstance(raw, list):
            self.fail(field, "Expected a list.")
            return None
        return raw


@dataclass(frozen=True)
class LoanInput:
    principal: Decimal
    annual_rate: Decimal
    term_months: int
    extra_monthly: Decimal
    lump_sums: tuple[LumpSum, ...]


_LOAN_FIELDS = {"principal", "annual_rate", "term_months", "extra_monthly", "lump_sums"}


def _loan_fields(
    r: _Reader, data: dict[str, object], path: str
) -> tuple[Decimal | None, Decimal | None, int | None, Decimal | None, tuple[LumpSum, ...] | None]:
    principal = r.decimal(data, "principal", path, kind="money")
    if principal is not None and principal <= 0:
        r.fail(_join(path, "principal"), "Balance must be greater than 0.")
        principal = None

    rate = r.decimal(data, "annual_rate", path, kind="rate")
    if rate is not None and rate < 0:
        r.fail(_join(path, "annual_rate"), "Rate can't be negative.")
        rate = None
    elif rate is not None and rate >= 1:
        r.fail(_join(path, "annual_rate"), "Rate must be below 1 (100%).")
        rate = None

    term = r.integer(data, "term_months", path)
    if term is not None and not 1 <= term <= MAX_TERM_MONTHS:
        r.fail(
            _join(path, "term_months"),
            f"Term must be between 1 and {MAX_TERM_MONTHS} months.",
        )
        term = None

    extra = r.decimal(data, "extra_monthly", path, kind="money", default="0")
    if extra is not None and extra < 0:
        r.fail(_join(path, "extra_monthly"), "Extra payment can't be negative.")
        extra = None

    raw_lumps = r.array(data, "lump_sums", path)
    lumps: list[LumpSum] | None = None if raw_lumps is None else []
    for i, item in enumerate(raw_lumps or []):
        item_path = f"{_join(path, 'lump_sums')}[{i}]"
        lump = r.obj(item, item_path, {"month", "amount"})
        if lump is None:
            lumps = None
            continue
        month = r.integer(lump, "month", item_path)
        amount = r.decimal(lump, "amount", item_path, kind="money")
        if month is not None and month < 1:
            r.fail(_join(item_path, "month"), "Month must be 1 or later.")
            month = None
        elif month is not None and term is not None and month > term:
            r.fail(
                _join(item_path, "month"),
                f"Month must be within the term (1 to {term}).",
            )
            month = None
        if amount is not None and amount <= 0:
            r.fail(_join(item_path, "amount"), "Lump sum must be greater than 0.")
            amount = None
        if month is None or amount is None:
            lumps = None
        elif lumps is not None:
            lumps.append(LumpSum(month, amount))
    return principal, rate, term, extra, None if lumps is None else tuple(lumps)


def parse_amortization(body: object) -> LoanInput:
    errors: list[FieldError] = []
    r = _Reader(errors)
    data = r.obj(body, "", _LOAN_FIELDS)
    if data is None:
        raise InvalidInput(errors)
    principal, rate, term, extra, lumps = _loan_fields(r, data, "")
    if errors:
        raise InvalidInput(errors)
    assert principal is not None and rate is not None and term is not None
    assert extra is not None and lumps is not None
    return LoanInput(principal, rate, term, extra, lumps)


_DEBT_FIELDS = {"id", "name", "category"} | _LOAN_FIELDS


def _parse_debt_list(
    r: _Reader, data: dict[str, object], *, shared_budget: bool
) -> list[Debt] | None:
    if "debts" not in data:
        r.fail("debts", "This field is required.")
        return None
    raw = data["debts"]
    if not isinstance(raw, list):
        r.fail("debts", "Expected a list of debts.")
        return None
    if not raw:
        r.fail("debts", "Add at least one debt.")
        return None
    if len(raw) > MAX_DEBTS:
        r.fail("debts", f"You can add up to {MAX_DEBTS} debts.")
        return None

    debts: list[Debt] | None = []
    seen: set[str] = set()
    categories = {c.value for c in DebtCategory}
    for i, item in enumerate(raw):
        path = f"debts[{i}]"
        before = len(r.errors)
        d = r.obj(item, path, _DEBT_FIELDS)
        if d is None:
            debts = None
            continue
        debt_id = r.string(d, "id", path)
        if debt_id is not None:
            if not debt_id.strip():
                r.fail(f"{path}.id", "Every debt needs an id.")
            elif debt_id in seen:
                r.fail(f"{path}.id", "Two debts have the same id.")
            seen.add(debt_id)
        name = r.string(d, "name", path)
        if name is not None:
            if not name.strip():
                r.fail(f"{path}.name", "Enter a name for this debt.")
            elif len(name) > MAX_NAME_LENGTH:
                r.fail(f"{path}.name", f"Name must be {MAX_NAME_LENGTH} characters or fewer.")
        category = r.string(d, "category", path)
        if category is not None and category not in categories:
            if category == "credit_card":
                r.fail(
                    f"{path}.category",
                    f"Credit cards aren't supported yet. Choose {_CATEGORY_LIST}.",
                )
            else:
                r.fail(f"{path}.category", f"Choose {_CATEGORY_LIST}.")
        principal, rate, term, extra, lumps = _loan_fields(r, d, path)
        if shared_budget:
            if extra is not None and extra != 0:
                r.fail(
                    f"{path}.extra_monthly",
                    "Leave this at 0. Extra money comes from the shared monthly amount.",
                )
            if lumps:
                r.fail(
                    f"{path}.lump_sums",
                    "Leave this empty. Extra money comes from the shared monthly amount.",
                )
        if len(r.errors) > before or debts is None:
            debts = None
            continue
        assert debt_id is not None and name is not None and category is not None
        assert principal is not None and rate is not None and term is not None
        assert extra is not None and lumps is not None
        debts.append(Debt(debt_id, name, category, principal, rate, term, extra, lumps))
    return debts


def parse_debts(body: object) -> list[Debt]:
    errors: list[FieldError] = []
    r = _Reader(errors)
    data = r.obj(body, "", {"debts"})
    if data is None:
        raise InvalidInput(errors)
    debts = _parse_debt_list(r, data, shared_budget=False)
    if errors or debts is None:
        raise InvalidInput(errors)
    return debts


@dataclass(frozen=True)
class StrategyInput:
    debts: list[Debt]
    extra_monthly: Decimal
    strategy: Strategy
    custom_order: list[str] | None


def _shared_extra(r: _Reader, data: dict[str, object]) -> Decimal | None:
    extra = r.decimal(data, "extra_monthly", "", kind="money")
    if extra is not None and extra < 0:
        r.fail("extra_monthly", "Extra money can't be negative.")
        return None
    return extra


def parse_strategy(body: object) -> StrategyInput:
    errors: list[FieldError] = []
    r = _Reader(errors)
    data = r.obj(body, "", {"debts", "extra_monthly", "strategy", "custom_order"})
    if data is None:
        raise InvalidInput(errors)
    debts = _parse_debt_list(r, data, shared_budget=True)
    extra = _shared_extra(r, data)

    strategy: Strategy | None = None
    raw_strategy = r.string(data, "strategy", "")
    if raw_strategy is not None:
        try:
            strategy = Strategy(raw_strategy)
        except ValueError:
            r.fail("strategy", "Choose avalanche, snowball or custom.")

    custom_order: list[str] | None = None
    if "custom_order" in data and data["custom_order"] is not None:
        raw_order = data["custom_order"]
        if strategy is not None and strategy is not Strategy.CUSTOM:
            r.fail("custom_order", "Only send an order with the custom strategy.")
        elif not isinstance(raw_order, list) or not all(isinstance(x, str) for x in raw_order):
            r.fail("custom_order", "Expected a list of debt ids.")
        else:
            custom_order = [str(x) for x in raw_order]
            if debts is not None:
                ids = [d.id for d in debts]
                if sorted(custom_order) != sorted(ids):
                    r.fail("custom_order", "List every debt id exactly once.")
    elif strategy is Strategy.CUSTOM:
        r.fail("custom_order", "Choose an order for the custom strategy.")

    if errors or debts is None:
        raise InvalidInput(errors)
    assert extra is not None and strategy is not None
    return StrategyInput(debts, extra, strategy, custom_order)


@dataclass(frozen=True)
class CompareInput:
    debts: list[Debt]
    extra_monthly: Decimal


def parse_compare(body: object) -> CompareInput:
    errors: list[FieldError] = []
    r = _Reader(errors)
    data = r.obj(body, "", {"debts", "extra_monthly"})
    if data is None:
        raise InvalidInput(errors)
    debts = _parse_debt_list(r, data, shared_budget=True)
    extra = _shared_extra(r, data)
    if errors or debts is None:
        raise InvalidInput(errors)
    assert extra is not None
    return CompareInput(debts, extra)
