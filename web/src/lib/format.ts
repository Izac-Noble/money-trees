/**
 * Display formatting for API values. Works on the decimal strings the API returns,
 * so nothing passes through floating point. Formatting only: no money math.
 */

/**
 * USD only for now. Every money value on screen goes through formatMoney, so adding
 * a currency later means adding it here.
 */
export type Currency = "USD";

export const CURRENCY: Currency = "USD";

/** The symbol shown inside money inputs. */
export function currencySymbol(currency: Currency = CURRENCY): string {
  return currency === "USD" ? "$" : currency;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format an API money string ("1199.10") for display: "$1,199.10". */
export function formatMoney(value: string, currency: Currency = CURRENCY): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const negative = match[1] === "-";
  const whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const cents = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  return `${negative ? "-" : ""}${currencySymbol(currency)}${groupThousands(whole)}.${cents}`;
}

/** "21 years 0 months", "1 year 1 month", "8 months". */
export function formatDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const m = `${rest} ${rest === 1 ? "month" : "months"}`;
  if (years === 0) return m;
  return `${years} ${years === 1 ? "year" : "years"} ${m}`;
}

/** Strings to numbers for chart plotting only. Never used for displayed values. */
export function toPlotNumber(value: string): number {
  return Number(value);
}
