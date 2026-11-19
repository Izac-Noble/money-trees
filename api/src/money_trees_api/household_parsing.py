"""Parse a household request (Spec 7a), collecting every problem with an exact path.

No math. The rules mirror Spec 6 so every invalid field can be reported at once; the
engine checks again, and anything it raises is reported too.
"""

from __future__ import annotations

from decimal import Decimal

from money_trees_api.parsing import FieldError, InvalidInput, _parse_debt_list, _Reader
from money_trees_engine.debts import Debt, DebtCategory
from money_trees_engine.household import (
    ASSET_TYPES,
    DEBT_TO_EXPENSE,
    EXPENSE_CATEGORIES,
    FREQUENCIES,
    JOINT,
    MAX_PERSON_NAME_LENGTH,
    Asset,
    AssetType,
    Expense,
    ExpenseCategory,
    Frequency,
    Household,
    HouseholdType,
    Income,
    Person,
)

ALREADY_COUNTED = "This is already counted from your Debts tab."
_HOUSEHOLD_FIELDS = {"household_type", "people", "incomes", "expenses", "assets", "debts"}
_FREQUENCY_LIST = ", ".join(f.value for f in FREQUENCIES)


def _list(r: _Reader, data: dict[str, object], key: str) -> list[object]:
    raw = r.array(data, key, "")
    return raw if raw is not None else []


def _owner(r: _Reader, item: dict[str, object], path: str, owners: tuple[str, ...]) -> str:
    owner = r.string(item, "owner", path)
    if owner is not None and owner not in owners:
        if owners == ("p1",):
            r.fail(f"{path}.owner", "A single household only has one person (p1).")
        else:
            r.fail(f"{path}.owner", "Choose p1, p2 or joint.")
    return owner or "p1"


def _frequency(r: _Reader, item: dict[str, object], path: str) -> Frequency | None:
    raw = r.string(item, "frequency", path)
    if raw is None:
        return None
    try:
        return Frequency(raw)
    except ValueError:
        r.fail(f"{path}.frequency", f"Choose one of: {_FREQUENCY_LIST}.")
        return None


def _money(
    r: _Reader, item: dict[str, object], key: str, path: str, *, positive: bool, label: str
) -> Decimal | None:
    value = r.decimal(item, key, path, kind="money")
    if value is None:
        return None
    if positive and value <= 0:
        r.fail(f"{path}.{key}", f"{label} must be greater than 0.")
        return None
    if value < 0:
        r.fail(f"{path}.{key}", f"{label} can't be negative.")
        return None
    return value


def parse_household(body: object) -> Household:
    errors: list[FieldError] = []
    r = _Reader(errors)
    data = r.obj(body, "", _HOUSEHOLD_FIELDS)
    if data is None:
        raise InvalidInput(errors)

    kind: HouseholdType | None = None
    raw_kind = r.string(data, "household_type", "")
    if raw_kind is not None:
        try:
            kind = HouseholdType(raw_kind)
        except ValueError:
            r.fail("household_type", "Choose single or couple.")

    people: list[Person] = []
    before_people = len(errors)
    raw_people = r.array(data, "people", "")
    if raw_people is not None and kind is not None:
        expected = ["p1"] if kind is HouseholdType.SINGLE else ["p1", "p2"]
        for i, item in enumerate(raw_people):
            p = r.obj(item, f"people[{i}]", {"id", "name"})
            if p is None:
                continue
            pid = r.string(p, "id", f"people[{i}]")
            name = r.string(p, "name", f"people[{i}]")
            if name is not None:
                if not name.strip():
                    r.fail(f"people[{i}].name", "Enter a name.")
                elif len(name) > MAX_PERSON_NAME_LENGTH:
                    r.fail(
                        f"people[{i}].name",
                        f"Use {MAX_PERSON_NAME_LENGTH} characters or fewer.",
                    )
            if pid is not None and name is not None:
                people.append(Person(pid, name))
        if [p.id for p in people] != expected and len(errors) == before_people:
            need = (
                "one person with id p1"
                if kind is HouseholdType.SINGLE
                else "two people with ids p1 and p2"
            )
            r.fail("people", f"A {kind.value} household needs {need}.")
    owners: tuple[str, ...] = ("p1",) if kind is not HouseholdType.COUPLE else ("p1", "p2", JOINT)

    incomes: list[Income] = []
    for i, item in enumerate(_list(r, data, "incomes")):
        path = f"incomes[{i}]"
        d = r.obj(item, path, {"id", "label", "owner", "amount", "frequency"})
        if d is None:
            continue
        iid = r.string(d, "id", path)
        label = r.string(d, "label", path)
        if label is not None and not label.strip():
            r.fail(f"{path}.label", "Enter a label for this income.")
        owner = _owner(r, d, path, owners)
        amount = _money(r, d, "amount", path, positive=True, label="Take-home pay")
        frequency = _frequency(r, d, path)
        if iid is not None and label and amount is not None and frequency is not None:
            incomes.append(Income(iid, label, owner, amount, frequency))

    debts: list[Debt] = _parse_debt_list(r, data, shared_budget=False, allow_empty=True) or []
    for i, debt in enumerate(debts):
        if debt.owner not in owners:
            if owners == ("p1",):
                r.fail(f"debts[{i}].owner", "A single household only has one person (p1).")
            else:
                r.fail(f"debts[{i}].owner", "Choose p1, p2 or joint.")
    from_debts = {DEBT_TO_EXPENSE[DebtCategory(d.category)] for d in debts}

    expenses: list[Expense] = []
    for i, item in enumerate(_list(r, data, "expenses")):
        path = f"expenses[{i}]"
        d = r.obj(item, path, {"id", "category", "owner", "amount", "frequency", "label"})
        if d is None:
            continue
        eid = r.string(d, "id", path)
        category: ExpenseCategory | None = None
        raw_category = r.string(d, "category", path)
        if raw_category is not None:
            try:
                category = ExpenseCategory(raw_category)
            except ValueError:
                r.fail(f"{path}.category", "This isn't one of the expense categories.")
        if category is not None:
            info = EXPENSE_CATEGORIES[category]
            if not info.enterable:
                r.fail(f"{path}.category", f"{info.label} comes from the Debts tab only.")
                category = None
            elif category in from_debts:
                r.fail(f"{path}.category", ALREADY_COUNTED)
                category = None
        expense_label = r.string(d, "label", path) if "label" in d else None
        if category is ExpenseCategory.CUSTOM and not (expense_label and expense_label.strip()):
            r.fail(f"{path}.label", "Enter a label for this expense.")
        owner = _owner(r, d, path, owners)
        amount = _money(r, d, "amount", path, positive=False, label="Amount")
        frequency = _frequency(r, d, path)
        if eid is not None and category is not None and amount is not None and frequency:
            expenses.append(Expense(eid, category, owner, amount, frequency, expense_label))

    assets: list[Asset] = []
    for i, item in enumerate(_list(r, data, "assets")):
        path = f"assets[{i}]"
        d = r.obj(item, path, {"id", "type", "owner", "value", "label"})
        if d is None:
            continue
        aid = r.string(d, "id", path)
        asset_type: AssetType | None = None
        raw_type = r.string(d, "type", path)
        if raw_type is not None:
            try:
                asset_type = AssetType(raw_type)
            except ValueError:
                allowed = ", ".join(t.value for t in ASSET_TYPES)
                r.fail(f"{path}.type", f"Choose one of: {allowed}.")
        asset_label = r.string(d, "label", path) if "label" in d else None
        owner = _owner(r, d, path, owners)
        value = _money(r, d, "value", path, positive=False, label="Value")
        if aid is not None and asset_type is not None and value is not None:
            assets.append(Asset(aid, asset_type, owner, value, asset_label))

    if errors or kind is None:
        raise InvalidInput(errors)
    return Household(
        kind,
        tuple(people),
        incomes=tuple(incomes),
        expenses=tuple(expenses),
        assets=tuple(assets),
        debts=tuple(debts),
    )
