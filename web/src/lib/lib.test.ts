import { afterEach, describe, expect, it, vi } from "vitest";
import { EM_DASH, findEmDashes } from "./emdash";
import { formatDuration, formatMoney } from "./format";
import { fractionToPercent, percentToFraction } from "./percent";
import {
  STORAGE_KEY,
  clearData,
  emptyData,
  loadData,
  parseSaved,
  saveData,
  toSaved,
  type AppData,
} from "./storage";

describe("percentToFraction", () => {
  it.each([
    ["6", "0.06"],
    ["6.5", "0.065"],
    ["0.25", "0.0025"],
    ["12", "0.12"],
    ["100", "1"],
    ["0", "0"],
    [".5", "0.005"],
    ["4.125", "0.04125"],
    ["007", "0.07"],
  ])("%s%% is %s", (input, expected) => {
    expect(percentToFraction(input)).toBe(expected);
  });

  it.each(["", ".", "abc", "-1", "1e2", "6.5.1", "6,5"])("rejects %j", (input) => {
    expect(percentToFraction(input)).toBeNull();
  });

  it("round-trips back to a percent", () => {
    expect(fractionToPercent("0.065")).toBe("6.5");
    expect(fractionToPercent("0.0025")).toBe("0.25");
    expect(fractionToPercent("0.06")).toBe("6");
  });
});

describe("formatMoney", () => {
  it("formats USD exactly as the API returns it", () => {
    expect(formatMoney("1199.10", "USD")).toBe("$1,199.10");
    expect(formatMoney("231677.04", "USD")).toBe("$231,677.04");
    expect(formatMoney("0.00", "USD")).toBe("$0.00");
    expect(formatMoney("12345678901234567.89", "USD")).toBe("$12,345,678,901,234,567.89");
  });

  it("shows UGX with no decimal places, rounding half up", () => {
    expect(formatMoney("1199.10", "UGX")).toBe("UGX 1,199");
    expect(formatMoney("1199.50", "UGX")).toBe("UGX 1,200");
    expect(formatMoney("999999.99", "UGX")).toBe("UGX 1,000,000");
    expect(formatMoney("0.00", "UGX")).toBe("UGX 0");
  });

  it("keeps negative values", () => {
    expect(formatMoney("-16.00", "USD")).toBe("-$16.00");
  });
});

describe("formatDuration", () => {
  it.each([
    [252, "21 years 0 months"],
    [13, "1 year 1 month"],
    [8, "8 months"],
    [360, "30 years 0 months"],
  ])("%i months", (months, text) => {
    expect(formatDuration(months)).toBe(text);
  });
});

describe("em dash check", () => {
  it("finds an em dash in a sample string", () => {
    expect(findEmDashes(`line one\nScaffold ${EM_DASH} no features yet.`)).toEqual([2]);
  });

  it("passes text with hyphens and en dashes", () => {
    expect(findEmDashes("Spec 1-3, months 1–6")).toEqual([]);
  });
});

function sample(): AppData {
  const data = emptyData();
  data.currency = "UGX";
  data.loan = { ...data.loan, amount: "200000", ratePercent: "6", term: "30" };
  data.debts = [
    {
      id: "c1",
      name: "Car loan",
      category: "auto",
      balance: "15000",
      ratePercent: "9",
      termMonths: "60",
    },
  ];
  data.plan = { extra: "300" };
  return data;
}

describe("local storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("saves and reloads under one versioned key", () => {
    expect(saveData(sample())).toBe(true);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(raw.version).toBe(1);
    expect(loadData()).toEqual(sample());
  });

  it("ignores data saved with a different schema version", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, data: sample() }));
    expect(loadData()).toEqual(emptyData());
  });

  it("ignores corrupt data", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadData()).toEqual(emptyData());
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadData()).toEqual(emptyData());
    expect(saveData(sample())).toBe(false);
    expect(() => clearData()).not.toThrow();
  });

  it("validates saved files", () => {
    expect(parseSaved(toSaved(sample()))).toEqual(sample());
    expect(parseSaved({ version: 1, data: { ...sample(), currency: "EUR" } })).toBeNull();
    expect(parseSaved({ version: 1, data: { ...sample(), debts: [{ id: 1 }] } })).toBeNull();
    expect(parseSaved({ version: 1 })).toBeNull();
    expect(parseSaved(null)).toBeNull();
  });
});
