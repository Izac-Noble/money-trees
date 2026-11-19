/**
 * Turn the Household tab (plus the Debts tab's debts) into a /api/household request.
 * No money math: amounts are checked for format and passed through as strings.
 */
import type { HouseholdRequest, Meta } from "../api";
import { buildDebts } from "./debtRequest";
import type { AppData, Owner } from "./storage";
import { checkMoney } from "./validate";

/** Problem keys used by the form (and by useTouched). */
export const nameKey = (i: number) => `name:${i}`;
export const incomeKey = (key: string, field: "label" | "amount") => `income:${key}:${field}`;
export const expenseKey = (category: string) => `expense:${category}:amount`;
export const customKey = (key: string, field: "label" | "amount") => `custom:${key}:${field}`;
export const assetKey = (key: string) => `asset:${key}:value`;

export type BuiltHousehold = {
  /** Null until names are filled in and /api/meta has loaded. */
  request: HouseholdRequest | null;
  /** Problems keyed by form key. Blank rows aren't problems: they just mean none. */
  problems: Record<string, string>;
  /** API error path (e.g. "expenses[2].amount") to form key. */
  pathToKey: Record<string, string>;
  /** Expense categories that come from debts on the Debts tab (shown read-only). */
  fromDebts: Set<string>;
};

function isZero(value: string): boolean {
  return /^0+(\.0*)?$/.test(value);
}

export function buildHousehold(data: AppData, meta: Meta | null): BuiltHousehold {
  const h = data.household;
  const problems: Record<string, string> = {};
  const pathToKey: Record<string, string> = {};
  const couple = h.kind === "couple";
  const owner = (o: Owner): Owner => (couple ? o : "p1");

  const fromDebts = new Set<string>();
  for (const debt of data.debts) {
    const mapped = meta?.categories.find((c) => c.value === debt.category)?.expense_category;
    if (mapped) fromDebts.add(mapped);
  }

  const people: HouseholdRequest["people"] = [];
  const ids = couple ? (["p1", "p2"] as const) : (["p1"] as const);
  ids.forEach((id, i) => {
    const name = h.names[i] ?? "";
    if (!name.trim()) problems[nameKey(i)] = "Enter a first name.";
    pathToKey[`people[${i}].name`] = nameKey(i);
    people.push({ id, name });
  });

  const incomes: HouseholdRequest["incomes"] = [];
  for (const row of h.incomes) {
    if (!row.label.trim() && !row.amount.trim()) continue;
    const amount = checkMoney(row.amount);
    let ok = true;
    if (!row.label.trim()) {
      problems[incomeKey(row.key, "label")] = "Enter a label, like Sam's job.";
      ok = false;
    }
    if ("error" in amount) {
      problems[incomeKey(row.key, "amount")] = amount.error;
      ok = false;
    } else if ("missing" in amount) {
      problems[incomeKey(row.key, "amount")] = "Enter the take-home amount.";
      ok = false;
    } else if (isZero(amount.value)) {
      problems[incomeKey(row.key, "amount")] = "Enter an amount greater than 0.";
      ok = false;
    }
    if (ok && "value" in amount) {
      const i = incomes.length;
      pathToKey[`incomes[${i}].amount`] = incomeKey(row.key, "amount");
      pathToKey[`incomes[${i}].label`] = incomeKey(row.key, "label");
      incomes.push({
        id: row.key,
        label: row.label,
        owner: owner(row.owner),
        amount: amount.value,
        frequency: row.frequency,
      });
    }
  }

  const expenses: HouseholdRequest["expenses"] = [];
  for (const category of meta?.expense_categories ?? []) {
    if (category.value === "custom" || !category.enterable) continue;
    if (fromDebts.has(category.value)) continue;
    const row = h.expenses[category.value];
    if (!row || !row.amount.trim()) continue;
    const amount = checkMoney(row.amount);
    if ("error" in amount) {
      problems[expenseKey(category.value)] = amount.error;
      continue;
    }
    if (!("value" in amount)) continue;
    const i = expenses.length;
    pathToKey[`expenses[${i}].amount`] = expenseKey(category.value);
    pathToKey[`expenses[${i}].category`] = expenseKey(category.value);
    expenses.push({
      id: `expense-${category.value}`,
      category: category.value,
      owner: owner(row.owner),
      amount: amount.value,
      frequency: row.frequency,
    });
  }
  for (const row of h.customExpenses) {
    if (!row.label.trim() && !row.amount.trim()) continue;
    const amount = checkMoney(row.amount, { optional: true });
    let ok = true;
    if (!row.label.trim()) {
      problems[customKey(row.key, "label")] = "Enter a name for this expense.";
      ok = false;
    }
    if ("error" in amount) {
      problems[customKey(row.key, "amount")] = amount.error;
      ok = false;
    }
    if (ok && "value" in amount) {
      const i = expenses.length;
      pathToKey[`expenses[${i}].amount`] = customKey(row.key, "amount");
      pathToKey[`expenses[${i}].label`] = customKey(row.key, "label");
      expenses.push({
        id: row.key,
        category: "custom",
        owner: owner(row.owner),
        amount: amount.value,
        frequency: row.frequency,
        label: row.label,
      });
    }
  }

  const assets: HouseholdRequest["assets"] = [];
  for (const row of h.assets) {
    if (!row.value.trim()) continue;
    const value = checkMoney(row.value);
    if ("error" in value) {
      problems[assetKey(row.key)] = value.error;
      continue;
    }
    if (!("value" in value)) continue;
    const i = assets.length;
    pathToKey[`assets[${i}].value`] = assetKey(row.key);
    assets.push({
      id: row.key,
      type: row.type,
      owner: owner(row.owner),
      value: value.value,
      ...(row.label.trim() ? { label: row.label } : {}),
    });
  }

  const builtDebts = buildDebts(data.debts);
  const debts = builtDebts.debts.map((d, i) => ({
    ...d,
    owner: owner(data.debts[builtDebts.rowIndex[i]!]!.owner),
  }));

  const namesMissing = people.some((p) => !p.name.trim());
  return {
    request:
      namesMissing || !meta
        ? null
        : { household_type: h.kind, people, incomes, expenses, assets, debts },
    problems,
    pathToKey,
    fromDebts,
  };
}

/** True when anything belongs to the second person or is joint (for Couple to Just me). */
export function hasPartnerOrJointItems(data: AppData): boolean {
  const h = data.household;
  const owners: Owner[] = [
    ...h.incomes.map((r) => r.owner),
    ...Object.values(h.expenses).map((r) => r.owner),
    ...h.customExpenses.map((r) => r.owner),
    ...h.assets.map((r) => r.owner),
    ...data.debts.map((d) => d.owner),
  ];
  return owners.some((o) => o !== "p1");
}

/** Everything moved to the first person, for switching Couple to Just me. */
export function reassignToFirstPerson(data: AppData): AppData {
  const h = data.household;
  const p1 = <T extends { owner: Owner }>(row: T): T => ({ ...row, owner: "p1" });
  return {
    ...data,
    household: {
      ...h,
      kind: "single",
      incomes: h.incomes.map(p1),
      expenses: Object.fromEntries(Object.entries(h.expenses).map(([k, v]) => [k, p1(v)])),
      customExpenses: h.customExpenses.map(p1),
      assets: h.assets.map(p1),
    },
    debts: data.debts.map(p1),
  };
}
