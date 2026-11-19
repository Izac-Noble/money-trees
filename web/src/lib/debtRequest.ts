import type { DebtRequest } from "../api";
import type { DebtInput } from "./storage";
import { checkMoney, checkPercent, checkWhole } from "./validate";

/** Categories the API accepts, with display labels. Credit cards are not offered. */
export const CATEGORY_LABELS: Record<string, string> = {
  mortgage: "Mortgage",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  other: "Other",
};

export type BuiltDebts = {
  /** Null while any debt is missing a required value or has a format error. */
  debts: DebtRequest[] | null;
  /** Format errors keyed by API field path, e.g. "debts[1].annual_rate". */
  errors: Record<string, string>;
};

/** Turn the Debts tab's rows into the API's debt list. No money math. */
export function buildDebts(rows: DebtInput[]): BuiltDebts {
  const errors: Record<string, string> = {};
  if (rows.length === 0) return { debts: null, errors };
  let complete = true;
  const debts: DebtRequest[] = [];
  rows.forEach((row, i) => {
    const path = `debts[${i}]`;
    const balance = checkMoney(row.balance);
    const rate = checkPercent(row.ratePercent);
    const term = checkWhole(row.termMonths);
    if ("error" in balance) errors[`${path}.principal`] = balance.error;
    if ("error" in rate) errors[`${path}.annual_rate`] = rate.error;
    if ("error" in term) errors[`${path}.term_months`] = term.error;
    if (!row.name.trim() || !row.category) complete = false;
    if ("value" in balance && "value" in rate && "value" in term) {
      debts.push({
        id: row.id,
        name: row.name,
        category: row.category,
        principal: balance.value,
        annual_rate: rate.value,
        term_months: term.value,
      });
    } else {
      complete = false;
    }
  });
  return { debts: complete ? debts : null, errors };
}

/**
 * The term to show after picking a category: the suggested term from /api/meta,
 * but only when the term field is empty. Never overwrites what the user typed.
 */
export function termAfterCategoryChange(
  currentTerm: string,
  suggested: number | null | undefined,
): string {
  if (currentTerm.trim() !== "" || suggested === null || suggested === undefined) {
    return currentTerm;
  }
  return String(suggested);
}
