import { useEffect, useMemo, useState } from "react";
import { postDebts, type DebtRequest, type DebtsResponse, type Meta } from "../api";
import { LineChart } from "../components/LineChart";
import { FieldMessage, SummaryCard, TermField, TextField } from "../components/fields";
import {
  CATEGORY_LABELS,
  DEBT_FIELDS,
  buildDebts,
  incompleteNote,
  termAfterCategoryChange,
  type DebtField,
} from "../lib/debtRequest";
import { formatDuration, formatMoney, type Currency } from "../lib/format";
import { newKey, type DebtInput, type TermUnit } from "../lib/storage";
import { splitErrors, useCalculation } from "../lib/useCalculation";
import { useTouched } from "../lib/useTouched";

const MAX_DEBTS_FALLBACK = 20;

/** Element id suffix for each field, used for labels and for moving focus. */
const INPUT_SUFFIX: Record<DebtField, string> = {
  name: "name",
  category: "category",
  principal: "balance",
  annual_rate: "rate",
  term_months: "term",
};

const inputId = (debtId: string, field: DebtField) => `debt-${debtId}-${INPUT_SUFFIX[field]}`;
const touchKey = (debtId: string, field: DebtField) => `${debtId}.${field}`;

type Props = {
  debts: DebtInput[];
  onChange: (debts: DebtInput[]) => void;
  /** The unit last picked for time left; new debts start with it. */
  termUnit: TermUnit;
  onTermUnitChange: (unit: TermUnit) => void;
  currency: Currency;
  meta: Meta | null;
  disclaimer: string;
};

export function DebtsTab({
  debts,
  onChange,
  termUnit,
  onTermUnitChange,
  currency,
  meta,
  disclaimer,
}: Props) {
  const built = useMemo(() => buildDebts(debts), [debts]);
  const requestKey = built.debts.length ? JSON.stringify(built.debts) : "";
  const status = useCalculation<DebtsResponse>(requestKey, (key, signal) =>
    postDebts(JSON.parse(key) as DebtRequest[], signal),
  );
  const { byField, general } = splitErrors(status);
  const touched = useTouched();
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [addBlocked, setAddBlocked] = useState(false);
  const money = (v: string) => formatMoney(v, currency);
  const symbol = currency === "USD" ? "$" : "UGX";
  const maxDebts = meta?.limits.max_debts ?? MAX_DEBTS_FALLBACK;
  const categories =
    meta?.categories ??
    Object.keys(CATEGORY_LABELS).map((value) => ({ value, suggested_term_months: null }));

  // API errors use the request's indexes, which skip incomplete debts.
  const apiErrors: Record<string, Partial<Record<DebtField, string>>> = {};
  for (const [field, message] of Object.entries(byField)) {
    const match = /^debts\[(\d+)\]\.(\w+)$/.exec(field);
    const row = match ? built.rowIndex[Number(match[1])] : undefined;
    const debt = row === undefined ? undefined : debts[row];
    if (debt && match && (DEBT_FIELDS as readonly string[]).includes(match[2]!)) {
      (apiErrors[debt.id] ??= {})[match[2] as DebtField] = message;
    } else {
      general.push(message);
    }
  }

  const errorFor = (debtId: string, field: DebtField) =>
    (touched.isVisible(touchKey(debtId, field)) ? built.problems[debtId]?.[field] : undefined) ||
    apiErrors[debtId]?.[field];

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const update = (id: string, patch: Partial<DebtInput>) => {
    setAddBlocked(false);
    onChange(debts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const addDebt = () => {
    // "Add debt" needs the debts above to be complete: show every missing field
    // and move focus to the first one instead of adding another row.
    const firstIncomplete = debts.find((d) => built.incomplete.includes(d.id));
    if (firstIncomplete) {
      const keys: string[] = [];
      let first: string | null = null;
      for (const d of debts) {
        for (const field of DEBT_FIELDS) {
          if (!built.problems[d.id]?.[field]) continue;
          keys.push(touchKey(d.id, field));
          first ??= inputId(d.id, field);
        }
      }
      touched.revealAll(keys);
      setAddBlocked(true);
      setFocusTarget(first);
      return;
    }
    const id = newKey();
    onChange([
      ...debts,
      { id, name: "", category: "", balance: "", ratePercent: "", term: "", termUnit },
    ]);
    setFocusTarget(inputId(id, "name"));
  };

  const incompleteCount = built.incomplete.length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <section aria-labelledby="debts-list-heading" className="min-w-0">
        <h2 id="debts-list-heading" className="text-lg font-semibold">
          Your debts
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          Credit cards aren't included yet. They work differently from loans and are coming later.
        </p>
        <ol className="mt-3 space-y-3">
          {debts.map((debt, i) => {
            const label = debt.name.trim() || `Debt ${i + 1}`;
            const incomplete = built.incomplete.includes(debt.id);
            const field = (f: DebtField) => ({
              id: inputId(debt.id, f),
              onBlur: () => touched.touch(touchKey(debt.id, f)),
              error: errorFor(debt.id, f),
              required: true,
            });
            const categoryError = errorFor(debt.id, "category");
            return (
              <li key={debt.id} className="rounded-xl border border-stone-200 bg-white p-3">
                <fieldset className="space-y-3">
                  <legend className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {label}
                    {incomplete && (
                      <span className="rounded-full border border-stone-400 px-2 py-0.5 text-xs font-medium text-stone-700">
                        Incomplete
                      </span>
                    )}
                  </legend>
                  <TextField
                    {...field("name")}
                    label="Name"
                    inputMode="text"
                    hint="A name you'll recognize, like Honda loan."
                    value={debt.name}
                    onChange={(name) => update(debt.id, { name })}
                  />
                  <div>
                    <label htmlFor={inputId(debt.id, "category")} className="block text-sm font-medium">
                      Type
                      <span className="ml-1 text-xs font-normal text-stone-600">(required)</span>
                    </label>
                    <select
                      id={inputId(debt.id, "category")}
                      className={`mt-1 w-full rounded-lg bg-white px-2 py-2 ${
                        categoryError ? "border-2 border-red-700" : "border border-stone-300"
                      }`}
                      value={debt.category}
                      aria-required="true"
                      aria-invalid={categoryError ? true : undefined}
                      aria-describedby={
                        categoryError ? `${inputId(debt.id, "category")}-error` : undefined
                      }
                      onBlur={() => touched.touch(touchKey(debt.id, "category"))}
                      onChange={(e) => {
                        const category = e.target.value;
                        const suggested = categories.find(
                          (c) => c.value === category,
                        )?.suggested_term_months;
                        update(debt.id, {
                          category,
                          ...termAfterCategoryChange(debt, suggested),
                        });
                      }}
                    >
                      <option value="">Choose a type</option>
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>
                          {CATEGORY_LABELS[c.value] ?? c.value}
                        </option>
                      ))}
                    </select>
                    {categoryError && (
                      <FieldMessage id={`${inputId(debt.id, "category")}-error`}>
                        {categoryError}
                      </FieldMessage>
                    )}
                  </div>
                  <TextField
                    {...field("principal")}
                    label="Balance owed"
                    hint="What you still owe today, not the original loan amount."
                    prefix={symbol}
                    value={debt.balance}
                    onChange={(balance) => update(debt.id, { balance })}
                  />
                  <TextField
                    {...field("annual_rate")}
                    label="Interest rate (%)"
                    hint="The yearly rate on your statement."
                    suffix="%"
                    value={debt.ratePercent}
                    onChange={(ratePercent) => update(debt.id, { ratePercent })}
                  />
                  <TermField
                    {...field("term_months")}
                    label="Time left to pay"
                    hint="How long until this is paid off on your current schedule. Check your loan statement."
                    value={debt.term}
                    unit={debt.termUnit}
                    onChange={(term) => update(debt.id, { term })}
                    onUnitChange={(unit) => {
                      onTermUnitChange(unit);
                      update(debt.id, { termUnit: unit });
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Delete ${label}`}
                    onClick={() => {
                      setAddBlocked(false);
                      onChange(debts.filter((d) => d.id !== debt.id));
                    }}
                  >
                    Delete
                  </button>
                </fieldset>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className="btn-secondary mt-3"
          disabled={debts.length >= maxDebts}
          onClick={addDebt}
        >
          Add debt
        </button>
        <div role="status" aria-live="polite" className="mt-1 text-sm text-stone-700">
          {addBlocked && incompleteCount > 0 && "Finish the fields marked above to add another debt."}
          {debts.length >= maxDebts && `You can add up to ${maxDebts} debts.`}
        </div>
      </section>

      <section aria-labelledby="debts-results-heading" className="min-w-0">
        <h2 id="debts-results-heading" className="text-lg font-semibold">
          Results
        </h2>
        {incompleteCount > 0 && built.debts.length > 0 && (
          <p className="mt-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700">
            {incompleteNote(incompleteCount)}
          </p>
        )}
        <div role="status" aria-live="polite" className="mt-1 text-sm text-stone-700">
          {status.kind === "idle" &&
            (debts.length === 0
              ? "Add a debt to see results."
              : "Results appear once a debt has a name, type, balance, rate and time left.")}
          {status.kind === "loading" && "Updating results..."}
          {status.kind === "error" && Object.keys(apiErrors).length > 0 && (
            <span>Some details need fixing. See the messages next to the fields.</span>
          )}
        </div>
        {general.length > 0 && (
          <div role="alert" className="mt-2 rounded-lg border border-red-700 p-3 text-sm text-red-800">
            <span className="font-semibold">Error: </span>
            {general.join(" ")}
          </div>
        )}
        {status.kind === "done" && (
          <DebtsResults result={status.data} money={money} disclaimer={disclaimer} />
        )}
      </section>
    </div>
  );
}

function DebtsResults({
  result,
  money,
  disclaimer,
}: {
  result: DebtsResponse;
  money: (v: string) => string;
  disclaimer: string;
}) {
  const { summary } = result;
  return (
    <div className="mt-3">
      <p className="text-xs text-stone-600">{disclaimer}</p>
      <dl aria-label="Combined summary" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryCard label="Total monthly payment" value={money(summary.total_regular_payment)} />
        <SummaryCard label="Total interest" value={money(summary.total_interest)} />
        <SummaryCard label="Debt-free in" value={formatDuration(summary.debt_free_month)} />
      </dl>

      <h3 className="mt-5 text-sm font-medium">Each debt</h3>
      <ul className="mt-2 space-y-2" aria-label="Each debt">
        {result.debts.map((d) => (
          <li key={d.id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
            <p className="font-medium break-words">
              {d.name}{" "}
              <span className="font-normal text-stone-600">
                ({CATEGORY_LABELS[d.category] ?? d.category})
              </span>
            </p>
            <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-3">
              <div className="flex justify-between gap-2 sm:block">
                <dt className="text-stone-600">Payment</dt>
                <dd>{money(d.summary.payment)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:block">
                <dt className="text-stone-600">Paid off in</dt>
                <dd>{formatDuration(d.summary.payoff_month)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:block">
                <dt className="text-stone-600">Total interest</dt>
                <dd>{money(d.summary.total_interest)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-sm font-medium">By category</h3>
      <ul className="mt-2 space-y-1 text-sm" aria-label="By category">
        {Object.entries(result.by_category).map(([category, totals]) => (
          <li
            key={category}
            className="flex flex-wrap justify-between gap-x-4 rounded-lg border border-stone-200 bg-white px-3 py-2"
          >
            <span className="font-medium">{CATEGORY_LABELS[category] ?? category}</span>
            <span>
              Balance {money(totals.starting_balance)}, interest {money(totals.total_interest)}
            </span>
          </li>
        ))}
      </ul>

      <LineChart
        title="Total balance over time, all debts"
        description={`The combined balance reaches 0 in month ${summary.debt_free_month}.`}
        series={[
          {
            label: "Total balance",
            values: [
              summary.total_starting_balance,
              ...result.timeline.map((r) => r.total_ending_balance),
            ],
            color: "#047857",
          },
        ]}
      />
    </div>
  );
}
