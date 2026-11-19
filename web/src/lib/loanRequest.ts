import type { AmortizationRequest } from "../api";
import type { LoanInput } from "./storage";
import { checkMoney, checkPercent, checkWhole } from "./validate";

type Built = {
  request: AmortizationRequest | null;
  /** Format errors keyed by API field path, shown before anything is sent. */
  errors: Record<string, string>;
  hasExtras: boolean;
};

/** Turn the form into an API request. Returns null while anything required is missing. */
export function buildLoanRequest(loan: LoanInput): Built {
  const errors: Record<string, string> = {};
  let complete = true;
  const amount = checkMoney(loan.amount);
  const rate = checkPercent(loan.ratePercent);
  const term = checkWhole(loan.term);
  const extra = checkMoney(loan.extra, { optional: true });
  for (const [field, check] of [
    ["principal", amount],
    ["annual_rate", rate],
    ["term_months", term],
    ["extra_monthly", extra],
  ] as const) {
    if ("error" in check) errors[field] = check.error;
    if (!("value" in check)) complete = false;
  }
  const lumpSums: { month: number; amount: string }[] = [];
  loan.lumpSums.forEach((row, i) => {
    const month = checkWhole(row.month);
    const lumpAmount = checkMoney(row.amount);
    if ("error" in month) errors[`lump_sums[${i}].month`] = month.error;
    if ("error" in lumpAmount) errors[`lump_sums[${i}].amount`] = lumpAmount.error;
    if ("value" in month && "value" in lumpAmount) {
      lumpSums.push({ month: month.value, amount: lumpAmount.value });
    } else {
      complete = false;
    }
  });
  if (!complete || !("value" in amount) || !("value" in rate) || !("value" in term)) {
    return { request: null, errors, hasExtras: false };
  }
  const extraValue = "value" in extra ? extra.value : "0";
  const termMonths = loan.termUnit === "years" ? term.value * 12 : term.value;
  const hasExtras = !/^0+(\.0*)?$/.test(extraValue) || lumpSums.length > 0;
  return {
    request: {
      principal: amount.value,
      annual_rate: rate.value,
      term_months: termMonths,
      extra_monthly: extraValue,
      lump_sums: lumpSums,
    },
    errors,
    hasExtras,
  };
}

