import { useMemo, useState } from "react";
import {
  postHousehold,
  type HouseholdRequest,
  type HouseholdResponse,
  type Meta,
  type OwnerTotals,
} from "../api";
import { SummaryCard } from "../components/fields";
import { formatMoney, toPlotNumber, type Currency } from "../lib/format";
import { buildHousehold, isEmpty } from "../lib/householdRequest";
import { ownerLabel } from "../lib/owners";
import type { AppData, Owner } from "../lib/storage";
import { splitErrors, useCalculation } from "../lib/useCalculation";

type Props = {
  data: AppData;
  currency: Currency;
  meta: Meta | null;
  disclaimer: string;
  onGoTo: (tab: "household" | "debts" | "plan") => void;
  /** Pre-fill the Payoff Plan's extra amount, then open it. */
  onSeePayoffPlan: (extra: string) => void;
};

type View = "household" | Owner;

const isNegative = (value: string) => value.startsWith("-");
const isZero = (value: string) => /^-?0+(\.0+)?$/.test(value);

const RATIOS: { key: keyof HouseholdResponse["ratios"]; label: string; explain: string; unit: string }[] = [
  {
    key: "debt_payments_pct",
    label: "Debt payments",
    explain: "The share of your take-home pay that goes to debt payments.",
    unit: "%",
  },
  {
    key: "housing_pct",
    label: "Housing",
    explain: "The share of your take-home pay that goes to rent or a mortgage.",
    unit: "%",
  },
  {
    key: "savings_rate_pct",
    label: "Savings rate",
    explain: "The share of your take-home pay you put aside each month.",
    unit: "%",
  },
  {
    key: "emergency_fund_months",
    label: "Emergency fund",
    explain: "How many months of spending and debt payments your emergency fund would cover.",
    unit: " months",
  },
];

export function OverviewTab({ data, currency, meta, disclaimer, onGoTo, onSeePayoffPlan }: Props) {
  const built = useMemo(() => buildHousehold(data, meta), [data, meta]);
  const requestKey = built.request ? JSON.stringify(built.request) : "";
  const status = useCalculation<HouseholdResponse>(requestKey, (key, signal) =>
    postHousehold(JSON.parse(key) as HouseholdRequest, signal),
  );
  const { general } = splitErrors(status);
  const [view, setView] = useState<View>("household");
  const money = (v: string) => formatMoney(v, currency);
  const names = data.household.names;

  if (isEmpty(data)) {
    return (
      <div className="max-w-xl">
        <h2 className="text-lg font-semibold">Welcome to Money Trees</h2>
        <p className="mt-2 text-sm text-stone-700">
          Enter what comes in, what goes out, and what you own and owe. This page then shows the
          whole picture in one place.
        </p>
        <button type="button" className="btn-secondary mt-4" onClick={() => onGoTo("household")}>
          Start with your household
        </button>
      </div>
    );
  }

  if (!built.request) {
    return (
      <p className="max-w-xl text-sm text-stone-700">
        Add {data.household.kind === "couple" ? "both first names" : "your first name"} on the{" "}
        <a href="#household" className="font-medium text-emerald-800 underline">
          Household tab
        </a>{" "}
        to see your overview.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div role="status" aria-live="polite" className="text-sm text-stone-700">
        {status.kind === "loading" && "Updating..."}
        {status.kind === "error" && "Some details need fixing on the Household or Debts tab."}
      </div>
      {general.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-700 p-3 text-sm text-red-800">
          <span className="font-semibold">Error: </span>
          {general.join(" ")}
        </div>
      )}
      {status.kind === "done" && (
        <OverviewResults
          result={status.data}
          money={money}
          names={names}
          view={view}
          onView={setView}
          disclaimer={disclaimer}
          hasDebts={(built.request.debts ?? []).length > 0}
          onSeePayoffPlan={onSeePayoffPlan}
        />
      )}
    </div>
  );
}

function OverviewResults({
  result,
  money,
  names,
  view,
  onView,
  disclaimer,
  hasDebts,
  onSeePayoffPlan,
}: {
  result: HouseholdResponse;
  money: (v: string) => string;
  names: [string, string];
  view: View;
  onView: (view: View) => void;
  disclaimer: string;
  hasDebts: boolean;
  onSeePayoffPlan: (extra: string) => void;
}) {
  const t = result.totals;
  const couple = result.household_type === "couple" && result.by_owner !== null;
  const ownerView = couple && view !== "household" ? result.by_owner![view as Owner] : null;
  const leftOver = t.left_over;
  const showPlanLink = hasDebts && !isNegative(leftOver) && !isZero(leftOver);

  return (
    <>
      <p className="text-xs text-stone-600">{disclaimer}</p>

      {couple && (
        <div
          role="group"
          aria-label="Show numbers for"
          className="inline-flex flex-wrap overflow-hidden rounded-lg border border-stone-300"
        >
          {(["household", "p1", "p2", "joint"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={`px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700 ${
                view === v ? "bg-emerald-800 text-white" : "bg-white text-stone-800 hover:bg-stone-50"
              }`}
              onClick={() => onView(v)}
            >
              {v === "household" ? "Household" : ownerLabel(v, names)}
            </button>
          ))}
        </div>
      )}

      {ownerView ? (
        <OwnerSummary totals={ownerView} money={money} who={ownerLabel(view as Owner, names)} />
      ) : (
        <>
          <section aria-labelledby="month-heading">
            <h2 id="month-heading" className="text-lg font-semibold">
              Each month
            </h2>
            <dl aria-label="Monthly totals" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <SummaryCard label="Take-home pay" value={money(t.income)} />
              <SummaryCard label="Spending" value={money(t.spending)} />
              <SummaryCard label="Debt payments" value={money(t.debt_payments)} />
              <SummaryCard label="Saving" value={money(t.saving)} />
              <SummaryCard label="Left over" value={money(leftOver)} />
            </dl>
            {isNegative(leftOver) && (
              <p className="mt-2 text-sm text-stone-800">
                You're spending {money(leftOver.slice(1))} more than you bring in each month.
              </p>
            )}
            {showPlanLink && (
              <p className="mt-2 text-sm text-stone-800">
                You have {money(leftOver)} left each month.{" "}
                <button
                  type="button"
                  className="font-medium text-emerald-800 underline"
                  onClick={() => onSeePayoffPlan(leftOver)}
                >
                  See what it could do on the Payoff Plan.
                </button>
              </p>
            )}
          </section>

          <SpendingChart result={result} money={money} />

          <section aria-labelledby="ratios-heading">
            <h2 id="ratios-heading" className="text-lg font-semibold">
              Ratios
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {RATIOS.map((r) => {
                const value = result.ratios[r.key];
                return (
                  <li key={r.key} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                    <p className="text-stone-600">{r.label}</p>
                    <p className="mt-1 text-lg font-semibold">
                      {value === null ? "Not available yet" : `${value}${r.unit}`}
                    </p>
                    <p className="mt-1 text-stone-700">{r.explain}</p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="net-worth-heading">
            <h2 id="net-worth-heading" className="text-lg font-semibold">
              Net worth
            </h2>
            <dl aria-label="Net worth totals" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryCard label="Total assets" value={money(result.net_worth.total_assets)} />
              <SummaryCard label="Debts owed" value={money(result.net_worth.total_debt_balances)} />
              <SummaryCard label="Net worth" value={money(result.net_worth.net_worth)} />
              <SummaryCard label="Liquid assets" value={money(result.net_worth.liquid_assets)} />
            </dl>
            <p className="mt-2 text-sm text-stone-700">
              Liquid assets are what you could reach quickly: cash, emergency fund and
              investments.
            </p>
          </section>
        </>
      )}

      {result.notes.length > 0 && (
        <div role="note" aria-label="Notes" className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          <ul className="list-disc space-y-1 pl-4">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function OwnerSummary({
  totals,
  money,
  who,
}: {
  totals: OwnerTotals;
  money: (v: string) => string;
  who: string;
}) {
  return (
    <section aria-labelledby="owner-heading">
      <h2 id="owner-heading" className="text-lg font-semibold">
        {who}
      </h2>
      <dl aria-label={`Numbers for ${who}`} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <SummaryCard label="Take-home pay" value={money(totals.income)} />
        <SummaryCard label="Expenses entered" value={money(totals.entered_expenses)} />
        <SummaryCard label="Debt payments" value={money(totals.debt_payments)} />
        <SummaryCard label="Debts owed" value={money(totals.debt_balances)} />
        <SummaryCard label="Assets" value={money(totals.assets)} />
      </dl>
      <p className="mt-2 text-sm text-stone-700">
        Joint items are shown on their own and never split between partners.
      </p>
    </section>
  );
}

/** Spending by group, largest first. Strings become numbers only to size the bars. */
function SpendingChart({
  result,
  money,
}: {
  result: HouseholdResponse;
  money: (v: string) => string;
}) {
  const groups = result.groups
    .filter((g) => toPlotNumber(g.total) > 0)
    .sort((a, b) => toPlotNumber(b.total) - toPlotNumber(a.total));
  const largest = groups[0] ? toPlotNumber(groups[0].total) : 0;
  if (!groups.length) return null;
  return (
    <section aria-labelledby="groups-heading">
      <h2 id="groups-heading" className="text-lg font-semibold">
        Where it goes each month
      </h2>
      <ul aria-label="Spending by group, largest first" className="mt-2 space-y-2">
        {groups.map((g) => (
          <li key={g.group} className="text-sm">
            <div className="flex justify-between gap-2">
              <span>{g.label}</span>
              <span className="tabular-nums">{money(g.total)}</span>
            </div>
            <div className="mt-1 h-3 rounded bg-stone-200" aria-hidden="true">
              <div
                className="h-3 rounded bg-emerald-700"
                style={{ width: `${(100 * toPlotNumber(g.total)) / largest}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
