/**
 * Everything the user enters, saved in the browser under one key with a schema
 * version. Every storage access is wrapped in try/catch: with storage blocked or
 * full, the app keeps working and simply doesn't remember anything.
 */

// The key stays the same across schema versions so saved data is always found;
// the `version` inside says which shape it has. Older versions are upgraded on read.
export const STORAGE_KEY = "money-trees:v1";
export const SCHEMA_VERSION = 3;

export type TermUnit = "years" | "months";
export type PaymentMode = "fixed_term" | "fixed_payment";

export type LumpSumInput = { key: string; month: string; amount: string };

export type LoanInput = {
  amount: string;
  ratePercent: string;
  term: string;
  termUnit: TermUnit;
  extra: string;
  lumpSums: LumpSumInput[];
};

export type DebtInput = {
  id: string;
  name: string;
  category: string;
  balance: string;
  ratePercent: string;
  /** "Enter by": time left (fixed_term) or monthly payment (fixed_payment). */
  paymentMode: PaymentMode;
  /** True once the user touched the toggle or typed a time or payment. */
  modeChosen: boolean;
  /** Time left to pay, in `termUnit`. Kept when switching to monthly payment. */
  term: string;
  termUnit: TermUnit;
  /** Kept when switching to time left. */
  monthlyPayment: string;
};

export type PlanInput = { extra: string };

export type AppData = {
  loan: LoanInput;
  debts: DebtInput[];
  /** The time unit picked last, anywhere in the app. New time fields start on it. */
  timeUnit: TermUnit;
  plan: PlanInput;
};

export type SavedFile = { version: typeof SCHEMA_VERSION; data: AppData };

export function emptyData(): AppData {
  return {
    loan: { amount: "", ratePercent: "", term: "", termUnit: "years", extra: "", lumpSums: [] },
    debts: [],
    timeUnit: "years",
    plan: { extra: "" },
  };
}

export function newDebt(id: string, termUnit: TermUnit): DebtInput {
  return {
    id,
    name: "",
    category: "",
    balance: "",
    ratePercent: "",
    paymentMode: "fixed_term",
    modeChosen: false,
    term: "",
    termUnit,
    monthlyPayment: "",
  };
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, keys: readonly string[]): value is Obj {
  return isObj(value) && keys.every((k) => typeof value[k] === "string");
}

function isUnit(value: unknown): value is TermUnit {
  return value === "years" || value === "months";
}

function isMode(value: unknown): value is PaymentMode {
  return value === "fixed_term" || value === "fixed_payment";
}

function parseLoan(value: unknown): LoanInput | null {
  if (!strings(value, ["amount", "ratePercent", "term", "extra"])) return null;
  if (!isUnit(value.termUnit)) return null;
  if (!Array.isArray(value.lumpSums)) return null;
  const lumpSums: LumpSumInput[] = [];
  for (const item of value.lumpSums) {
    if (!strings(item, ["key", "month", "amount"])) return null;
    lumpSums.push({ key: String(item.key), month: String(item.month), amount: String(item.amount) });
  }
  return {
    amount: String(value.amount),
    ratePercent: String(value.ratePercent),
    term: String(value.term),
    termUnit: value.termUnit,
    extra: String(value.extra),
    lumpSums,
  };
}

function parseDebts(value: unknown, version: number): DebtInput[] | null {
  if (!Array.isArray(value)) return null;
  const debts: DebtInput[] = [];
  for (const item of value) {
    if (!strings(item, ["id", "name", "category", "balance", "ratePercent"])) return null;
    const debt = newDebt(String(item.id), "years");
    debt.name = String(item.name);
    debt.category = String(item.category);
    debt.balance = String(item.balance);
    debt.ratePercent = String(item.ratePercent);
    if (version === 1) {
      // Version 1 stored months only.
      if (typeof item.termMonths !== "string") return null;
      debt.term = item.termMonths;
      debt.termUnit = "months";
    } else {
      if (typeof item.term !== "string" || !isUnit(item.termUnit)) return null;
      debt.term = item.term;
      debt.termUnit = item.termUnit;
    }
    // Older versions only had time left, so a typed one counts as a choice.
    debt.modeChosen = debt.term !== "";
    if (version >= 3) {
      if (!isMode(item.paymentMode) || typeof item.monthlyPayment !== "string") return null;
      if (typeof item.modeChosen !== "boolean") return null;
      debt.paymentMode = item.paymentMode;
      debt.monthlyPayment = item.monthlyPayment;
      debt.modeChosen = item.modeChosen;
    }
    debts.push(debt);
  }
  return debts;
}

/** Validate an untrusted saved file (from storage or an import). Null if invalid. */
export function parseSaved(value: unknown): AppData | null {
  if (!isObj(value) || !isObj(value.data)) return null;
  const version = value.version;
  if (version !== 1 && version !== 2 && version !== SCHEMA_VERSION) return null;
  const data = value.data;
  const loan = parseLoan(data.loan);
  const debts = parseDebts(data.debts, version);
  if (!loan || !debts || !strings(data.plan, ["extra"])) return null;
  // Versions 1 and 2 also had a currency setting; USD is the only currency now.
  let timeUnit: TermUnit = "years";
  if (version === 2 && isUnit(data.debtTermUnit)) timeUnit = data.debtTermUnit;
  if (version === SCHEMA_VERSION) {
    if (!isUnit(data.timeUnit)) return null;
    timeUnit = data.timeUnit;
  }
  return { loan, debts, timeUnit, plan: { extra: String(data.plan.extra) } };
}

export function toSaved(data: AppData): SavedFile {
  return { version: SCHEMA_VERSION, data };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadData(): AppData {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return parseSaved(JSON.parse(raw)) ?? emptyData();
  } catch {
    return emptyData();
  }
}

/** Returns false when the browser wouldn't save (blocked, private mode, full). */
export function saveData(data: AppData): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(STORAGE_KEY, JSON.stringify(toSaved(data)));
    return true;
  } catch {
    return false;
  }
}

export function clearData(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}
