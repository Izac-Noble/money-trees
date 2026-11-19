import type { DebtRequest, Meta } from "../api";
import type { DebtInput, PaymentMode } from "./storage";
import { checkTerm } from "./term";
import { checkMoney, checkPercent } from "./validate";

/** The fields of one debt, named as the API names them. */
export const DEBT_FIELDS = [
  "name",
  "category",
  "principal",
  "annual_rate",
  "term_months",
  "monthly_payment",
] as const;
export type DebtField = (typeof DEBT_FIELDS)[number];

export const DEBT_MISSING: Record<DebtField, string> = {
  name: "Enter a name for this debt.",
  category: "Choose a type.",
  principal: "Enter the balance you still owe.",
  annual_rate: "Enter the interest rate.",
  term_months: "Enter the time left to pay.",
  monthly_payment: "Enter the monthly payment.",
};

/** The label for a category id, from /api/meta. Never hardcoded. */
export function categoryLabel(meta: Meta | null, id: string): string {
  return meta?.categories.find((c) => c.value === id)?.label ?? id;
}

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
 * Turn the Debts tab's rows into the API's debt list. Only the field for the
 * chosen "Enter by" mode is used. Incomplete debts are left out, so the rest still
 * calculate. No money math.
 */
export function buildDebts(rows: DebtInput[]): BuiltDebts {
  const built: BuiltDebts = { debts: [], rowIndex: [], incomplete: [], problems: {} };
  rows.forEach((row, i) => {
    const problems: Partial<Record<DebtField, string>> = {};
    const balance = checkMoney(row.balance);
    const rate = checkPercent(row.ratePercent);
    if (!row.name.trim()) problems.name = DEBT_MISSING.name;
    if (!row.category) problems.category = DEBT_MISSING.category;
    if ("error" in balance) problems.principal = balance.error;
    else if ("missing" in balance) problems.principal = DEBT_MISSING.principal;
    if ("error" in rate) problems.annual_rate = rate.error;
    else if ("missing" in rate) problems.annual_rate = DEBT_MISSING.annual_rate;

    let timing: { term_months: number } | { monthly_payment: string } | null = null;
    if (row.paymentMode === "fixed_term") {
      const term = checkTerm(row.term, row.termUnit);
      if ("error" in term) problems.term_months = term.error;
      else if ("missing" in term) problems.term_months = DEBT_MISSING.term_months;
      else timing = { term_months: term.months };
    } else {
      const payment = checkMoney(row.monthlyPayment);
      if ("error" in payment) problems.monthly_payment = payment.error;
      else if ("missing" in payment) problems.monthly_payment = DEBT_MISSING.monthly_payment;
      else if (/^0+(\.0*)?$/.test(payment.value)) {
        problems.monthly_payment = "Enter a payment greater than 0.";
      } else timing = { monthly_payment: payment.value };
    }

    built.problems[row.id] = problems;
    if ("value" in balance && "value" in rate && timing && !Object.keys(problems).length) {
      built.debts.push({
        id: row.id,
        name: row.name,
        category: row.category,
        payment_mode: row.paymentMode,
        principal: balance.value,
        annual_rate: rate.value,
        ...timing,
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
 * Picking a type: pre-select its default "Enter by" mode, unless the user already
 * chose one (touched the toggle, or typed a time or payment). Also fill in its
 * suggested time left, but only when that field is empty. Never overrides the user.
 */
export function applyCategory(
  debt: DebtInput,
  category: string,
  meta: Meta | null,
): DebtInput {
  const info = meta?.categories.find((c) => c.value === category);
  const next: DebtInput = { ...debt, category };
  if (!info) return next;
  if (!debt.modeChosen) next.paymentMode = info.default_payment_mode as PaymentMode;
  const suggested = info.suggested_term_months;
  if (debt.term.trim() === "" && suggested !== null) {
    if (debt.termUnit === "years" && suggested % 12 === 0) {
      next.term = String(suggested / 12);
    } else {
      next.term = String(suggested);
      next.termUnit = "months";
    }
  }
  return next;
}

/** The message for a payment that doesn't cover the interest, using the API's min_interest. */
export function paymentTooSmallMessage(minInterest: string, format: (v: string) => string): string {
  return `This payment needs to be more than ${format(minInterest)} to bring the balance down.`;
}
