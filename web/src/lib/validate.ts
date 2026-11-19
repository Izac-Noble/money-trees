/**
 * Input checks before calling the API: format only (is this a number the API can
 * read?). Range rules like "rate below 100%" are left to the API, which reports
 * them per field. No money math here.
 */
import { percentToFraction } from "./percent";

const MONEY = /^\d+(\.\d{1,2})?$/;
const WHOLE = /^\d+$/;

export type Check<T> = { value: T } | { error: string } | { missing: true };

/** Strip spaces and thousands separators the user may type ("250,000"). */
function clean(text: string): string {
  return text.trim().replace(/[\s,]/g, "");
}

export function checkMoney(text: string, { optional = false } = {}): Check<string> {
  const value = clean(text);
  if (value === "") return optional ? { value: "0" } : { missing: true };
  if (!MONEY.test(value)) return { error: "Enter an amount like 2500 or 2500.50." };
  return { value };
}

export function checkPercent(text: string): Check<string> {
  const value = clean(text).replace(/%$/, "");
  if (value === "") return { missing: true };
  const fraction = percentToFraction(value);
  if (fraction === null) return { error: "Enter a rate like 6 or 6.5." };
  return { value: fraction };
}

export function checkWhole(text: string): Check<number> {
  const value = clean(text);
  if (value === "") return { missing: true };
  if (!WHOLE.test(value)) return { error: "Enter a whole number." };
  return { value: Number(value) };
}
