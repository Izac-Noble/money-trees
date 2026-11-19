import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { fetchMeta, type Meta } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CURRENCY } from "./lib/format";
import {
  clearData,
  emptyData,
  loadData,
  parseSaved,
  saveData,
  toSaved,
  type AppData,
} from "./lib/storage";
import { DebtsTab } from "./tabs/DebtsTab";
import { LoanTab } from "./tabs/LoanTab";
import { PlanTab } from "./tabs/PlanTab";

/** Shown until /api/meta answers, so the footer is never empty. Same text the API serves. */
export const FALLBACK_DISCLAIMER = "Estimates for learning and planning, not financial advice.";

export const TABS = [
  { id: "loan", label: "Loan" },
  { id: "debts", label: "Debts" },
  { id: "plan", label: "Payoff Plan" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#/, "");
  return TABS.find((t) => t.id === id)?.id ?? "loan";
}

function describe(data: AppData): string {
  const debts = `${data.debts.length} ${data.debts.length === 1 ? "debt" : "debts"}`;
  const loan = data.loan.amount ? "loan details" : "an empty loan form";
  return `${loan}, ${debts} and the payoff plan extra`;
}

/** FileReader rather than File.text(), which some older browsers lack. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

type Pending = { kind: "import"; data: AppData } | { kind: "clear" } | null;

export default function App() {
  const [data, setData] = useState<AppData>(loadData);
  const [saved, setSaved] = useState(true);
  const [tab, setTab] = useState<TabId>(() => tabFromHash(window.location.hash));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  // Bumped on import and clear so forms remount fresh, with no leftover errors.
  const [formGeneration, setFormGeneration] = useState(0);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => setSaved(saveData(data)), [data]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMeta(controller.signal)
      .then(setMeta)
      .catch(() => {
        // The footer falls back to the same disclaimer text; forms still work.
      });
    return () => controller.abort();
  }, []);

  const selectTab = (id: TabId, focus = false) => {
    setTab(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const moves: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    selectTab(TABS[next]!.id, true);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(toSaved(data), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "money-trees-data.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice({ kind: "ok", text: "Downloaded money-trees-data.json." });
  };

  const importFile = async (file: File) => {
    let parsed: AppData | null = null;
    try {
      parsed = parseSaved(JSON.parse(await readText(file)));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      setNotice({
        kind: "error",
        text: "That file isn't a Money Trees export, so nothing was changed.",
      });
      return;
    }
    setNotice(null);
    setPending({ kind: "import", data: parsed });
  };

  const disclaimer = meta?.disclaimer ?? FALLBACK_DISCLAIMER;
  const panels: Record<TabId, ReactNode> = {
    loan: (
      <LoanTab
        loan={data.loan}
        onChange={(loan) =>
          setData((d) => ({
            ...d,
            loan,
            // The time unit picked last anywhere becomes the default for new fields.
            timeUnit: loan.termUnit !== d.loan.termUnit ? loan.termUnit : d.timeUnit,
          }))
        }
        currency={CURRENCY}
        disclaimer={disclaimer}
      />
    ),
    debts: (
      <DebtsTab
        debts={data.debts}
        onChange={(debts) => setData((d) => ({ ...d, debts }))}
        termUnit={data.timeUnit}
        onTermUnitChange={(timeUnit) => setData((d) => ({ ...d, timeUnit }))}
        currency={CURRENCY}
        meta={meta}
        disclaimer={disclaimer}
      />
    ),
    plan: (
      <PlanTab
        debts={data.debts}
        plan={data.plan}
        onChange={(plan) => setData((d) => ({ ...d, plan }))}
        currency={CURRENCY}
        disclaimer={disclaimer}
      />
    ),
  };

  return (
    <div className="flex min-h-screen flex-col bg-emerald-50 text-stone-900">
      <header className="border-b border-emerald-100 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <h1 className="text-2xl font-semibold text-emerald-900">Money Trees</h1>
          <p className="mt-1 text-sm text-stone-700">
            See how loans and debt payoff choices play out over time.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <button type="button" className="btn-secondary" onClick={exportData}>
              Export data
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInput.current?.click()}
            >
              Import data
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choose a Money Trees export file"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPending({ kind: "clear" })}
            >
              Clear all data
            </button>
          </div>
          <div role="status" aria-live="polite" className="mt-2 text-sm">
            {notice && (
              <span className={notice.kind === "error" ? "text-red-800" : "text-emerald-800"}>
                {notice.kind === "error" && <span className="font-semibold">Error: </span>}
                {notice.text}
              </span>
            )}
            {!saved && (
              <span className="block text-stone-700">
                This browser isn't saving your entries, so they'll be gone after a refresh. Use
                Export data to keep a copy.
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">
        <div role="tablist" aria-label="Calculators" className="flex gap-1 border-b border-stone-200">
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium ${
                tab === t.id
                  ? "border-emerald-700 bg-white text-emerald-900 underline underline-offset-4"
                  : "border-transparent text-stone-700 hover:text-stone-900"
              }`}
              onClick={() => selectTab(t.id)}
              onKeyDown={onTabKey}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          id={`panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="pt-4"
        >
          <div key={formGeneration}>{panels[tab]}</div>
        </div>
      </main>

      <footer className="border-t border-emerald-100 bg-white">
        <p className="mx-auto max-w-5xl px-4 py-3 text-xs text-stone-700">{disclaimer}</p>
      </footer>

      {pending?.kind === "import" && (
        <ConfirmDialog
          title="Replace your data?"
          confirmLabel="Replace my data"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setData(pending.data);
            setFormGeneration((g) => g + 1);
            setPending(null);
            setNotice({ kind: "ok", text: "Imported your data." });
          }}
        >
          <p>This replaces what you have now: {describe(data)}.</p>
          <p className="mt-2">With the file's: {describe(pending.data)}.</p>
        </ConfirmDialog>
      )}
      {pending?.kind === "clear" && (
        <ConfirmDialog
          title="Clear all data?"
          confirmLabel="Clear all data"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            clearData();
            setData(emptyData());
            setFormGeneration((g) => g + 1);
            setPending(null);
            setNotice({ kind: "ok", text: "Cleared all data." });
          }}
        >
          <p>This removes {describe(data)} from this browser. It can't be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
