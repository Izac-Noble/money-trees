"""Household and cash flow: what comes in, where it goes, what's left, own and owe.

Spec: "Spec 6: Household and Cash Flow (Engine)". Educational estimates only; the
engine never labels a number as good or bad.

Income and expenses are converted to monthly amounts with full precision, then each
is rounded half up to cents. Totals are sums of those rounded lines, so the lines on
screen always add up to the totals. Debt payments come from the debts list (Specs 2
and 3b), so nothing is counted twice.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, localcontext
from enum import StrEnum
from types import MappingProxyType

from money_trees_engine.debts import Debt, DebtCategory, analyze_debts

__all__ = [
    "ASSET_TYPES",
    "EXPENSE_CATEGORIES",
    "FREQUENCIES",
    "JOINT",
    "MAX_PERSON_NAME_LENGTH",
    "NOTE_HAND_ENTERED_DEBT",
    "NOTE_LENDERS",
    "NOTE_TAKE_HOME",
    "Asset",
    "AssetType",
    "AssetTypeInfo",
    "CashFlowLine",
    "Expense",
    "ExpenseCategory",
    "ExpenseCategoryInfo",
    "ExpenseGroup",
    "Frequency",
    "FrequencyInfo",
    "Household",
    "HouseholdInputError",
    "HouseholdResult",
    "HouseholdType",
    "Income",
    "IncomeLine",
    "MonthlyTotals",
    "NetWorth",
    "OwnerTotals",
    "Person",
    "Ratios",
    "analyze_household",
    "to_monthly",
]

_CENT = Decimal("0.01")
_TENTH = Decimal("0.1")
_ZERO = Decimal("0.00")
_PRECISION = 50
MAX_PERSON_NAME_LENGTH = 40
JOINT = "joint"


class HouseholdInputError(ValueError):
    """Invalid household input. ``field`` is a path such as ``expenses[3].amount``."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


# --- People -----------------------------------------------------------------------------


class HouseholdType(StrEnum):
    SINGLE = "single"
    COUPLE = "couple"


@dataclass(frozen=True)
class Person:
    id: str  # "p1" or "p2"
    name: str


# --- Frequencies ------------------------------------------------------------------------


class Frequency(StrEnum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    SEMIMONTHLY = "semimonthly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    SEMIANNUAL = "semiannual"
    YEARLY = "yearly"


@dataclass(frozen=True)
class FrequencyInfo:
    label: str
    times_per_year: int  # monthly amount = amount * times_per_year / 12


FREQUENCIES: Mapping[Frequency, FrequencyInfo] = MappingProxyType(
    {
        Frequency.WEEKLY: FrequencyInfo("Every week", 52),
        Frequency.BIWEEKLY: FrequencyInfo("Every two weeks", 26),
        Frequency.SEMIMONTHLY: FrequencyInfo("Twice a month", 24),
        Frequency.MONTHLY: FrequencyInfo("Every month", 12),
        Frequency.QUARTERLY: FrequencyInfo("Every 3 months", 4),
        Frequency.SEMIANNUAL: FrequencyInfo("Every 6 months", 2),
        Frequency.YEARLY: FrequencyInfo("Every year", 1),
    }
)


def to_monthly(amount: Decimal, frequency: Frequency | str) -> Decimal:
    """An amount per ``frequency`` as a monthly amount, rounded half up to cents."""
    times = FREQUENCIES[Frequency(frequency)].times_per_year
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        return (amount * times / 12).quantize(_CENT, rounding=ROUND_HALF_UP)


# --- Expense categories -----------------------------------------------------------------


class ExpenseGroup(StrEnum):
    HOUSING = "housing"
    DEBT_PAYMENTS = "debt_payments"
    BILLS = "bills"
    EVERYDAY = "everyday"
    GIVING = "giving"
    SAVING = "saving"
    OTHER = "other"


class ExpenseCategory(StrEnum):
    HOUSING = "housing"
    MORTGAGE = "mortgage"
    CREDIT_CARDS = "credit_cards"
    CAR_PAYMENT = "car_payment"
    PERSONAL_LOAN = "personal_loan"
    STUDENT_LOAN = "student_loan"
    OTHER_DEBT = "other_debt"
    UTILITIES = "utilities"
    PHONE = "phone"
    INTERNET = "internet"
    INSURANCE = "insurance"
    GROCERIES = "groceries"
    GAS = "gas"
    EATING_OUT = "eating_out"
    MISCELLANEOUS = "miscellaneous"
    GIVING = "giving"
    EMERGENCY_FUND = "emergency_fund"
    CUSTOM = "custom"


@dataclass(frozen=True)
class ExpenseCategoryInfo:
    group: ExpenseGroup
    label: str
    from_debts: bool  # debts on the Debts tab can produce this line
    enterable: bool  # the user may type an amount by hand


_E = ExpenseCategory
_G = ExpenseGroup
EXPENSE_CATEGORIES: Mapping[ExpenseCategory, ExpenseCategoryInfo] = MappingProxyType(
    {
        _E.HOUSING: ExpenseCategoryInfo(_G.HOUSING, "Rent or housing costs", False, True),
        _E.MORTGAGE: ExpenseCategoryInfo(_G.HOUSING, "Mortgage", True, False),
        _E.CREDIT_CARDS: ExpenseCategoryInfo(_G.DEBT_PAYMENTS, "Credit cards", True, True),
        _E.CAR_PAYMENT: ExpenseCategoryInfo(_G.DEBT_PAYMENTS, "Car payment", True, True),
        _E.PERSONAL_LOAN: ExpenseCategoryInfo(_G.DEBT_PAYMENTS, "Personal loan", True, True),
        _E.STUDENT_LOAN: ExpenseCategoryInfo(_G.DEBT_PAYMENTS, "Student loan", True, True),
        _E.OTHER_DEBT: ExpenseCategoryInfo(_G.DEBT_PAYMENTS, "Other debt payments", True, False),
        _E.UTILITIES: ExpenseCategoryInfo(_G.BILLS, "Utilities", False, True),
        _E.PHONE: ExpenseCategoryInfo(_G.BILLS, "Phone bill", False, True),
        _E.INTERNET: ExpenseCategoryInfo(_G.BILLS, "Internet", False, True),
        _E.INSURANCE: ExpenseCategoryInfo(_G.BILLS, "Insurance", False, True),
        _E.GROCERIES: ExpenseCategoryInfo(_G.EVERYDAY, "Groceries", False, True),
        _E.GAS: ExpenseCategoryInfo(_G.EVERYDAY, "Gas", False, True),
        _E.EATING_OUT: ExpenseCategoryInfo(_G.EVERYDAY, "Eating out", False, True),
        _E.MISCELLANEOUS: ExpenseCategoryInfo(_G.EVERYDAY, "Miscellaneous", False, True),
        _E.GIVING: ExpenseCategoryInfo(_G.GIVING, "Giving", False, True),
        _E.EMERGENCY_FUND: ExpenseCategoryInfo(_G.SAVING, "Emergency fund", False, True),
        _E.CUSTOM: ExpenseCategoryInfo(_G.OTHER, "Custom", False, True),
    }
)

GROUP_LABELS: Mapping[ExpenseGroup, str] = MappingProxyType(
    {
        _G.HOUSING: "Housing",
        _G.DEBT_PAYMENTS: "Debt payments",
        _G.BILLS: "Bills",
        _G.EVERYDAY: "Everyday",
        _G.GIVING: "Giving",
        _G.SAVING: "Saving",
        _G.OTHER: "Other",
    }
)

DEBT_TO_EXPENSE: Mapping[DebtCategory, ExpenseCategory] = MappingProxyType(
    {
        DebtCategory.MORTGAGE: _E.MORTGAGE,
        DebtCategory.CREDIT_CARD: _E.CREDIT_CARDS,
        DebtCategory.AUTO: _E.CAR_PAYMENT,
        DebtCategory.PERSONAL: _E.PERSONAL_LOAN,
        DebtCategory.STUDENT: _E.STUDENT_LOAN,
        DebtCategory.MEDICAL: _E.OTHER_DEBT,
        DebtCategory.FAMILY_FRIEND: _E.OTHER_DEBT,
        DebtCategory.TAX: _E.OTHER_DEBT,
        DebtCategory.OTHER: _E.OTHER_DEBT,
    }
)
"""Which expense line each debt category's payment lands on."""


# --- Assets -----------------------------------------------------------------------------


class AssetType(StrEnum):
    CASH = "cash"
    EMERGENCY_FUND = "emergency_fund"
    INVESTMENTS = "investments"
    RETIREMENT = "retirement"
    HOME = "home"
    VEHICLE = "vehicle"
    OTHER = "other"


@dataclass(frozen=True)
class AssetTypeInfo:
    label: str
    liquid: bool


ASSET_TYPES: Mapping[AssetType, AssetTypeInfo] = MappingProxyType(
    {
        AssetType.CASH: AssetTypeInfo("Checking and savings", True),
        AssetType.EMERGENCY_FUND: AssetTypeInfo("Emergency fund", True),
        AssetType.INVESTMENTS: AssetTypeInfo("Investments (not retirement)", True),
        AssetType.RETIREMENT: AssetTypeInfo("Retirement accounts", False),
        AssetType.HOME: AssetTypeInfo("Home value", False),
        AssetType.VEHICLE: AssetTypeInfo("Vehicle value", False),
        AssetType.OTHER: AssetTypeInfo("Other", False),
    }
)


# --- Inputs -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Income:
    """Take-home pay per paycheck: after taxes and anything taken out of the paycheck."""

    id: str
    label: str
    owner: str
    amount: Decimal
    frequency: Frequency | str


@dataclass(frozen=True)
class Expense:
    id: str
    category: ExpenseCategory | str
    owner: str
    amount: Decimal
    frequency: Frequency | str
    label: str | None = None  # required for custom lines


@dataclass(frozen=True)
class Asset:
    id: str
    type: AssetType | str
    owner: str
    value: Decimal
    label: str | None = None


@dataclass(frozen=True)
class Household:
    household_type: HouseholdType | str
    people: tuple[Person, ...]
    incomes: tuple[Income, ...] = field(default_factory=tuple)
    expenses: tuple[Expense, ...] = field(default_factory=tuple)
    assets: tuple[Asset, ...] = field(default_factory=tuple)
    debts: tuple[Debt, ...] = field(default_factory=tuple)


# --- Outputs ----------------------------------------------------------------------------


@dataclass(frozen=True)
class IncomeLine:
    id: str
    label: str
    owner: str
    monthly: Decimal


@dataclass(frozen=True)
class CashFlowLine:
    id: str  # the expense id, or the debt id for lines from debts
    category: ExpenseCategory
    group: ExpenseGroup
    label: str
    owner: str
    monthly: Decimal
    source: str  # "entered" or "debts"


@dataclass(frozen=True)
class MonthlyTotals:
    income: Decimal
    spending: Decimal  # everything except debt payments, mortgage and saving
    debt_payments: Decimal  # debt payment lines plus mortgage
    saving: Decimal
    total_out: Decimal
    left_over: Decimal  # can be negative


@dataclass(frozen=True)
class Ratios:
    """Percentages and months with one decimal (half up), or None when dividing by 0."""

    debt_payments_pct: Decimal | None
    housing_pct: Decimal | None
    savings_rate_pct: Decimal | None
    emergency_fund_months: Decimal | None


@dataclass(frozen=True)
class NetWorth:
    total_assets: Decimal
    total_debt_balances: Decimal
    net_worth: Decimal
    liquid_assets: Decimal


@dataclass(frozen=True)
class OwnerTotals:
    income: Decimal
    entered_expenses: Decimal
    debt_payments: Decimal
    debt_balances: Decimal
    assets: Decimal


@dataclass(frozen=True)
class HouseholdResult:
    household_type: HouseholdType
    people: tuple[Person, ...]
    incomes: tuple[IncomeLine, ...]
    lines: tuple[CashFlowLine, ...]
    group_totals: Mapping[ExpenseGroup, Decimal]  # every group, in table order
    totals: MonthlyTotals
    ratios: Ratios
    net_worth: NetWorth
    by_owner: Mapping[str, OwnerTotals] | None  # couples only: p1, p2, joint
    notes: tuple[str, ...]


NOTE_TAKE_HOME = (
    "Income is take-home pay, so retirement savings taken out of a paycheck aren't counted "
    "as saving here."
)
NOTE_LENDERS = (
    "Lenders usually compare debt payments to income before taxes, so their percentage will "
    "be lower than this one."
)
NOTE_HAND_ENTERED_DEBT = (
    "Net worth doesn't include debts entered only as a monthly payment. Add them on the "
    "Debts tab for the full picture."
)
ALREADY_COUNTED = "This is already counted from your Debts tab."


# --- Validation -------------------------------------------------------------------------


def _validate_people(household: Household) -> tuple[HouseholdType, tuple[str, ...]]:
    try:
        kind = HouseholdType(household.household_type)
    except ValueError:
        raise HouseholdInputError("household_type", "must be single or couple") from None
    expected = ("p1",) if kind is HouseholdType.SINGLE else ("p1", "p2")
    ids = tuple(p.id for p in household.people)
    if ids != expected:
        need = "one person (p1)" if kind is HouseholdType.SINGLE else "two people (p1 and p2)"
        raise HouseholdInputError("people", f"a {kind.value} household needs {need}")
    for i, person in enumerate(household.people):
        name = person.name
        if not isinstance(name, str) or not name.strip():
            raise HouseholdInputError(f"people[{i}].name", "Enter a name.")
        if len(name) > MAX_PERSON_NAME_LENGTH:
            raise HouseholdInputError(
                f"people[{i}].name", f"must be {MAX_PERSON_NAME_LENGTH} characters or fewer"
            )
    owners = ("p1",) if kind is HouseholdType.SINGLE else ("p1", "p2", JOINT)
    return kind, owners


def _check_owner(owner: str, owners: Sequence[str], path: str) -> None:
    if owner not in owners:
        allowed = ", ".join(owners)
        raise HouseholdInputError(f"{path}.owner", f"must be one of {allowed}, got {owner!r}")


def _check_amount(value: object, path: str, *, positive: bool) -> Decimal:
    if not isinstance(value, Decimal) or not value.is_finite():
        raise HouseholdInputError(path, "must be a Decimal")
    if positive and value <= 0:
        raise HouseholdInputError(path, f"must be greater than 0, got {value}")
    if not positive and value < 0:
        raise HouseholdInputError(path, f"must be at least 0, got {value}")
    return value


def _frequency(value: Frequency | str, path: str) -> Frequency:
    try:
        return Frequency(value)
    except ValueError:
        raise HouseholdInputError(path, f"unknown frequency {value!r}") from None


def _round_tenth(value: Decimal) -> Decimal:
    return value.quantize(_TENTH, rounding=ROUND_HALF_UP)


def _ratio(numerator: Decimal, denominator: Decimal, *, percent: bool) -> Decimal | None:
    if denominator == 0:
        return None
    with localcontext() as ctx:
        ctx.prec = _PRECISION
        value = numerator / denominator * (100 if percent else 1)
        return _round_tenth(value)


def _sum(values: Iterable[Decimal]) -> Decimal:
    return sum(values, _ZERO)


# --- Calculation ------------------------------------------------------------------------


def analyze_household(household: Household) -> HouseholdResult:
    """The monthly cash flow, ratios and net worth for one person or a couple.

    Invalid input raises :class:`HouseholdInputError` (or ``DebtInputError`` from
    the debts list) naming the field. Nothing is defaulted or corrected.
    """
    kind, owners = _validate_people(household)

    incomes: list[IncomeLine] = []
    for i, income in enumerate(household.incomes):
        path = f"incomes[{i}]"
        _check_owner(income.owner, owners, path)
        amount = _check_amount(income.amount, f"{path}.amount", positive=True)
        frequency = _frequency(income.frequency, f"{path}.frequency")
        if not isinstance(income.label, str) or not income.label.strip():
            raise HouseholdInputError(f"{path}.label", "Enter a label for this income.")
        incomes.append(
            IncomeLine(income.id, income.label, income.owner, to_monthly(amount, frequency))
        )

    # Debts first: their payments are expense lines, and hand-entered lines for the
    # same kind of debt would count them twice.
    for i, debt in enumerate(household.debts):
        _check_owner(debt.owner, owners, f"debts[{i}]")
    debt_lines: list[CashFlowLine] = []
    debt_balances_by_owner: dict[str, Decimal] = {}
    total_debt_balances = _ZERO
    debt_categories: set[ExpenseCategory] = set()
    if household.debts:
        debts_result = analyze_debts(household.debts)
        for debt, result in zip(household.debts, debts_result.debts, strict=True):
            category = DEBT_TO_EXPENSE[result.category]
            info = EXPENSE_CATEGORIES[category]
            debt_categories.add(category)
            balance = result.result.assumptions.principal
            total_debt_balances += balance
            debt_balances_by_owner[debt.owner] = (
                debt_balances_by_owner.get(debt.owner, _ZERO) + balance
            )
            debt_lines.append(
                CashFlowLine(
                    id=debt.id,
                    category=category,
                    group=info.group,
                    label=debt.name,
                    owner=debt.owner,
                    monthly=result.result.summary.regular_payment,
                    source="debts",
                )
            )

    entered_lines: list[CashFlowLine] = []
    hand_entered_debt = False
    for i, expense in enumerate(household.expenses):
        path = f"expenses[{i}]"
        try:
            category = ExpenseCategory(expense.category)
        except ValueError:
            raise HouseholdInputError(
                f"{path}.category", f"unknown category {expense.category!r}"
            ) from None
        info = EXPENSE_CATEGORIES[category]
        if not info.enterable:
            raise HouseholdInputError(
                f"{path}.category", f"{info.label} comes from the Debts tab only."
            )
        if category in debt_categories:
            raise HouseholdInputError(f"{path}.category", ALREADY_COUNTED)
        _check_owner(expense.owner, owners, path)
        amount = _check_amount(expense.amount, f"{path}.amount", positive=False)
        frequency = _frequency(expense.frequency, f"{path}.frequency")
        label = info.label
        if category is ExpenseCategory.CUSTOM:
            if not isinstance(expense.label, str) or not expense.label.strip():
                raise HouseholdInputError(f"{path}.label", "Enter a label for this expense.")
            label = expense.label
        monthly = to_monthly(amount, frequency)
        if info.group is ExpenseGroup.DEBT_PAYMENTS and monthly > 0:
            hand_entered_debt = True
        entered_lines.append(
            CashFlowLine(expense.id, category, info.group, label, expense.owner, monthly, "entered")
        )

    assets_by_owner: dict[str, Decimal] = {}
    total_assets = liquid_assets = emergency_fund = _ZERO
    for i, asset in enumerate(household.assets):
        path = f"assets[{i}]"
        try:
            asset_type = AssetType(asset.type)
        except ValueError:
            raise HouseholdInputError(
                f"{path}.type", f"unknown asset type {asset.type!r}"
            ) from None
        _check_owner(asset.owner, owners, path)
        value = _check_amount(asset.value, f"{path}.value", positive=False)
        total_assets += value
        assets_by_owner[asset.owner] = assets_by_owner.get(asset.owner, _ZERO) + value
        if ASSET_TYPES[asset_type].liquid:
            liquid_assets += value
        if asset_type is AssetType.EMERGENCY_FUND:
            emergency_fund += value

    lines = tuple(entered_lines + debt_lines)
    group_totals = {g: _sum(ln.monthly for ln in lines if ln.group is g) for g in ExpenseGroup}
    mortgage = _sum(ln.monthly for ln in lines if ln.category is ExpenseCategory.MORTGAGE)
    housing = _sum(ln.monthly for ln in lines if ln.category is ExpenseCategory.HOUSING)

    income_total = _sum(line.monthly for line in incomes)
    debt_payments = group_totals[ExpenseGroup.DEBT_PAYMENTS] + mortgage
    saving = group_totals[ExpenseGroup.SAVING]
    spending = _sum(group_totals.values()) - debt_payments - saving
    total_out = spending + debt_payments + saving
    totals = MonthlyTotals(
        income=income_total,
        spending=spending,
        debt_payments=debt_payments,
        saving=saving,
        total_out=total_out,
        left_over=income_total - total_out,
    )

    ratios = Ratios(
        debt_payments_pct=_ratio(debt_payments, income_total, percent=True),
        housing_pct=_ratio(housing + mortgage, income_total, percent=True),
        savings_rate_pct=_ratio(saving, income_total, percent=True),
        emergency_fund_months=_ratio(emergency_fund, spending + debt_payments, percent=False),
    )

    by_owner: dict[str, OwnerTotals] | None = None
    if kind is HouseholdType.COUPLE:
        by_owner = {}
        for owner in owners:
            by_owner[owner] = OwnerTotals(
                income=_sum(line.monthly for line in incomes if line.owner == owner),
                entered_expenses=_sum(ln.monthly for ln in entered_lines if ln.owner == owner),
                debt_payments=_sum(
                    ln.monthly
                    for ln in lines
                    if ln.owner == owner
                    and (
                        ln.group is ExpenseGroup.DEBT_PAYMENTS
                        or ln.category is ExpenseCategory.MORTGAGE
                    )
                ),
                debt_balances=debt_balances_by_owner.get(owner, _ZERO),
                assets=assets_by_owner.get(owner, _ZERO),
            )

    notes = [NOTE_TAKE_HOME]
    if debt_payments > 0:
        notes.append(NOTE_LENDERS)
    if hand_entered_debt:
        notes.append(NOTE_HAND_ENTERED_DEBT)

    return HouseholdResult(
        household_type=kind,
        people=household.people,
        incomes=tuple(incomes),
        lines=lines,
        group_totals=MappingProxyType(group_totals),
        totals=totals,
        ratios=ratios,
        net_worth=NetWorth(
            total_assets=total_assets,
            total_debt_balances=total_debt_balances,
            net_worth=total_assets - total_debt_balances,
            liquid_assets=liquid_assets,
        ),
        by_owner=None if by_owner is None else MappingProxyType(by_owner),
        notes=tuple(notes),
    )
