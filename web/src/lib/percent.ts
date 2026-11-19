/**
 * Percent text <-> the API's rate fraction, by moving the decimal point in the
 * string. Nothing passes through floating point.
 */

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}

function join(intPart: string, decPart: string): string {
  const whole = stripLeadingZeros(intPart || "0");
  const dec = decPart.replace(/0+$/, "");
  return dec ? `${whole}.${dec}` : whole;
}

/**
 * "6" -> "0.06", "6.5" -> "0.065", "0.25" -> "0.0025".
 * Returns null when the text isn't a plain non-negative decimal number.
 */
export function percentToFraction(input: string): string | null {
  const match = /^(\d*)(?:\.(\d*))?$/.exec(input.trim());
  if (!match) return null;
  const whole = match[1] ?? "";
  const frac = match[2] ?? "";
  if (whole === "" && frac === "") return null;
  let digits = (whole || "0") + frac;
  let point = (whole || "0").length - 2;
  if (point < 1) {
    digits = "0".repeat(1 - point) + digits;
    point = 1;
  }
  return join(digits.slice(0, point), digits.slice(point));
}

/** "0.065" -> "6.5". Returns the input unchanged if it isn't a plain decimal. */
export function fractionToPercent(fraction: string): string {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(fraction.trim());
  if (!match) return fraction;
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(2, "0");
  return join(whole + frac.slice(0, 2), frac.slice(2));
}
