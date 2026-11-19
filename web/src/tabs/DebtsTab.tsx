import { useMemo } from "react";
import { postDebts, type DebtRequest, type DebtsResponse, type Meta } from "../api";
import { LineChart } from "../components/LineChart";
import { FieldMessage, SummaryCard, TextField } from "../components/fields";
import { CATEGORY_LABELS, buildDebts, termAfterCategoryChange } from "../lib/debtRequest";
import { formatDuration, formatMoney, type Currency } from "../lib/format";
import { newKey, type DebtInput } from "../lib/storage";
import { splitErrors, useCalculation } from "../lib/useCalculation";

const MAX_DEBTS_FALLBACK = 20;

type Props = {
  debts: DebtInput[];
  onChange: (debts: DebtInput[]) => void;
  currency: Currency;
  meta: Meta | null;
  disclaimer: string;
};

export function DebtsTab({ debts, onChange, currency, meta, disclaimer }: Props) {
  const built = useMemo(() => buildDebts(debts), [debts]);
  const requestKey = built.debts ? JSON.stringify(built.debts) : "";
  const status = useCalculation<DebtsResponse>(requestKey, (key, signal) =>
    postDebts(JSON.parse(key) as DebtRequest[], signal),
  );
  const { byField, general } = splitErrors(status);
  const errorFor = (field: string) => built.errors[field] ?? byField[field];
  const money = (v: string) => formatMoney(v, currency);
  const symbol = currency === "USD" ? "$" : "UGX";
  const maxDebts = meta?.limits.max_debts ?? MAX_DEBTS_FALLBACK;
  const categories =
    meta?.categories ??
    Object.keys(CATEGORY_LABELS).map((value) => ({ value, suggested_term_months: null }));

  const update = (id: string, patch: Partial<DebtInput>) =>
    onChange(debts.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <section aria-labelledby="debts-list-heading" className="min-w-0">
        <h2 id="debts-list-heading" className="text-lg font-semibold">
          Your debts
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          Enter what you owe now and the months left, not the original loan. Credit cards aren't
          included yet. They work differently from loans and are coming later.
        </p>
        <ol className="mt-3 space-y-3">
          {debts.map((debt, i) => {
            const path = `debts[${i}]`;
            const label = debt.name.trim() || `Debt ${i + 1}`;
            return (
              <li key={debt.id} className="rounded-xl border border-stone-200 bg-white p-3">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">{label}</legend>
                  <TextField
                    id={`debt-${debt.id}-name`}
                    label="Name"
                    inputMode="text"
                    placeholder="For example, Honda loan"
                    value={debt.name}
                    onChange={(name) => update(debt.id, { name })}
                    error={errorFor(`${path}.name`)}
                  />
                  <div>
                    <label htmlFor={`debt-${debt.id}-category`} className="block text-sm font-medium">
                      Category
                    </label>
                    <select
                      id={`debt-${debt.id}-category`}
                      className={`mt-1 w-full rounded-lg border bg-white px-2 py-2 ${
                        errorFor(`${path}.category`) ? "border-red-700" : "border-stone-300"
                      }`}
                      value={debt.category}
                      aria-invalid={errorFor(`${path}.category`) ? true : undefined}
                      aria-describedby={
                        errorFor(`${path}.category`) ? `debt-${debt.id}-category-error` : undefined
                      }
                      onChange={(e) => {
                        const category = e.target.value;
                        const suggested = categories.find(
                          (c) => c.value === category,
                        )?.suggested_term_months;
                        update(debt.id, {
                          category,
                          termMonths: termAfterCategoryChange(debt.termMonths, suggested),
                        });
                      }}
                    >
                      <option value="">Choose a category</option>
                      {categories.map((c) => (
                        <option key={c.value} value={c.value}>
                          {CATEGORY_LABELS[c.value] ?? c.value}
                        </option>
                      ))}
                    </select>
                    {errorFor(`${path}.category`) && (
                      <FieldMessage id={`debt-${debt.id}-category-error`}>
                        {errorFor(`${path}.category`)}
                      </FieldMessage>
                    )}
                  </div>
                  <TextField
                    id={`debt-${debt.id}-balance`}
                    label="Balance owed"
                    prefix={symbol}
                    value={debt.balance}
                    onChange={(balance) => update(debt.id, { balance })}
                    error={errorFor(`${path}.principal`)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <TextField
                      id={`debt-${debt.id}-rate`}
                      label="Rate (%)"
                      suffix="%"
                      value={debt.ratePercent}
                      onChange={(ratePercent) => update(debt.id, { ratePercent })}
                      error={errorFor(`${path}.annual_rate`)}
                    />
                    <TextField
                      id={`debt-${debt.id}-term`}
                      label="Months left"
                      inputMode="numeric"
                      value={debt.termMonths}
                      onChange={(termMonths) => update(debt.id, { termMonths })}
                      error={errorFor(`${path}.term_months`)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Delete ${label}`}
                    onClick={() => onChange(debts.filter((d) => d.id !== debt.id))}
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
          onClick={() =>
            onChange([
              ...debts,
              {
                id: newKey(),
                name: "",
                category: "",
                balance: "",
                ratePercent: "",
                termMonths: "",
              },
            ])
          }
        >
          Add a debt
        </button>
        {debts.length >= maxDebts && (
          <p className="mt-1 text-xs text-stone-600">You can add up to {maxDebts} debts.</p>
        )}
      </section>

      <section aria-labelledby="debts-results-heading" className="min-w-0">
        <h2 id="debts-results-heading" className="text-lg font-semibold">
          Results
        </h2>
        <div role="status" aria-live="polite" className="mt-1 text-sm text-stone-700">
          {status.kind === "idle" &&
            (debts.length === 0
              ? "Add a debt to see results."
              : "Fill in every debt's name, category, balance, rate and months left to see results.")}
          {status.kind === "loading" && "Updating results..."}
          {status.kind === "error" && Object.keys(byField).length > 0 && (
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
