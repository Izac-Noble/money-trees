"""Spec 6: household and cash flow.

Expected values for cases H1-H4 are copied from the spec's test-case table. They are
not generated from this code. Per the spec they must be hand-verified before merge.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from money_trees_engine.debts import Debt, DebtInputError
from money_trees_engine.household import (
    ASSET_TYPES,
    EXPENSE_CATEGORIES,
    FREQUENCIES,
    NOTE_HAND_ENTERED_DEBT,
    NOTE_LENDERS,
    NOTE_TAKE_HOME,
    Asset,
    Expense,
    ExpenseGroup,
    Household,
    HouseholdInputError,
    HouseholdResult,
    Income,
    Person,
    analyze_household,
    to_monthly,
)

D = Decimal
J = "joint"

SAM_ALEX = (Person("p1", "Sam"), Person("p2", "Alex"))
H2_DEBTS = (
    Debt("pl", "Personal loan", "personal", D("3000"), D("0.04"), 24, owner="p1"),
    Debt("car", "Car loan", "auto", D("15000"), D("0.09"), 60, owner=J),
    Debt("stu", "Student loan", "student", D("20000"), D("0.06"), 120, owner="p2"),
    Debt(
        "cc",
        "Credit card",
        "credit_card",
        D("5000"),
        D("0.24"),
        None,
        payment_mode="fixed_payment",
        monthly_payment=D("200"),
        owner="p1",
    ),
)
H2_EXPENSES = tuple(
    Expense(f"e{i}", category, J, D(amount), frequency)
    for i, (category, amount, frequency) in enumerate(
        [
            ("housing", "1500", "monthly"),
            ("utilities", "180", "monthly"),
            ("phone", "120", "monthly"),
            ("internet", "70", "monthly"),
            ("insurance", "1200", "semiannual"),
            ("groceries", "600", "monthly"),
            ("gas", "250", "monthly"),
            ("eating_out", "300", "monthly"),
            ("miscellaneous", "150", "monthly"),
            ("giving", "400", "monthly"),
            ("emergency_fund", "300", "monthly"),
        ]
    )
)
H2 = Household(
    "couple",
    SAM_ALEX,
    incomes=(
        Income("i1", "Sam's job", "p1", D("2000"), "biweekly"),
        Income("i2", "Alex's job", "p2", D("1800"), "semimonthly"),
        Income("i3", "Alex's side job", "p2", D("150"), "weekly"),
    ),
    expenses=H2_EXPENSES,
    assets=(
        Asset("a1", "cash", J, D("4000")),
        Asset("a2", "emergency_fund", J, D("6000")),
        Asset("a3", "retirement", "p1", D("15000")),
        Asset("a4", "retirement", "p2", D("10000")),
        Asset("a5", "vehicle", J, D("18000")),
    ),
    debts=H2_DEBTS,
)

H4 = Household(
    "single",
    (Person("p1", "Jordan"),),
    incomes=(Income("i1", "Pay", "p1", D("1500"), "biweekly"),),
    expenses=tuple(
        Expense(f"e{i}", category, "p1", D(amount), frequency)
        for i, (category, amount, frequency) in enumerate(
            [
                ("housing", "1400", "monthly"),
                ("utilities", "150", "monthly"),
                ("phone", "80", "monthly"),
                ("internet", "60", "monthly"),
                ("insurance", "600", "yearly"),
                ("groceries", "450", "monthly"),
                ("gas", "200", "monthly"),
                ("eating_out", "350", "monthly"),
                ("miscellaneous", "200", "monthly"),
                ("giving", "100", "monthly"),
                ("credit_cards", "250", "monthly"),
            ]
        )
    ),
    assets=(Asset("a1", "cash", "p1", D("1200")),),
)


def assert_invariants(result: HouseholdResult) -> None:
    t = result.totals
    assert t.income == sum((line.monthly for line in result.incomes), D("0"))
    assert sum(result.group_totals.values(), D("0")) == sum(
        (line.monthly for line in result.lines), D("0")
    )
    assert t.total_out == t.spending + t.debt_payments + t.saving
    assert t.total_out == sum((line.monthly for line in result.lines), D("0"))
    assert t.left_over == t.income - t.total_out
    for line in result.lines:
        assert line.monthly == line.monthly.quantize(D("0.01"))
    nw = result.net_worth
    assert nw.net_worth == nw.total_assets - nw.total_debt_balances
    if result.by_owner is not None:
        assert sum((o.income for o in result.by_owner.values()), D("0")) == t.income
        assert sum((o.debt_payments for o in result.by_owner.values()), D("0")) == t.debt_payments
        assert sum((o.assets for o in result.by_owner.values()), D("0")) == nw.total_assets
        assert (
            sum((o.debt_balances for o in result.by_owner.values()), D("0"))
            == nw.total_debt_balances
        )


# --- H1: frequencies --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "frequency", "monthly"),
    [
        ("100", "weekly", "433.33"),
        ("100", "biweekly", "216.67"),
        ("100", "semimonthly", "200.00"),
        ("300", "quarterly", "100.00"),
        ("600", "semiannual", "100.00"),
        ("1000", "yearly", "83.33"),
    ],
)
def test_case_h1_frequency_conversion(amount: str, frequency: str, monthly: str) -> None:
    assert to_monthly(D(amount), frequency) == D(monthly)


def test_monthly_frequency_is_unchanged() -> None:
    assert to_monthly(D("123.45"), "monthly") == D("123.45")


# --- H2 and H3: a couple ----------------------------------------------------------------


def test_case_h2_couple() -> None:
    result = analyze_household(H2)
    assert_invariants(result)
    assert result.totals.income == D("8583.33")
    assert [line.monthly for line in result.incomes] == [D("4333.33"), D("3600.00"), D("650.00")]
    insurance = [line for line in result.lines if line.category == "insurance"]
    assert [line.monthly for line in insurance] == [D("200.00")]
    t = result.totals
    assert (t.spending, t.debt_payments, t.saving) == (D("3770.00"), D("863.69"), D("300.00"))
    assert t.total_out == D("4933.69")
    assert t.left_over == D("3649.64")
    r = result.ratios
    assert (r.debt_payments_pct, r.housing_pct, r.savings_rate_pct) == (
        D("10.1"),
        D("17.5"),
        D("3.5"),
    )
    assert r.emergency_fund_months == D("1.3")
    nw = result.net_worth
    assert nw.total_assets == D("53000.00")
    assert nw.total_debt_balances == D("43000.00")
    assert nw.net_worth == D("10000.00")
    assert nw.liquid_assets == D("10000.00")
    assert result.notes == (NOTE_TAKE_HOME, NOTE_LENDERS)


def test_case_h3_by_owner() -> None:
    by_owner = analyze_household(H2).by_owner
    assert by_owner is not None
    expected = {
        "p1": ("4333.33", "330.27", "8000.00", "15000.00"),
        "p2": ("4250.00", "222.04", "20000.00", "10000.00"),
        "joint": ("0.00", "311.38", "15000.00", "28000.00"),
    }
    for owner, (income, payments, balances, assets) in expected.items():
        totals = by_owner[owner]
        assert (totals.income, totals.debt_payments, totals.debt_balances, totals.assets) == (
            D(income),
            D(payments),
            D(balances),
            D(assets),
        ), owner
    assert list(by_owner) == ["p1", "p2", "joint"]


def test_debt_payments_become_lines_from_debts() -> None:
    lines = {line.id: line for line in analyze_household(H2).lines if line.source == "debts"}
    assert {k: (v.category.value, v.monthly, v.owner) for k, v in lines.items()} == {
        "pl": ("personal_loan", D("130.27"), "p1"),
        "car": ("car_payment", D("311.38"), J),
        "stu": ("student_loan", D("222.04"), "p2"),
        "cc": ("credit_cards", D("200"), "p1"),
    }


# --- H4: a single person spending more than they earn -----------------------------------


def test_case_h4_single_overspending() -> None:
    result = analyze_household(H4)
    assert_invariants(result)
    t = result.totals
    assert t.income == D("3250.00")
    assert t.spending == D("3040.00")
    assert t.debt_payments == D("250.00")
    assert t.saving == D("0.00")
    assert t.left_over == D("-40.00")
    r = result.ratios
    assert (r.debt_payments_pct, r.housing_pct) == (D("7.7"), D("43.1"))
    assert (r.savings_rate_pct, r.emergency_fund_months) == (D("0.0"), D("0.0"))
    assert result.net_worth.net_worth == D("1200.00")
    assert NOTE_HAND_ENTERED_DEBT in result.notes
    assert result.by_owner is None


# --- Behaviour --------------------------------------------------------------------------


def test_ratios_are_none_when_dividing_by_zero() -> None:
    result = analyze_household(Household("single", (Person("p1", "Kim"),)))
    r = result.ratios
    assert (r.debt_payments_pct, r.housing_pct, r.savings_rate_pct) == (None, None, None)
    assert r.emergency_fund_months is None
    assert result.notes == (NOTE_TAKE_HOME,)


def test_several_lines_in_one_category_add_together() -> None:
    household = replace(
        H4,
        expenses=(
            Expense("a", "groceries", "p1", D("100"), "monthly"),
            Expense("b", "groceries", "p1", D("50"), "weekly"),
        ),
    )
    result = analyze_household(household)
    assert result.group_totals[ExpenseGroup.EVERYDAY] == D("316.67")


def test_custom_line_uses_its_label() -> None:
    household = replace(
        H4, expenses=(Expense("x", "custom", "p1", D("40"), "monthly", label="Gym"),)
    )
    [line] = analyze_household(household).lines
    assert (line.label, line.group) == ("Gym", ExpenseGroup.OTHER)


def test_mortgage_counts_as_housing_and_debt_payments() -> None:
    mortgage = Debt("m", "Home", "mortgage", D("200000"), D("0.06"), 360)
    result = analyze_household(replace(H4, expenses=(), debts=(mortgage,)))
    assert result.totals.debt_payments == D("1199.10")
    assert result.totals.spending == D("0.00")
    assert result.ratios.housing_pct == result.ratios.debt_payments_pct


def test_other_debt_categories_land_on_other_debt() -> None:
    medical = Debt(
        "md",
        "Hospital",
        "medical",
        D("2400"),
        D("0"),
        None,
        payment_mode="fixed_payment",
        monthly_payment=D("100"),
    )
    [line] = analyze_household(replace(H4, expenses=(), debts=(medical,))).lines
    assert (line.category.value, line.monthly) == ("other_debt", D("100"))


def test_zero_expense_is_allowed() -> None:
    result = analyze_household(
        replace(H4, expenses=(Expense("z", "phone", "p1", D("0"), "monthly"),))
    )
    assert result.totals.spending == D("0.00")


def test_tables_are_complete() -> None:
    assert len(FREQUENCIES) == 7
    assert len(EXPENSE_CATEGORIES) == 18
    assert {t.value: i.liquid for t, i in ASSET_TYPES.items()} == {
        "cash": True,
        "emergency_fund": True,
        "investments": True,
        "retirement": False,
        "home": False,
        "vehicle": False,
        "other": False,
    }
    assert not EXPENSE_CATEGORIES["mortgage"].enterable  # type: ignore[index]
    assert EXPENSE_CATEGORIES["car_payment"].enterable  # type: ignore[index]


def test_is_deterministic() -> None:
    assert analyze_household(H2) == analyze_household(H2)


# --- Validation -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("household", "field"),
    [
        (Household("couple", (Person("p1", "Sam"),)), "people"),
        (Household("single", SAM_ALEX), "people"),
        (Household("couple", (Person("p1", "Sam"), Person("p2", " "))), "people[1].name"),
        (Household("single", (Person("p1", "x" * 41),)), "people[0].name"),
        (Household("trio", (Person("p1", "Sam"),)), "household_type"),
    ],
)
def test_people_validation(household: Household, field: str) -> None:
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(household)
    assert info.value.field == field


@pytest.mark.parametrize("owner", ["joint", "p2"])
def test_single_household_rejects_other_owners(owner: str) -> None:
    household = replace(H4, assets=(Asset("a", "cash", owner, D("1")),))
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(household)
    assert info.value.field == "assets[0].owner"


def test_single_household_rejects_a_joint_debt() -> None:
    debt = replace(H2_DEBTS[1], owner=J)
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(replace(H4, expenses=(), debts=(debt,)))
    assert info.value.field == "debts[0].owner"


@pytest.mark.parametrize(
    ("category", "debt"),
    [
        ("car_payment", H2_DEBTS[1]),
        ("personal_loan", H2_DEBTS[0]),
        ("student_loan", H2_DEBTS[2]),
        ("credit_cards", H2_DEBTS[3]),
    ],
)
def test_hand_entered_line_conflicts_with_a_debt(category: str, debt: Debt) -> None:
    household = replace(
        H2,
        expenses=(*H2_EXPENSES, Expense("dup", category, J, D("10"), "monthly")),
        debts=(debt,),
    )
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(household)
    assert info.value.field == f"expenses[{len(H2_EXPENSES)}].category"
    assert info.value.message == "This is already counted from your Debts tab."


@pytest.mark.parametrize("category", ["mortgage", "other_debt"])
def test_debt_only_categories_cant_be_entered(category: str) -> None:
    household = replace(H4, expenses=(Expense("x", category, "p1", D("10"), "monthly"),))
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(household)
    assert info.value.field == "expenses[0].category"


@pytest.mark.parametrize(
    ("household", "field"),
    [
        (
            replace(H4, expenses=(Expense("x", "custom", "p1", D("1"), "monthly"),)),
            "expenses[0].label",
        ),
        (
            replace(H4, expenses=(Expense("x", "phone", "p1", D("-1"), "monthly"),)),
            "expenses[0].amount",
        ),
        (replace(H4, assets=(Asset("x", "cash", "p1", D("-1")),)), "assets[0].value"),
        (replace(H4, incomes=(Income("i", "Pay", "p1", D("0"), "monthly"),)), "incomes[0].amount"),
        (replace(H4, incomes=(Income("i", "Pay", "p1", D("1"), "daily"),)), "incomes[0].frequency"),
        (
            replace(H4, expenses=(Expense("x", "pets", "p1", D("1"), "monthly"),)),
            "expenses[0].category",
        ),
        (replace(H4, assets=(Asset("x", "boat", "p1", D("1")),)), "assets[0].type"),
        (
            replace(H4, expenses=(Expense("x", "phone", "p1", D("1"), "hourly"),)),
            "expenses[0].frequency",
        ),
    ],
)
def test_item_validation(household: Household, field: str) -> None:
    with pytest.raises(HouseholdInputError) as info:
        analyze_household(household)
    assert info.value.field == field


def test_debt_list_rules_still_apply() -> None:
    bad = replace(H2_DEBTS[1], category="car_loan")
    with pytest.raises(DebtInputError):
        analyze_household(replace(H2, debts=(bad,)))
