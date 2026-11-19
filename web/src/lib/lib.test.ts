import { afterEach, describe, expect, it, vi } from "vitest";
import { EM_DASH, findEmDashes } from "./emdash";
import { formatDuration, formatMoney } from "./format";
import { fractionToPercent, percentToFraction } from "./percent";
import {
  LEGACY_STORAGE_KEY,
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

  it("defaults to USD, the only currency for now", () => {
    expect(formatMoney("863.69")).toBe("$863.69");
    expect(formatMoney("5")).toBe("$5.00");
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
  data.timeUnit = "months";
  data.loan = { ...data.loan, amount: "200000", ratePercent: "6", term: "30" };
  data.debts = [
    {
      id: "c1",
      name: "Car loan",
      category: "auto",
      balance: "15000",
      ratePercent: "9",
      paymentMode: "fixed_term",
      modeChosen: true,
      term: "60",
      termUnit: "months",
      monthlyPayment: "",
      owner: "p1",
    },
    {
      id: "cc",
      name: "Card",
      category: "credit_card",
      balance: "5000",
      ratePercent: "24",
      paymentMode: "fixed_payment",
      modeChosen: true,
      term: "3",
      termUnit: "years",
      monthlyPayment: "200",
      owner: "joint",
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
    expect(raw.version).toBe(4);
    expect(loadData()).toEqual(sample());
  });

  it("ignores data saved with a different schema version", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 5, data: sample() }));
    expect(loadData()).toEqual(emptyData());
  });

  it("upgrades version 1 data, where debts stored months only", () => {
    const v1 = {
      version: 1,
      data: {
        currency: "USD",
        loan: emptyData().loan,
        debts: [
          {
            id: "c1",
            name: "Car loan",
            category: "auto",
            balance: "15000",
            ratePercent: "9",
            termMonths: "60",
          },
        ],
        plan: { extra: "300" },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const data = loadData();
    expect(data.debts[0]).toMatchObject({
      term: "60",
      termUnit: "months",
      paymentMode: "fixed_term",
      modeChosen: true,
      monthlyPayment: "",
    });
    expect(data.timeUnit).toBe("years");
    expect(data.plan.extra).toBe("300");
  });

  it("upgrades version 2 data and keeps the last time unit", () => {
    const v2 = {
      version: 2,
      data: {
        currency: "UGX",
        loan: emptyData().loan,
        debts: [
          {
            id: "c1",
            name: "Car loan",
            category: "auto",
            balance: "15000",
            ratePercent: "9",
            term: "5",
            termUnit: "years",
          },
        ],
        debtTermUnit: "months",
        plan: { extra: "" },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v2));
    const data = loadData();
    expect(data.debts[0]).toMatchObject({ term: "5", termUnit: "years", paymentMode: "fixed_term" });
    expect(data.timeUnit).toBe("months");
    expect("currency" in data).toBe(false);
  });

  it("moves money-trees:v1 to money-trees:v2 without losing debts or the loan form", () => {
    const v3 = {
      version: 3,
      data: {
        loan: { ...emptyData().loan, amount: "200000", ratePercent: "6", term: "30" },
        debts: [{ ...sample().debts[1], owner: undefined }],
        timeUnit: "months",
        plan: { extra: "300" },
      },
    };
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(v3));
    const data = loadData();
    expect(data.loan.amount).toBe("200000");
    expect(data.debts).toHaveLength(1);
    expect(data.debts[0]).toMatchObject({ id: "cc", monthlyPayment: "200", owner: "joint" });
    expect(data.plan.extra).toBe("300");
    expect(data.timeUnit).toBe("months");
    expect(data.household).toEqual(emptyData().household);
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null").version).toBe(4);
  });

  it("prefers money-trees:v2 when both keys exist", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSaved(sample())));
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(toSaved(emptyData())));
    expect(loadData()).toEqual(sample());
  });

  it("saves and reloads the household", () => {
    const data = sample();
    data.household = {
      kind: "couple",
      names: ["Sam", "Alex"],
      incomes: [{ key: "i1", label: "Sam's job", amount: "2000", frequency: "biweekly", owner: "p1" }],
      expenses: { housing: { amount: "1500", frequency: "monthly", owner: "joint" } },
      customExpenses: [
        { key: "c1", label: "Gym", amount: "40", frequency: "monthly", owner: "p2" },
      ],
      assets: [{ key: "a1", type: "cash", label: "", value: "4000", owner: "joint" }],
    };
    saveData(data);
    expect(loadData()).toEqual(data);
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
    expect(parseSaved({ version: 4, data: { ...sample(), timeUnit: "weeks" } })).toBeNull();
    expect(parseSaved({ version: 4, data: { ...sample(), debts: [{ id: 1 }] } })).toBeNull();
    const badMode = { ...sample().debts[0], paymentMode: "minimum" };
    expect(parseSaved({ version: 4, data: { ...sample(), debts: [badMode] } })).toBeNull();
    expect(parseSaved({ version: 1 })).toBeNull();
    expect(parseSaved(null)).toBeNull();
  });
});
