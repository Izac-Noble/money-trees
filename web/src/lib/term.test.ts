import { describe, expect, it } from "vitest";
import { checkTerm, describeTerm } from "./term";

describe("checkTerm", () => {
  it("converts whole years to months", () => {
    expect(checkTerm("4", "years")).toEqual({ months: 48 });
    expect(checkTerm("30", "years")).toEqual({ months: 360 });
  });

  it("keeps months as typed", () => {
    expect(checkTerm("54", "months")).toEqual({ months: 54 });
  });

  it("treats 0 as an error", () => {
    expect(checkTerm("0", "years")).toEqual({ error: "Enter at least 1 year." });
    expect(checkTerm("0", "months")).toEqual({ error: "Enter at least 1 month." });
  });

  it("asks for Months when years has a decimal", () => {
    expect(checkTerm("4.5", "years")).toEqual({
      error: "Use whole years, or switch to Months for anything in between.",
    });
  });

  it("reports empty and non-numeric input", () => {
    expect(checkTerm("  ", "years")).toEqual({ missing: true });
    expect(checkTerm("four", "years")).toEqual({ error: "Enter a number of years." });
    expect(checkTerm("2.5", "months")).toEqual({ error: "Enter a whole number of months." });
  });
});

describe("describeTerm", () => {
  it("shows the conversion under the field", () => {
    expect(describeTerm("4", "years")).toBe("= 48 months");
    expect(describeTerm("54", "months")).toBe("= 4 years 6 months");
    expect(describeTerm("8", "months")).toBeNull();
    expect(describeTerm("4.5", "years")).toBeNull();
  });
});
