import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../api";
import { buildDebts, termAfterCategoryChange } from "../lib/debtRequest";
import type { Currency } from "../lib/format";
import type { DebtInput, TermUnit } from "../lib/storage";
import { THREE_DEBTS } from "../test/debts";
import caseG from "../test/fixtures/debts-case-g.json";
import metaFixture from "../test/fixtures/meta.json";
import { mockApi, sentBodies } from "../test/mockApi";
import { DebtsTab } from "./DebtsTab";

const meta = metaFixture as Meta;

afterEach(() => vi.unstubAllGlobals());

function Harness({
  initial = [],
  currency = "USD",
  unit = "years",
}: {
  initial?: DebtInput[];
  currency?: Currency;
  unit?: TermUnit;
}) {
  const [debts, setDebts] = useState(initial);
  const [termUnit, setTermUnit] = useState<TermUnit>(unit);
  return (
    <DebtsTab
      debts={debts}
      onChange={setDebts}
      termUnit={termUnit}
      onTermUnitChange={setTermUnit}
      currency={currency}
      meta={meta}
      disclaimer="Disclaimer text"
    />
  );
}

const EMPTY: DebtInput = {
  id: "new",
  name: "",
  category: "",
  balance: "",
  ratePercent: "",
  term: "",
  termUnit: "years",
};

function card(label: string): string {
  const summary = screen.getByLabelText("Combined summary");
  return within(summary).getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
}

const nameInput = () => screen.getByRole("textbox", { name: "Name (required)" });
const balanceInput = () => screen.getByRole("textbox", { name: "Balance owed (required)" });
const termInput = () => screen.getByRole("textbox", { name: "Time left to pay (required)" });
const typeSelect = () => screen.getByRole("combobox", { name: "Type (required)" });

describe("buildDebts", () => {
  it("builds the API request with rates as fractions and time left in months", () => {
    expect(buildDebts(THREE_DEBTS).debts[0]).toEqual({
      id: "p1",
      name: "Personal loan",
      category: "personal",
      principal: "3000",
      annual_rate: "0.04",
      term_months: 24,
    });
    expect(buildDebts([{ ...THREE_DEBTS[1]!, term: "5", termUnit: "years" }]).debts[0]).toMatchObject(
      { term_months: 60 },
    );
  });

  it("leaves incomplete debts out and lists them", () => {
    const built = buildDebts([THREE_DEBTS[0]!, { ...THREE_DEBTS[1]!, balance: "" }, THREE_DEBTS[2]!]);
    expect(built.debts.map((d) => d.id)).toEqual(["p1", "s1"]);
    expect(built.rowIndex).toEqual([0, 2]);
    expect(built.incomplete).toEqual(["c1"]);
    expect(built.problems.c1).toEqual({ principal: "Enter the balance you still owe." });
  });
});

describe("category pre-fill", () => {
  it("fills the suggested time left only when the field is empty", () => {
    expect(termAfterCategoryChange({ term: "", termUnit: "years" }, 60)).toEqual({
      term: "5",
      termUnit: "years",
    });
    expect(termAfterCategoryChange({ term: "", termUnit: "months" }, 60)).toEqual({
      term: "60",
      termUnit: "months",
    });
    expect(termAfterCategoryChange({ term: "48", termUnit: "months" }, 60)).toEqual({
      term: "48",
      termUnit: "months",
    });
    expect(termAfterCategoryChange({ term: "", termUnit: "years" }, null)).toEqual({
      term: "",
      termUnit: "years",
    });
  });

  it("never overwrites a typed time left in the form", () => {
    mockApi();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));

    fireEvent.change(typeSelect(), { target: { value: "auto" } });
    expect(termInput()).toHaveValue("5");
    expect(termInput()).toHaveAccessibleDescription(/= 60 months/);

    fireEvent.change(termInput(), { target: { value: "4" } });
    fireEvent.change(typeSelect(), { target: { value: "mortgage" } });
    expect(termInput()).toHaveValue("4");

    fireEvent.change(termInput(), { target: { value: "" } });
    fireEvent.change(typeSelect(), { target: { value: "other" } });
    expect(termInput()).toHaveValue("");
  });

  it("doesn't offer credit cards", () => {
    mockApi();
    render(<Harness initial={[THREE_DEBTS[0]!]} />);
    const options = within(typeSelect()).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "",
      "mortgage",
      "auto",
      "student",
      "personal",
      "other",
    ]);
    expect(screen.getByText(/Credit cards aren't included yet/)).toBeVisible();
  });
});

describe("fields", () => {
  it("uses the spec's labels and helper text, all marked required", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    expect(nameInput()).toHaveAccessibleDescription("A name you'll recognize, like Honda loan.");
    expect(balanceInput()).toHaveAccessibleDescription(
      "What you still owe today, not the original loan amount.",
    );
    expect(screen.getByRole("textbox", { name: "Interest rate (%) (required)" })).toHaveAccessibleDescription(
      "The yearly rate on your statement.",
    );
    expect(termInput()).toHaveAccessibleDescription(
      "How long until this is paid off on your current schedule. Check your loan statement.",
    );
    expect(typeSelect()).toHaveAttribute("aria-required", "true");
  });

  it("starts time left on Years and remembers the last unit for new debts", () => {
    mockApi();
    render(<Harness initial={[{ ...THREE_DEBTS[0]!, id: "a" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
    // The first debt is complete, so a new one is added, starting on Years.
    const groups = screen.getAllByRole("group", { name: "Time left to pay unit" });
    const newGroup = groups[1]!;
    expect(within(newGroup).getByRole("button", { name: "Years" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(newGroup).getByRole("button", { name: "Months" }));
    expect(within(newGroup).getByRole("button", { name: "Months" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("gives a new debt the unit picked last", () => {
    mockApi();
    render(<Harness initial={[]} unit="months" />);
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
    expect(screen.getByRole("button", { name: "Months" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("validation timing", () => {
  it("shows no errors on a new, empty debt", () => {
    mockApi();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    expect(nameInput()).toHaveFocus();
  });

  it("shows a required field's error after leaving it empty, and clears it while typing", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.blur(balanceInput());
    expect(balanceInput()).toHaveAttribute("aria-invalid", "true");
    expect(balanceInput()).toHaveAccessibleDescription(/Error: Enter the balance you still owe\./);
    expect(nameInput()).not.toHaveAttribute("aria-invalid");

    fireEvent.change(balanceInput(), { target: { value: "15" } });
    expect(balanceInput()).not.toHaveAttribute("aria-invalid");
  });

  it("asks for Months when Years has a decimal, and treats 0 as an error", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.change(termInput(), { target: { value: "4.5" } });
    expect(termInput()).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(termInput());
    expect(termInput()).toHaveAccessibleDescription(
      /Use whole years, or switch to Months for anything in between\./,
    );
    fireEvent.change(termInput(), { target: { value: "0" } });
    expect(termInput()).toHaveAccessibleDescription(/Enter at least 1 year\./);
  });

  it("pressing Add debt shows every missing field and focuses the first", () => {
    mockApi();
    render(<Harness initial={[{ ...EMPTY, name: "Honda loan" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));

    expect(screen.getAllByRole("textbox", { name: "Name (required)" })).toHaveLength(1);
    expect(nameInput()).not.toHaveAttribute("aria-invalid");
    expect(typeSelect()).toHaveAccessibleDescription("Error: Choose a type.");
    expect(balanceInput()).toHaveAccessibleDescription(/Enter the balance you still owe\./);
    expect(screen.getByRole("textbox", { name: "Interest rate (%) (required)" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(termInput()).toHaveAccessibleDescription(/Enter the time left to pay\./);
    expect(typeSelect()).toHaveFocus();
    expect(screen.getByText("Finish the fields marked above to add another debt.")).toBeVisible();
  });
});

describe("results", () => {
  it("shows case G exactly as the API returns it", async () => {
    const fetchMock = mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={THREE_DEBTS} />);

    await waitFor(() => expect(card("Total monthly payment")).toBe("$663.69"));
    expect(card("Total interest")).toBe("$10,454.06");
    expect(card("Debt-free in")).toBe("10 years 0 months");

    const each = within(screen.getByRole("list", { name: "Each debt" })).getAllByRole("listitem");
    expect(each[0]).toHaveTextContent(
      "Personal loan (Personal loan)Payment$130.27Paid off in2 years 0 monthsTotal interest$126.58",
    );
    expect(each[1]).toHaveTextContent("Payment$311.38Paid off in5 years 0 monthsTotal interest$3,682.46");
    expect(each[2]).toHaveTextContent("Payment$222.04Paid off in10 years 0 monthsTotal interest$6,645.02");

    const byCategory = within(screen.getByRole("list", { name: "By category" })).getAllByRole(
      "listitem",
    );
    expect(byCategory.map((li) => li.textContent)).toEqual([
      "Auto loanBalance $15,000.00, interest $3,682.46",
      "Student loanBalance $20,000.00, interest $6,645.02",
      "Personal loanBalance $3,000.00, interest $126.58",
    ]);
    expect(screen.getByText(/Total balance \(balance reaches 0 in month 120\)/)).toBeVisible();

    const [sent] = sentBodies(fetchMock, "/api/debts") as { debts: unknown[] }[];
    expect(sent?.debts).toHaveLength(3);
    expect(screen.queryByText(/isn't included yet/)).not.toBeInTheDocument();
  });

  it("formats the same values for UGX", async () => {
    mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={THREE_DEBTS} currency="UGX" />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("UGX 664"));
    expect(card("Total interest")).toBe("UGX 10,454");
  });

  it("leaves an incomplete debt out of the totals and says so", async () => {
    const fetchMock = mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={[...THREE_DEBTS, { ...EMPTY, name: "Phone plan" }]} />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("$663.69"));
    expect(screen.getByText("1 debt is incomplete and isn't included yet.")).toBeVisible();
    expect(within(screen.getByRole("group", { name: /Phone plan/ })).getByText("Incomplete")).toBeVisible();
    const sent = sentBodies(fetchMock, "/api/debts") as { debts: { id: string }[] }[];
    expect(sent.at(-1)?.debts.map((d) => d.id)).toEqual(["p1", "c1", "s1"]);
    // The incomplete debt's fields stay quiet until touched.
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
  });

  it("puts API errors on the right debt even when an earlier one is incomplete", async () => {
    mockApi({
      "/api/debts": () => ({
        status: 422,
        json: { errors: [{ field: "debts[1].annual_rate", message: "Rate must be below 1 (100%)." }] },
      }),
    });
    render(<Harness initial={[{ ...EMPTY, name: "Draft" }, ...THREE_DEBTS]} />);
    const rates = screen.getAllByRole("textbox", { name: "Interest rate (%) (required)" });
    // Request index 1 is the car loan, which is row 2 here.
    await waitFor(() => expect(rates[2]).toHaveAttribute("aria-invalid", "true"));
    expect(rates[2]).toHaveAccessibleDescription(/Rate must be below 1/);
    expect(rates[1]).not.toHaveAttribute("aria-invalid");
  });

  it("edits and deletes debts", () => {
    mockApi();
    render(<Harness initial={[THREE_DEBTS[0]!]} />);
    fireEvent.change(nameInput(), { target: { value: "Bank loan" } });
    expect(screen.getByRole("group", { name: "Bank loan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Bank loan" }));
    expect(screen.queryByRole("textbox", { name: "Name (required)" })).not.toBeInTheDocument();
  });
});
