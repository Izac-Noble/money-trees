/**
 * Display formatting for API values. Works on the decimal strings the API returns,
 * so nothing passes through floating point. Formatting only: no money math.
 */

export type Currency = "USD" | "UGX";

export const CURRENCIES: readonly { value: Currency; label: string }[] = [
  { value: "USD", label: "US dollar (USD)" },
  { value: "UGX", label: "Ugandan shilling (UGX)" },
];

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "UGX";
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Add one to a string of digits ("199" -> "200"), for half-up display rounding. */
function incrementDigits(digits: string): string {
  const chars = digits.split("");
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    if (chars[i] === "9") {
      chars[i] = "0";
    } else {
      chars[i] = String(Number(chars[i]) + 1);
      return chars.join("");
    }
  }
  return `1${chars.join("")}`;
}

/**
 * Format an API money string ("1199.10") for the chosen currency.
 * USD: "$1,199.10". UGX shows no decimal places, rounded half up: "UGX 1,199".
 */
export function formatMoney(value: string, currency: Currency): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const negative = match[1] === "-";
  let whole = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const frac = match[3] ?? "";
  if (currency === "UGX") {
    if ((frac[0] ?? "0") >= "5") whole = incrementDigits(whole);
    const sign = negative && whole !== "0" ? "-" : "";
    return `${sign}UGX ${groupThousands(whole)}`;
  }
  const cents = frac.padEnd(2, "0").slice(0, 2);
  return `${negative ? "-" : ""}$${groupThousands(whole)}.${cents}`;
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
