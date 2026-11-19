/**
 * A loan term typed as years or months. Converting whole years to months is
 * counting, not money math; everything financial still comes from the API.
 */
import type { TermUnit } from "./storage";

export type TermCheck = { months: number } | { error: string } | { missing: true };

const NUMBER = /^\d+(\.\d+)?$/;

export function checkTerm(text: string, unit: TermUnit): TermCheck {
  const value = text.trim();
  if (value === "") return { missing: true };
  if (!NUMBER.test(value)) {
    return { error: unit === "years" ? "Enter a number of years." : "Enter a number of months." };
  }
  if (!/^\d+$/.test(value)) {
    return unit === "years"
      ? { error: "Use whole years, or switch to Months for anything in between." }
      : { error: "Enter a whole number of months." };
  }
  const count = Number(value);
  if (count === 0) {
    return { error: unit === "years" ? "Enter at least 1 year." : "Enter at least 1 month." };
  }
  return { months: unit === "years" ? count * 12 : count };
}

/** The line under the field, e.g. "= 48 months" or "= 4 years 6 months". Null when invalid. */
export function describeTerm(text: string, unit: TermUnit): string | null {
  const check = checkTerm(text, unit);
  if (!("months" in check)) return null;
  const { months } = check;
  if (unit === "years") return `= ${months} ${months === 1 ? "month" : "months"}`;
  if (months < 12) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `= ${years} ${years === 1 ? "year" : "years"} ${rest} ${rest === 1 ? "month" : "months"}`;
}
