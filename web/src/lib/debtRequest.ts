import type { DebtRequest } from "../api";
import type { DebtInput, TermUnit } from "./storage";
import { checkTerm } from "./term";
import { checkMoney, checkPercent } from "./validate";

/** Categories the API accepts, with display labels. Credit cards are not offered. */
export const CATEGORY_LABELS: Record<string, string> = {
  mortgage: "Mortgage",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  other: "Other",
};

/** The fields of one debt, named as the API names them. */
export const DEBT_FIELDS = ["name", "category", "principal", "annual_rate", "term_months"] as const;
export type DebtField = (typeof DEBT_FIELDS)[number];

export const DEBT_MISSING: Record<DebtField, string> = {
  name: "Enter a name for this debt.",
  category: "Choose a type.",
  principal: "Enter the balance you still owe.",
  annual_rate: "Enter the interest rate.",
  term_months: "Enter the time left to pay.",
};

export type BuiltDebts = {
  /** Complete debts only, ready for the API. Empty when none are complete. */
  debts: DebtRequest[];
  /** For each debt in `debts`, its index in the input rows (to map API errors back). */
  rowIndex: number[];
  /** Ids of debts that are missing something or have a format problem. */
  incomplete: string[];
  /** Problems keyed by debt id, then by API field name. */
  problems: Record<string, Partial<Record<DebtField, string>>>;
};

/**
 * Turn the Debts tab's rows into the API's debt list. Incomplete debts are left
 * out, so the rest still calculate. No money math.
 */
export function buildDebts(rows: DebtInput[]): BuiltDebts {
  const built: BuiltDebts = { debts: [], rowIndex: [], incomplete: [], problems: {} };
  rows.forEach((row, i) => {
    const problems: Partial<Record<DebtField, string>> = {};
    const balance = checkMoney(row.balance);
    const rate = checkPercent(row.ratePercent);
    const term = checkTerm(row.term, row.termUnit);
    if (!row.name.trim()) problems.name = DEBT_MISSING.name;
    if (!row.category) problems.category = DEBT_MISSING.category;
    if ("error" in balance) problems.principal = balance.error;
    else if ("missing" in balance) problems.principal = DEBT_MISSING.principal;
    if ("error" in rate) problems.annual_rate = rate.error;
    else if ("missing" in rate) problems.annual_rate = DEBT_MISSING.annual_rate;
    if ("error" in term) problems.term_months = term.error;
    else if ("missing" in term) problems.term_months = DEBT_MISSING.term_months;

    built.problems[row.id] = problems;
    if ("value" in balance && "value" in rate && "months" in term && !Object.keys(problems).length) {
      built.debts.push({
        id: row.id,
        name: row.name,
        category: row.category,
        principal: balance.value,
        annual_rate: rate.value,
        term_months: term.months,
      });
      built.rowIndex.push(i);
    } else {
      built.incomplete.push(row.id);
    }
  });
  return built;
}

/** "1 debt is incomplete and isn't included yet." */
export function incompleteNote(count: number): string {
  return count === 1
    ? "1 debt is incomplete and isn't included yet."
    : `${count} debts are incomplete and aren't included yet.`;
}

/**
 * The time left after picking a type: the suggested term from /api/meta, but only
 * when the field is empty. Never overwrites what the user typed. Shown in the
 * user's chosen unit when it divides evenly, otherwise in months.
 */
export function termAfterCategoryChange(
  current: { term: string; termUnit: TermUnit },
  suggestedMonths: number | null | undefined,
): { term: string; termUnit: TermUnit } {
  if (current.term.trim() !== "" || suggestedMonths === null || suggestedMonths === undefined) {
    return current;
  }
  if (current.termUnit === "years" && suggestedMonths % 12 === 0) {
    return { term: String(suggestedMonths / 12), termUnit: "years" };
  }
  return { term: String(suggestedMonths), termUnit: "months" };
}
