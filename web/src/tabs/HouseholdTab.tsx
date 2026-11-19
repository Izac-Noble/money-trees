import { useMemo, useState } from "react";
import { postHousehold, type HouseholdRequest, type HouseholdResponse, type Meta } from "../api";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { OwnerPicker } from "../components/OwnerPicker";
import { ownerLabel } from "../lib/owners";
import { TextField } from "../components/fields";
import {
  assetKey,
  buildHousehold,
  customKey,
  expenseKey,
  hasPartnerOrJointItems,
  incomeKey,
  nameKey,
  reassignToFirstPerson,
} from "../lib/householdRequest";
import { currencySymbol, formatMoney, type Currency } from "../lib/format";
import {
  newKey,
  type AppData,
  type ExpenseInput,
  type HouseholdInput,
  type Owner,
} from "../lib/storage";
import { splitErrors, useCalculation } from "../lib/useCalculation";
import { useTouched } from "../lib/useTouched";

type Props = {
  data: AppData;
  onChange: (update: (data: AppData) => AppData) => void;
  currency: Currency;
  meta: Meta | null;
};

const DEFAULT_FREQUENCY = "monthly";
const EMPTY_EXPENSE: ExpenseInput = { amount: "", frequency: DEFAULT_FREQUENCY, owner: "joint" };

function FrequencyPicker({
  id,
  value,
  onChange,
  meta,
  itemLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  meta: Meta | null;
  itemLabel: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        How often
        <span className="sr-only"> ({itemLabel})</span>
      </label>
      <select
        id={id}
        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(meta?.frequencies ?? []).map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function HouseholdTab({ data, onChange, currency, meta }: Props) {
  const h = data.household;
  const couple = h.kind === "couple";
  const built = useMemo(() => buildHousehold(data, meta), [data, meta]);
  const requestKey = built.request ? JSON.stringify(built.request) : "";
  const status = useCalculation<HouseholdResponse>(requestKey, (key, signal) =>
    postHousehold(JSON.parse(key) as HouseholdRequest, signal),
  );
  const touched = useTouched();
  const [confirmSingle, setConfirmSingle] = useState(false);
  const money = (v: string) => formatMoney(v, currency);
  const symbol = currencySymbol(currency);

  const { general } = splitErrors(status);
  const apiErrors: Record<string, string> = {};
  if (status.kind === "error") {
    for (const error of status.errors) {
      const key = error.field ? built.pathToKey[error.field] : undefined;
      if (key) apiErrors[key] = error.message;
      else if (error.field) general.push(error.message);
    }
  }
  const errorFor = (key: string) =>
    (touched.isVisible(key) ? built.problems[key] : undefined) || apiErrors[key];

  const setHousehold = (patch: Partial<HouseholdInput>) =>
    onChange((d) => ({ ...d, household: { ...d.household, ...patch } }));
  const setExpense = (category: string, patch: Partial<ExpenseInput>) =>
    onChange((d) => ({
      ...d,
      household: {
        ...d.household,
        expenses: {
          ...d.household.expenses,
          [category]: { ...EMPTY_EXPENSE, ...d.household.expenses[category], ...patch },
        },
      },
    }));

  const chooseKind = (kind: "single" | "couple") => {
    if (kind === h.kind) return;
    if (kind === "single" && hasPartnerOrJointItems(data)) {
      setConfirmSingle(true);
      return;
    }
    setHousehold({ kind });
  };

  const monthlyIncome = (key: string) =>
    status.kind === "done" ? status.data.incomes.find((i) => i.id === key)?.monthly : undefined;
  const debtLines = (category: string) =>
    status.kind === "done"
      ? status.data.lines.filter((l) => l.source === "debts" && l.category === category)
      : [];

  const owner = (id: string, value: Owner, onPick: (o: Owner) => void, itemLabel: string) =>
    couple ? (
      <OwnerPicker id={id} value={value} onChange={onPick} names={h.names} itemLabel={itemLabel} />
    ) : null;

  const groups = (meta?.expense_groups ?? []).filter((g) => g.value !== "other");
  const categories = meta?.expense_categories ?? [];

  return (
    <div className="max-w-3xl space-y-8">
      <section aria-labelledby="setup-heading">
        <h2 id="setup-heading" className="text-lg font-semibold">
          Who's this for?
        </h2>
        <div
          role="group"
          aria-labelledby="setup-heading"
          className="mt-2 inline-flex overflow-hidden rounded-lg border border-stone-300"
        >
          {(meta?.household_types ?? [
            { value: "single" as const, label: "Just me" },
            { value: "couple" as const, label: "Couple" },
          ]).map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={h.kind === t.value}
              className={`px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700 ${
                h.kind === t.value
                  ? "bg-emerald-800 text-white"
                  : "bg-white text-stone-800 hover:bg-stone-50"
              }`}
              onClick={() => chooseKind(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(couple ? [0, 1] : [0]).map((i) => (
            <TextField
              key={i}
              id={`person-${i}-name`}
              label={couple ? (i === 0 ? "First person's first name" : "Second person's first name") : "Your first name"}
              inputMode="text"
              required
              value={h.names[i] ?? ""}
              onChange={(name) =>
                setHousehold({
                  names: i === 0 ? [name, h.names[1]] : [h.names[0], name],
                })
              }
              onBlur={() => touched.touch(nameKey(i))}
              error={errorFor(nameKey(i))}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="income-heading">
        <h2 id="income-heading" className="text-lg font-semibold">
          Income
        </h2>
        <p className="mt-1 text-sm text-stone-700">
          Take-home pay: what actually lands in your account.
        </p>
        <ul className="mt-3 space-y-3">
          {h.incomes.map((row, i) => {
            const monthly = monthlyIncome(row.key);
            const name = row.label.trim() || `Income ${i + 1}`;
            const update = (patch: Partial<typeof row>) =>
              setHousehold({
                incomes: h.incomes.map((r) => (r.key === row.key ? { ...r, ...patch } : r)),
              });
            return (
              <li key={row.key} className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    id={`income-${row.key}-label`}
                    label="Label"
                    inputMode="text"
                    placeholder="For example, Sam's job"
                    value={row.label}
                    onChange={(label) => update({ label })}
                    onBlur={() => touched.touch(incomeKey(row.key, "label"))}
                    error={errorFor(incomeKey(row.key, "label"))}
                  />
                  <TextField
                    id={`income-${row.key}-amount`}
                    label="Take-home amount"
                    prefix={symbol}
                    value={row.amount}
                    onChange={(amount) => update({ amount })}
                    onBlur={() => touched.touch(incomeKey(row.key, "amount"))}
                    error={errorFor(incomeKey(row.key, "amount"))}
                  />
                  <FrequencyPicker
                    id={`income-${row.key}-frequency`}
                    value={row.frequency}
                    onChange={(frequency) => update({ frequency })}
                    meta={meta}
                    itemLabel={name}
                  />
                  {owner(`income-${row.key}-owner`, row.owner, (o) => update({ owner: o }), name)}
                </div>
                {monthly && (
                  <p className="mt-2 text-sm text-stone-700">= {money(monthly)} a month</p>
                )}
                <button
                  type="button"
                  className="btn-secondary mt-2"
                  aria-label={`Remove ${name}`}
                  onClick={() => setHousehold({ incomes: h.incomes.filter((r) => r.key !== row.key) })}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={() =>
            setHousehold({
              incomes: [
                ...h.incomes,
                { key: newKey(), label: "", amount: "", frequency: DEFAULT_FREQUENCY, owner: "p1" },
              ],
            })
          }
        >
          Add income
        </button>
      </section>

      <section aria-labelledby="expenses-heading">
        <h2 id="expenses-heading" className="text-lg font-semibold">
          Expenses
        </h2>
        <p className="mt-1 text-sm text-stone-700">Leave a row blank if it doesn't apply.</p>
        {groups.map((group) => {
          const rows = categories.filter((c) => c.group === group.value && c.value !== "custom");
          const visible = rows.filter((c) => c.enterable || built.fromDebts.has(c.value));
          if (!visible.length) return null;
          return (
            <fieldset key={group.value} className="mt-4">
              <legend className="text-base font-semibold">{group.label}</legend>
              <ul className="mt-2 space-y-2">
                {visible.map((category) => {
                  if (built.fromDebts.has(category.value)) {
                    const lines = debtLines(category.value);
                    return (
                      <li
                        key={category.value}
                        className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm"
                        aria-label={category.label}
                      >
                        <p className="font-medium">{category.label}</p>
                        {lines.length ? (
                          <ul className="mt-1">
                            {lines.map((line) => (
                              <li key={line.id}>
                                {line.label}: {money(line.monthly)} a month
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-stone-700">
                            Counted once the debt is complete.
                          </p>
                        )}
                        <p className="mt-1 text-stone-700">
                          From your Debts tab.{" "}
                          <a href="#debts" className="font-medium text-emerald-800 underline">
                            Go to Debts
                          </a>
                        </p>
                      </li>
                    );
                  }
                  const row = { ...EMPTY_EXPENSE, ...h.expenses[category.value] };
                  return (
                    <li key={category.value} className="rounded-lg border border-stone-200 bg-white p-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <TextField
                          id={`expense-${category.value}-amount`}
                          label={category.label}
                          prefix={symbol}
                          value={row.amount}
                          onChange={(amount) => setExpense(category.value, { amount })}
                          onBlur={() => touched.touch(expenseKey(category.value))}
                          error={errorFor(expenseKey(category.value))}
                        />
                        <FrequencyPicker
                          id={`expense-${category.value}-frequency`}
                          value={row.frequency}
                          onChange={(frequency) => setExpense(category.value, { frequency })}
                          meta={meta}
                          itemLabel={category.label}
                        />
                        {owner(
                          `expense-${category.value}-owner`,
                          row.owner,
                          (o) => setExpense(category.value, { owner: o }),
                          category.label,
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}

        <fieldset className="mt-4">
          <legend className="text-base font-semibold">Your own</legend>
          <ul className="mt-2 space-y-2">
            {h.customExpenses.map((row, i) => {
              const name = row.label.trim() || `Your own expense ${i + 1}`;
              const update = (patch: Partial<typeof row>) =>
                setHousehold({
                  customExpenses: h.customExpenses.map((r) =>
                    r.key === row.key ? { ...r, ...patch } : r,
                  ),
                });
              return (
                <li key={row.key} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      id={`custom-${row.key}-label`}
                      label="What it's for"
                      inputMode="text"
                      value={row.label}
                      onChange={(label) => update({ label })}
                      onBlur={() => touched.touch(customKey(row.key, "label"))}
                      error={errorFor(customKey(row.key, "label"))}
                    />
                    <TextField
                      id={`custom-${row.key}-amount`}
                      label="Amount"
                      prefix={symbol}
                      value={row.amount}
                      onChange={(amount) => update({ amount })}
                      onBlur={() => touched.touch(customKey(row.key, "amount"))}
                      error={errorFor(customKey(row.key, "amount"))}
                    />
                    <FrequencyPicker
                      id={`custom-${row.key}-frequency`}
                      value={row.frequency}
                      onChange={(frequency) => update({ frequency })}
                      meta={meta}
                      itemLabel={name}
                    />
                    {owner(`custom-${row.key}-owner`, row.owner, (o) => update({ owner: o }), name)}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary mt-2"
                    aria-label={`Remove ${name}`}
                    onClick={() =>
                      setHousehold({
                        customExpenses: h.customExpenses.filter((r) => r.key !== row.key),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="btn-secondary mt-2"
            onClick={() =>
              setHousehold({
                customExpenses: [
                  ...h.customExpenses,
                  {
                    key: newKey(),
                    label: "",
                    amount: "",
                    frequency: DEFAULT_FREQUENCY,
                    owner: "joint",
                  },
                ],
              })
            }
          >
            Add your own
          </button>
        </fieldset>
      </section>

      <section aria-labelledby="assets-heading">
        <h2 id="assets-heading" className="text-lg font-semibold">
          What you own
        </h2>
        <ul className="mt-3 space-y-3">
          {h.assets.map((row, i) => {
            const typeLabel = meta?.asset_types.find((t) => t.value === row.type)?.label ?? row.type;
            const name = row.label.trim() || `${typeLabel} ${i + 1}`;
            const update = (patch: Partial<typeof row>) =>
              setHousehold({
                assets: h.assets.map((r) => (r.key === row.key ? { ...r, ...patch } : r)),
              });
            return (
              <li key={row.key} className="rounded-xl border border-stone-200 bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <label htmlFor={`asset-${row.key}-type`} className="block text-sm font-medium">
                      Type
                    </label>
                    <select
                      id={`asset-${row.key}-type`}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2"
                      value={row.type}
                      onChange={(e) => update({ type: e.target.value })}
                    >
                      {(meta?.asset_types ?? []).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {row.type === "emergency_fund" && (
                      <p className="mt-1 text-xs text-stone-600">
                        The amount saved so far. Your monthly contribution goes under Expenses.
                      </p>
                    )}
                  </div>
                  <TextField
                    id={`asset-${row.key}-label`}
                    label="Label (optional)"
                    inputMode="text"
                    value={row.label}
                    onChange={(label) => update({ label })}
                  />
                  <TextField
                    id={`asset-${row.key}-value`}
                    label="Value"
                    prefix={symbol}
                    value={row.value}
                    onChange={(value) => update({ value })}
                    onBlur={() => touched.touch(assetKey(row.key))}
                    error={errorFor(assetKey(row.key))}
                  />
                  {owner(`asset-${row.key}-owner`, row.owner, (o) => update({ owner: o }), name)}
                </div>
                <button
                  type="button"
                  className="btn-secondary mt-2"
                  aria-label={`Remove ${name}`}
                  onClick={() => setHousehold({ assets: h.assets.filter((r) => r.key !== row.key) })}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          className="btn-secondary mt-3"
          onClick={() =>
            setHousehold({
              assets: [
                ...h.assets,
                { key: newKey(), type: "cash", label: "", value: "", owner: "joint" },
              ],
            })
          }
        >
          Add something you own
        </button>
      </section>

      <div role="status" aria-live="polite" className="text-sm text-stone-700">
        {status.kind === "loading" && "Updating..."}
      </div>
      {general.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-700 p-3 text-sm text-red-800">
          <span className="font-semibold">Error: </span>
          {general.join(" ")}
        </div>
      )}

      {confirmSingle && (
        <ConfirmDialog
          title="Switch to Just me?"
          confirmLabel={`Move everything to ${ownerLabel("p1", h.names)}`}
          onCancel={() => setConfirmSingle(false)}
          onConfirm={() => {
            onChange(reassignToFirstPerson);
            setConfirmSingle(false);
          }}
        >
          <p>
            Some income, expenses, things you own or debts belong to{" "}
            {ownerLabel("p2", h.names)} or are joint. Switching moves them all to{" "}
            {ownerLabel("p1", h.names)}.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
