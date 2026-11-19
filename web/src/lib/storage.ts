/**
 * Everything the user enters, saved in the browser under one key with a schema
 * version. Every storage access is wrapped in try/catch: with storage blocked or
 * full, the app keeps working and simply doesn't remember anything.
 */
import { isCurrency, type Currency } from "./format";

// The key stays the same across schema versions so saved data is always found;
// the `version` inside says which shape it has. Version 1 files are upgraded on read.
export const STORAGE_KEY = "money-trees:v1";
export const SCHEMA_VERSION = 2;

export type TermUnit = "years" | "months";

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
  /** Time left to pay, in `termUnit`. */
  term: string;
  termUnit: TermUnit;
};

export type PlanInput = { extra: string };

export type AppData = {
  currency: Currency;
  loan: LoanInput;
  debts: DebtInput[];
  /** The unit last picked on the Debts tab, used for new debts. */
  debtTermUnit: TermUnit;
  plan: PlanInput;
};

export type SavedFile = { version: typeof SCHEMA_VERSION; data: AppData };

export function emptyData(): AppData {
  return {
    currency: "USD",
    loan: { amount: "", ratePercent: "", term: "", termUnit: "years", extra: "", lumpSums: [] },
    debts: [],
    debtTermUnit: "years",
    plan: { extra: "" },
  };
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, keys: readonly string[]): value is Obj {
  return isObj(value) && keys.every((k) => typeof value[k] === "string");
}

function parseLoan(value: unknown): LoanInput | null {
  if (!strings(value, ["amount", "ratePercent", "term", "termUnit", "extra"])) return null;
  if (value.termUnit !== "years" && value.termUnit !== "months") return null;
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

function isUnit(value: unknown): value is TermUnit {
  return value === "years" || value === "months";
}

function parseDebts(value: unknown, version: number): DebtInput[] | null {
  if (!Array.isArray(value)) return null;
  const debts: DebtInput[] = [];
  const base = ["id", "name", "category", "balance", "ratePercent"] as const;
  for (const item of value) {
    if (!strings(item, base)) return null;
    let term: string;
    let termUnit: TermUnit;
    if (version === 1) {
      // Version 1 stored months only.
      if (typeof item.termMonths !== "string") return null;
      term = item.termMonths;
      termUnit = "months";
    } else {
      if (typeof item.term !== "string" || !isUnit(item.termUnit)) return null;
      term = item.term;
      termUnit = item.termUnit;
    }
    debts.push({
      id: String(item.id),
      name: String(item.name),
      category: String(item.category),
      balance: String(item.balance),
      ratePercent: String(item.ratePercent),
      term,
      termUnit,
    });
  }
  return debts;
}

/** Validate an untrusted saved file (from storage or an import). Null if invalid. */
export function parseSaved(value: unknown): AppData | null {
  if (!isObj(value) || !isObj(value.data)) return null;
  const version = value.version;
  if (version !== 1 && version !== SCHEMA_VERSION) return null;
  const data = value.data;
  if (!isCurrency(data.currency)) return null;
  const loan = parseLoan(data.loan);
  const debts = parseDebts(data.debts, version);
  if (!loan || !debts || !strings(data.plan, ["extra"])) return null;
  let debtTermUnit: TermUnit = "years";
  if (version === SCHEMA_VERSION) {
    if (!isUnit(data.debtTermUnit)) return null;
    debtTermUnit = data.debtTermUnit;
  }
  return {
    currency: data.currency,
    loan,
    debts,
    debtTermUnit,
    plan: { extra: String(data.plan.extra) },
  };
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
