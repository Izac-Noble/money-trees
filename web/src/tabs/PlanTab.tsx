import { useMemo } from "react";
import {
  postCompare,
  type CompareResponse,
  type DebtRequest,
  type StrategyResponse,
} from "../api";
import { LineChart } from "../components/LineChart";
import { TextField } from "../components/fields";
import { buildDebts, incompleteNote } from "../lib/debtRequest";
import { formatDuration, formatMoney, type Currency } from "../lib/format";
import type { DebtInput, PlanInput } from "../lib/storage";
import { splitErrors, useCalculation } from "../lib/useCalculation";
import { useTouched } from "../lib/useTouched";
import { checkMoney } from "../lib/validate";

export const STRATEGY_TEXT = {
  avalanche: {
    name: "Avalanche",
    description: "Pays the highest interest rate first. Usually costs the least interest.",
  },
  snowball: {
    name: "Snowball",
    description: "Pays the smallest balance first. Clears your first debt sooner.",
  },
} as const;

type Props = {
  debts: DebtInput[];
  plan: PlanInput;
  onChange: (plan: PlanInput) => void;
  currency: Currency;
  disclaimer: string;
};

export function PlanTab({ debts, plan, onChange, currency, disclaimer }: Props) {
  const built = useMemo(() => buildDebts(debts), [debts]);
  const extra = checkMoney(plan.extra, { optional: true });
  const touched = useTouched();
  // Incomplete debts are left out; the rest still compare.
  const ready = built.debts.length > 0 && "value" in extra;
  const requestKey = ready
    ? JSON.stringify({ debts: built.debts, extra_monthly: "value" in extra ? extra.value : "0" })
    : "";
  const status = useCalculation<CompareResponse>(requestKey, (key, signal) =>
    postCompare(JSON.parse(key) as { debts: DebtRequest[]; extra_monthly: string }, signal),
  );
  const { byField, general } = splitErrors(status);
  const debtErrors = Object.entries(byField).filter(([field]) => field.startsWith("debts"));
  const money = (v: string) => formatMoney(v, currency);

  if (debts.length === 0) {
    return (
      <div className="max-w-xl text-sm text-stone-700">
        <p>Add your debts first, then come back here to compare payoff orders.</p>
        <p className="mt-2">
          <a href="#debts" className="font-medium text-emerald-800 underline">
            Go to the Debts tab
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="plan-input-heading" className="max-w-md">
        <h2 id="plan-input-heading" className="text-lg font-semibold">
          Extra money each month
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          On top of your regular payments. When a debt is paid off, its payment moves to the next
          one.
        </p>
        <div className="mt-3">
          <TextField
            id="plan-extra"
            label="Extra money per month"
            prefix={currency === "USD" ? "$" : "UGX"}
            value={plan.extra}
            onChange={(value) => onChange({ extra: value })}
            onBlur={() => touched.touch("extra_monthly")}
            error={
              ("error" in extra && touched.isVisible("extra_monthly") ? extra.error : undefined) ||
              byField.extra_monthly
            }
            hint="Leave empty to see the effect of rolling payments over with no extra money."
          />
        </div>
      </section>

      <section aria-label="The two payoff orders" className="grid gap-3 sm:grid-cols-2">
        {Object.values(STRATEGY_TEXT).map((s) => (
          <div key={s.name} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
            <h3 className="font-semibold">{s.name}</h3>
            <p className="mt-1 text-stone-700">{s.description}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="plan-results-heading" className="min-w-0">
        <h2 id="plan-results-heading" className="text-lg font-semibold">
          Avalanche and snowball, side by side
        </h2>
        <div role="status" aria-live="polite" className="mt-1 text-sm text-stone-700">
          {built.incomplete.length > 0 && (
            <span className="block">
              {incompleteNote(built.incomplete.length)} Finish{" "}
              {built.incomplete.length === 1 ? "it" : "them"} on the{" "}
              <a href="#debts" className="font-medium text-emerald-800 underline">
                Debts tab
              </a>
              .
            </span>
          )}
          {status.kind === "loading" && "Updating results..."}
        </div>
        {(general.length > 0 || debtErrors.length > 0) && (
          <div role="alert" className="mt-2 rounded-lg border border-red-700 p-3 text-sm text-red-800">
            <span className="font-semibold">Error: </span>
            {general.join(" ")}
            {debtErrors.length > 0 && (
              <>
                {" "}
                Some debts need fixing on the{" "}
                <a href="#debts" className="underline">
                  Debts tab
                </a>
                .
              </>
            )}
          </div>
        )}
        {status.kind === "done" && (
          <PlanResults result={status.data} money={money} disclaimer={disclaimer} />
        )}
      </section>
    </div>
  );
}

/** "-16" -> "16": drops the sign from an API value for wording like "16 months sooner". */
function unsigned(value: string): string {
  return value.replace(/^-/, "");
}

function differenceSentences(
  d: CompareResponse["differences"],
  money: (v: string) => string,
): string[] {
  const sentences: string[] = [];
  const interest = d.total_interest;
  if (/^-?0+(\.0+)?$/.test(interest)) {
    sentences.push("Both cost the same total interest.");
  } else {
    const cheaper = interest.startsWith("-") ? "Snowball" : "Avalanche";
    sentences.push(`${cheaper} costs ${money(unsigned(interest))} less in interest.`);
  }
  const months = d.debt_free_month;
  if (months === 0) {
    sentences.push("Both are debt-free in the same month.");
  } else {
    const sooner = months > 0 ? "Avalanche" : "Snowball";
    sentences.push(`${sooner} is debt-free ${formatDuration(Math.abs(months))} sooner.`);
  }
  const first = d.first_payoff_month;
  if (first === 0) {
    sentences.push("Both pay off their first debt in the same month.");
  } else {
    const sooner = first < 0 ? "Snowball" : "Avalanche";
    sentences.push(`${sooner} pays off its first debt ${formatDuration(Math.abs(first))} sooner.`);
  }
  return sentences;
}

function PlanResults({
  result,
  money,
  disclaimer,
}: {
  result: CompareResponse;
  money: (v: string) => string;
  disclaimer: string;
}) {
  const strategies = [
    { key: "avalanche", data: result.avalanche },
    { key: "snowball", data: result.snowball },
  ] as const;
  const baseline = result.avalanche.baseline;
  const rows: { label: string; value: (s: StrategyResponse) => string }[] = [
    { label: "Debt-free in", value: (s) => formatDuration(s.debt_free_month) },
    { label: "Total interest", value: (s) => money(s.total_interest) },
    { label: "Interest saved", value: (s) => money(s.interest_saved) },
    { label: "Time saved", value: (s) => formatDuration(s.months_saved) },
    { label: "First debt paid off", value: (s) => `Month ${s.first_payoff_month}` },
  ];

  return (
    <div className="mt-3">
      <p className="text-xs text-stone-600">{disclaimer}</p>
      <p className="mt-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
        <span className="font-medium">For reference, with no extra money: </span>
        debt-free in {formatDuration(baseline.debt_free_month)}, total interest{" "}
        {money(baseline.total_interest)}. Savings below are compared with this.
      </p>

      <table className="mt-3 w-full table-fixed text-sm">
        <caption className="sr-only">Avalanche and snowball compared</caption>
        <thead>
          <tr className="text-left text-stone-600">
            <th scope="col" className="w-1/3 py-1 font-medium">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="py-1 font-medium">
              Avalanche
            </th>
            <th scope="col" className="py-1 font-medium">
              Snowball
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-stone-200 align-top">
              <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-700">
                {row.label}
              </th>
              <td className="py-2 pr-2 break-words">{row.value(result.avalanche)}</td>
              <td className="py-2 break-words">{row.value(result.snowball)}</td>
            </tr>
          ))}
          <tr className="border-t border-stone-200 align-top">
            <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-700">
              Payoff order
            </th>
            {strategies.map((s) => (
              <td key={s.key} className="py-2 pr-2">
                <PayoffOrder strategy={s.data} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" aria-label="Differences">
        {differenceSentences(result.differences, money).map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>

      <LineChart
        title="Total balance over time"
        description={`With no extra money the debts are paid off in month ${baseline.debt_free_month}. Avalanche finishes in month ${result.avalanche.debt_free_month} and snowball in month ${result.snowball.debt_free_month}.`}
        startMonth={1}
        series={[
          {
            label: "No extra money",
            values: baseline.timeline.map((r) => r.total_ending_balance),
            color: "#78716c",
            dash: "2 4",
          },
          {
            label: "Avalanche",
            values: result.avalanche.timeline.map((r) => r.total_ending_balance),
            color: "#047857",
          },
          {
            label: "Snowball",
            values: result.snowball.timeline.map((r) => r.total_ending_balance),
            color: "#1d4ed8",
            dash: "8 4",
          },
        ]}
      />
    </div>
  );
}

function PayoffOrder({ strategy }: { strategy: StrategyResponse }) {
  const byId = new Map(strategy.debts.map((d) => [d.id, d]));
  return (
    <ol className="list-decimal space-y-1 pl-4" aria-label={`${strategy.strategy} payoff order`}>
      {strategy.payoff_order.map((id) => {
        const debt = byId.get(id);
        return (
          <li key={id} className="break-words">
            {debt?.name ?? id}, month {debt?.payoff_month}
          </li>
        );
      })}
    </ol>
  );
}
