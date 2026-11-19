import type { AmortizationRequest } from "../api";
import type { LoanInput } from "./storage";
import { checkTerm } from "./term";
import { checkMoney, checkPercent, checkWhole, type Check } from "./validate";

type Built = {
  request: AmortizationRequest | null;
  /**
   * Problems keyed by API field path, including missing required values. The form
   * shows each one only after the user has left that field (see useTouched).
   */
  errors: Record<string, string>;
  hasExtras: boolean;
};

export const LOAN_MISSING = {
  principal: "Enter the loan amount.",
  annual_rate: "Enter the interest rate.",
  term_months: "Enter the term.",
  lumpMonth: "Enter the month for this lump sum.",
  lumpAmount: "Enter the lump sum amount.",
} as const;

function note<T>(errors: Record<string, string>, field: string, check: Check<T>, missing: string) {
  if ("error" in check) errors[field] = check.error;
  else if ("missing" in check) errors[field] = missing;
}

/** Turn the form into an API request. Returns null while anything required is missing. */
export function buildLoanRequest(loan: LoanInput): Built {
  const errors: Record<string, string> = {};
  const amount = checkMoney(loan.amount);
  const rate = checkPercent(loan.ratePercent);
  const term = checkTerm(loan.term, loan.termUnit);
  const extra = checkMoney(loan.extra, { optional: true });
  note(errors, "principal", amount, LOAN_MISSING.principal);
  note(errors, "annual_rate", rate, LOAN_MISSING.annual_rate);
  if ("error" in term) errors.term_months = term.error;
  else if ("missing" in term) errors.term_months = LOAN_MISSING.term_months;
  note(errors, "extra_monthly", extra, "");

  const lumpSums: { month: number; amount: string }[] = [];
  loan.lumpSums.forEach((row, i) => {
    const month = checkWhole(row.month);
    const lumpAmount = checkMoney(row.amount);
    note(errors, `lump_sums[${i}].month`, month, LOAN_MISSING.lumpMonth);
    note(errors, `lump_sums[${i}].amount`, lumpAmount, LOAN_MISSING.lumpAmount);
    if ("value" in month && "value" in lumpAmount) {
      lumpSums.push({ month: month.value, amount: lumpAmount.value });
    }
  });

  if (
    Object.keys(errors).length > 0 ||
    !("value" in amount) ||
    !("value" in rate) ||
    !("months" in term)
  ) {
    return { request: null, errors, hasExtras: false };
  }
  const extraValue = "value" in extra ? extra.value : "0";
  const hasExtras = !/^0+(\.0*)?$/.test(extraValue) || lumpSums.length > 0;
  return {
    request: {
      principal: amount.value,
      annual_rate: rate.value,
      term_months: term.months,
      extra_monthly: extraValue,
      lump_sums: lumpSums,
    },
    errors,
    hasExtras,
  };
}
