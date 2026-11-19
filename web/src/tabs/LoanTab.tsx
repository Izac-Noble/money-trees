import { useEffect, useMemo, useState } from "react";
import {
  postAmortization,
  type AmortizationRequest,
  type AmortizationResponse,
  type FieldError,
} from "../api";
import { LineChart, type Series } from "../components/LineChart";
import { balancesFromSchedule } from "../lib/chart";
import { buildLoanRequest } from "../lib/loanRequest";
import { FieldMessage, SummaryCard, TextField } from "../components/fields";
import { formatDuration, formatMoney, type Currency } from "../lib/format";
import { newKey, type LoanInput } from "../lib/storage";
import { useDebounced } from "../lib/useDebounced";

const FIRST_MONTHS = 12;

type Results = { withExtras: AmortizationResponse; withoutExtras: AmortizationResponse | null };

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; results: Results }
  | { kind: "error"; errors: FieldError[] };

type Props = {
  loan: LoanInput;
  onChange: (loan: LoanInput) => void;
  currency: Currency;
  disclaimer: string;
};

export function LoanTab({ loan, onChange, currency, disclaimer }: Props) {
  const built = useMemo(() => buildLoanRequest(loan), [loan]);
  const requestKey = built.request ? JSON.stringify(built.request) : "";
  const debouncedKey = useDebounced(requestKey, 300);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!debouncedKey) {
      setStatus({ kind: "idle" });
      return;
    }
    const request = JSON.parse(debouncedKey) as AmortizationRequest;
    const hasExtras =
      !/^0+(\.0*)?$/.test(request.extra_monthly ?? "0") || (request.lump_sums ?? []).length > 0;
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    const main = postAmortization(request, controller.signal);
    const plain = hasExtras
      ? postAmortization(
          { ...request, extra_monthly: "0", lump_sums: [] },
          controller.signal,
        )
      : Promise.resolve(null);
    Promise.all([main, plain])
      .then(([withExtras, withoutExtras]) => {
        if (controller.signal.aborted) return;
        if (!withExtras.ok) {
          setStatus({ kind: "error", errors: withExtras.errors });
          return;
        }
        setStatus({
          kind: "done",
          results: {
            withExtras: withExtras.data,
            withoutExtras: withoutExtras && withoutExtras.ok ? withoutExtras.data : null,
          },
        });
      })
      .catch(() => {
        // Aborted because the inputs changed; a newer request is on its way.
      });
    return () => controller.abort();
  }, [debouncedKey]);

  const apiErrors: Record<string, string> = {};
  const generalErrors: string[] = [];
  if (status.kind === "error") {
    for (const e of status.errors) {
      if (e.field) apiErrors[e.field] = e.message;
      else generalErrors.push(e.message);
    }
  }
  const errorFor = (field: string) => built.errors[field] ?? apiErrors[field];
  const set = (patch: Partial<LoanInput>) => onChange({ ...loan, ...patch });
  const money = (v: string) => formatMoney(v, currency);
  const symbol = currency === "USD" ? "$" : "UGX";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} aria-label="Loan details">
        <TextField
          id="loan-amount"
          label="Loan amount"
          prefix={symbol}
          value={loan.amount}
          onChange={(amount) => set({ amount })}
          error={errorFor("principal")}
        />
        <TextField
          id="loan-rate"
          label="Interest rate (%)"
          suffix="%"
          value={loan.ratePercent}
          onChange={(ratePercent) => set({ ratePercent })}
          error={errorFor("annual_rate")}
          hint="Yearly rate, for example 6.5"
        />
        <fieldset>
          <legend className="text-sm font-medium">Term</legend>
          <div className="mt-1 flex gap-2">
            <div className="flex-1">
              <label htmlFor="loan-term" className="sr-only">
                Term length
              </label>
              <input
                id="loan-term"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={`w-full rounded-lg border bg-white px-3 py-2 ${
                  errorFor("term_months") ? "border-red-700" : "border-stone-300"
                }`}
                value={loan.term}
                aria-invalid={errorFor("term_months") ? true : undefined}
                aria-describedby={errorFor("term_months") ? "loan-term-error" : undefined}
                onChange={(e) => set({ term: e.target.value })}
              />
            </div>
            <label htmlFor="loan-term-unit" className="sr-only">
              Term unit
            </label>
            <select
              id="loan-term-unit"
              className="rounded-lg border border-stone-300 bg-white px-2 py-2"
              value={loan.termUnit}
              onChange={(e) => set({ termUnit: e.target.value === "months" ? "months" : "years" })}
            >
              <option value="years">years</option>
              <option value="months">months</option>
            </select>
          </div>
          {errorFor("term_months") && (
            <FieldMessage id="loan-term-error">{errorFor("term_months")}</FieldMessage>
          )}
        </fieldset>
        <TextField
          id="loan-extra"
          label="Extra monthly payment (optional)"
          prefix={symbol}
          value={loan.extra}
          onChange={(extra) => set({ extra })}
          error={errorFor("extra_monthly")}
        />
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Lump sums (optional)</legend>
          {loan.lumpSums.map((row, i) => (
            <div key={row.key} className="flex items-start gap-2">
              <div className="w-24 shrink-0">
                <TextField
                  id={`lump-${row.key}-month`}
                  label={`Month, lump sum ${i + 1}`}
                  inputMode="numeric"
                  value={row.month}
                  onChange={(month) =>
                    set({
                      lumpSums: loan.lumpSums.map((r) => (r.key === row.key ? { ...r, month } : r)),
                    })
                  }
                  error={errorFor(`lump_sums[${i}].month`)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <TextField
                  id={`lump-${row.key}-amount`}
                  label={`Amount, lump sum ${i + 1}`}
                  prefix={symbol}
                  value={row.amount}
                  onChange={(amount) =>
                    set({
                      lumpSums: loan.lumpSums.map((r) =>
                        r.key === row.key ? { ...r, amount } : r,
                      ),
                    })
                  }
                  error={errorFor(`lump_sums[${i}].amount`)}
                />
              </div>
              <button
                type="button"
                className="btn-secondary mt-6 shrink-0"
                aria-label={`Remove lump sum ${i + 1}`}
                onClick={() => set({ lumpSums: loan.lumpSums.filter((r) => r.key !== row.key) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              set({ lumpSums: [...loan.lumpSums, { key: newKey(), month: "", amount: "" }] })
            }
          >
            Add a lump sum
          </button>
        </fieldset>
      </form>

      <section aria-labelledby="loan-results-heading" className="min-w-0">
        <h2 id="loan-results-heading" className="text-lg font-semibold">
          Results
        </h2>
        <div role="status" aria-live="polite" className="mt-1 text-sm text-stone-700">
          {status.kind === "idle" && "Enter a loan amount, interest rate and term to see results."}
          {status.kind === "loading" && "Updating results..."}
          {status.kind === "error" && Object.keys(apiErrors).length > 0 && (
            <span>Some details need fixing. See the messages next to the fields.</span>
          )}
        </div>
        {generalErrors.length > 0 && (
          <div role="alert" className="mt-2 rounded-lg border border-red-700 p-3 text-sm text-red-800">
            <span className="font-semibold">Error: </span>
            {generalErrors.join(" ")}
          </div>
        )}
        {status.kind === "done" && (
          <LoanResults
            results={status.results}
            money={money}
            disclaimer={disclaimer}
            showAll={showAll}
            onToggleAll={() => setShowAll((v) => !v)}
          />
        )}
      </section>
    </div>
  );
}

function LoanResults({
  results,
  money,
  disclaimer,
  showAll,
  onToggleAll,
}: {
  results: Results;
  money: (v: string) => string;
  disclaimer: string;
  showAll: boolean;
  onToggleAll: () => void;
}) {
  const { summary, schedule } = results.withExtras;
  const rows = showAll ? schedule : schedule.slice(0, FIRST_MONTHS);
  const series: Series[] = [
    {
      label: results.withoutExtras ? "With extra payments" : "Remaining balance",
      values: balancesFromSchedule(schedule),
      color: "#047857",
    },
  ];
  if (results.withoutExtras) {
    series.push({
      label: "Without extra payments",
      values: balancesFromSchedule(results.withoutExtras.schedule),
      color: "#78716c",
      dash: "6 4",
    });
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-stone-600">{disclaimer}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard label="Monthly payment" value={money(summary.payment)} />
        <SummaryCard label="Payoff time" value={formatDuration(summary.payoff_month)} />
        <SummaryCard label="Total interest" value={money(summary.total_interest)} />
        <SummaryCard label="Total paid" value={money(summary.total_paid)} />
        {summary.interest_saved !== null && (
          <SummaryCard label="Interest saved" value={money(summary.interest_saved)} />
        )}
        {summary.months_saved !== null && (
          <SummaryCard label="Time saved" value={formatDuration(summary.months_saved)} />
        )}
      </dl>

      <LineChart
        title="Remaining balance over time"
        description={
          results.withoutExtras
            ? `With extra payments the balance reaches 0 in month ${summary.payoff_month}; without them, in month ${results.withoutExtras.summary.payoff_month}.`
            : `The balance reaches 0 in month ${summary.payoff_month}.`
        }
        series={series}
      />

      <h3 className="mt-4 text-sm font-medium">
        Payment schedule
        {showAll ? "" : `, first ${Math.min(FIRST_MONTHS, schedule.length)} months`}
      </h3>
      {/* Phones: one small card per month, so nothing scrolls sideways. */}
      <ol className="mt-2 space-y-2 sm:hidden" aria-label="Payment schedule by month">
        {rows.map((row) => (
          <li key={row.month} className="rounded-lg border border-stone-200 bg-white p-2 text-xs">
            <p className="font-medium">Month {row.month}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
              {(
                [
                  ["Payment", row.payment],
                  ["Interest", row.interest],
                  ["Principal", row.scheduled_principal],
                  ["Extra", row.extra_principal],
                  ["Balance", row.ending_balance],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt className="text-stone-600">{label}</dt>
                  <dd>{money(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
      <div className="mt-2 hidden sm:block">
        <table className="w-full text-right text-sm">
          <caption className="sr-only">Payment schedule</caption>
          <thead className="text-stone-600">
            <tr>
              <th scope="col" className="py-1 pr-2 text-left font-medium">
                Month
              </th>
              <th scope="col" className="px-1 font-medium">Payment</th>
              <th scope="col" className="px-1 font-medium">Interest</th>
              <th scope="col" className="px-1 font-medium">Principal</th>
              <th scope="col" className="px-1 font-medium">Extra</th>
              <th scope="col" className="pl-1 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((row) => (
              <tr key={row.month} className="border-t border-stone-100">
                <th scope="row" className="py-1 pr-2 text-left font-normal">
                  {row.month}
                </th>
                <td className="px-1">{money(row.payment)}</td>
                <td className="px-1">{money(row.interest)}</td>
                <td className="px-1">{money(row.scheduled_principal)}</td>
                <td className="px-1">{money(row.extra_principal)}</td>
                <td className="pl-1">{money(row.ending_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {schedule.length > FIRST_MONTHS && (
        <button type="button" className="btn-secondary mt-3" onClick={onToggleAll}>
          {showAll ? "Show first 12 months" : `Show all months (${schedule.length})`}
        </button>
      )}
    </div>
  );
}
