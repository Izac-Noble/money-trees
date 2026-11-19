import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../api";
import { applyCategory, buildDebts } from "../lib/debtRequest";
import { newDebt, type DebtInput, type TermUnit } from "../lib/storage";
import { CARD, THREE_DEBTS } from "../test/debts";
import caseG from "../test/fixtures/debts-case-g.json";
import caseV from "../test/fixtures/debts-case-v.json";
import metaFixture from "../test/fixtures/meta.json";
import { mockApi, sentBodies } from "../test/mockApi";
import { DebtsTab } from "./DebtsTab";

const meta = metaFixture as Meta;

afterEach(() => vi.unstubAllGlobals());

function Harness({
  initial = [],
  unit = "years",
  withMeta = true,
}: {
  initial?: DebtInput[];
  unit?: TermUnit;
  withMeta?: boolean;
}) {
  const [debts, setDebts] = useState(initial);
  const [termUnit, setTermUnit] = useState<TermUnit>(unit);
  return (
    <DebtsTab
      debts={debts}
      onChange={setDebts}
      termUnit={termUnit}
      onTermUnitChange={setTermUnit}
      currency="USD"
      meta={withMeta ? meta : null}
      disclaimer="Disclaimer text"
    />
  );
}

const EMPTY = newDebt("new", "years");

function card(label: string): string {
  const summary = screen.getByLabelText("Combined summary");
  return within(summary).getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
}

const nameInput = () => screen.getByRole("textbox", { name: "Name (required)" });
const balanceInput = () => screen.getByRole("textbox", { name: "Balance owed (required)" });
const termInput = () => screen.getByRole("textbox", { name: "Time left to pay (required)" });
const paymentInput = () => screen.getByRole("textbox", { name: "Monthly payment (required)" });
const typeSelect = () => screen.getByRole("combobox", { name: "Type (required)" });
const modeButton = (name: "Time left" | "Monthly payment") =>
  within(screen.getByRole("group", { name: "Enter by" })).getByRole("button", { name });

describe("buildDebts", () => {
  it("sends the field for the chosen mode only", () => {
    const built = buildDebts([THREE_DEBTS[0]!, { ...CARD, term: "3" }]);
    expect(built.debts).toEqual([
      {
        id: "p1",
        name: "Personal loan",
        category: "personal",
        payment_mode: "fixed_term",
        principal: "3000",
        annual_rate: "0.04",
        term_months: 24,
      },
      {
        id: "cc",
        name: "Credit card",
        category: "credit_card",
        payment_mode: "fixed_payment",
        principal: "5000",
        annual_rate: "0.24",
        monthly_payment: "200",
      },
    ]);
  });

  it("leaves incomplete debts out and lists them", () => {
    const built = buildDebts([
      THREE_DEBTS[0]!,
      { ...CARD, monthlyPayment: "" },
      THREE_DEBTS[2]!,
    ]);
    expect(built.debts.map((d) => d.id)).toEqual(["p1", "s1"]);
    expect(built.rowIndex).toEqual([0, 2]);
    expect(built.incomplete).toEqual(["cc"]);
    expect(built.problems.cc).toEqual({ monthly_payment: "Enter the monthly payment." });
  });
});

describe("type picker", () => {
  it("pre-selects the type's default mode until the user has chosen one", () => {
    expect(applyCategory(EMPTY, "credit_card", meta).paymentMode).toBe("fixed_payment");
    expect(applyCategory(EMPTY, "auto", meta).paymentMode).toBe("fixed_term");
    const chosen = { ...EMPTY, paymentMode: "fixed_term" as const, modeChosen: true };
    expect(applyCategory(chosen, "credit_card", meta).paymentMode).toBe("fixed_term");
  });

  it("fills the suggested time left only when the field is empty", () => {
    expect(applyCategory(EMPTY, "auto", meta)).toMatchObject({ term: "5", termUnit: "years" });
    expect(applyCategory({ ...EMPTY, termUnit: "months" }, "auto", meta)).toMatchObject({
      term: "60",
      termUnit: "months",
    });
    expect(applyCategory({ ...EMPTY, term: "48", termUnit: "months" }, "auto", meta)).toMatchObject(
      { term: "48" },
    );
    expect(applyCategory(EMPTY, "medical", meta).term).toBe("");
  });

  it("uses labels from /api/meta", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    const options = within(typeSelect())
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Choose a type",
      "Mortgage",
      "Car loan",
      "Student loan",
      "Personal loan",
      "Credit card",
      "Medical debt",
      "Loan from family or friends",
      "Tax debt",
      "Other",
    ]);
  });

  it("offers no types until /api/meta has loaded", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} withMeta={false} />);
    expect(within(typeSelect()).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Loading types...",
    ]);
  });

  it("switches to Monthly payment for a credit card and Time left for a car loan", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.change(typeSelect(), { target: { value: "credit_card" } });
    expect(modeButton("Monthly payment")).toHaveAttribute("aria-pressed", "true");
    expect(paymentInput()).toBeInTheDocument();
    fireEvent.change(typeSelect(), { target: { value: "auto" } });
    expect(modeButton("Time left")).toHaveAttribute("aria-pressed", "true");
    expect(termInput()).toHaveValue("5");
  });

  it("never overrides a touched toggle", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.click(modeButton("Time left"));
    fireEvent.change(typeSelect(), { target: { value: "credit_card" } });
    expect(modeButton("Time left")).toHaveAttribute("aria-pressed", "true");
  });

  it("never overrides a typed payment", () => {
    mockApi();
    render(<Harness initial={[{ ...EMPTY, paymentMode: "fixed_payment" }]} />);
    fireEvent.change(paymentInput(), { target: { value: "150" } });
    fireEvent.change(typeSelect(), { target: { value: "auto" } });
    expect(modeButton("Monthly payment")).toHaveAttribute("aria-pressed", "true");
    expect(paymentInput()).toHaveValue("150");
  });

  it("never overwrites a typed time left", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.change(termInput(), { target: { value: "4" } });
    fireEvent.change(typeSelect(), { target: { value: "mortgage" } });
    expect(termInput()).toHaveValue("4");
  });

  it("keeps both values when switching the toggle back and forth", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.change(termInput(), { target: { value: "4" } });
    fireEvent.click(modeButton("Monthly payment"));
    fireEvent.change(paymentInput(), { target: { value: "150" } });
    fireEvent.click(modeButton("Time left"));
    expect(termInput()).toHaveValue("4");
    fireEvent.click(modeButton("Monthly payment"));
    expect(paymentInput()).toHaveValue("150");
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
    expect(
      screen.getByRole("textbox", { name: "Interest rate (%) (required)" }),
    ).toHaveAccessibleDescription("The yearly rate on your statement.");
    expect(termInput()).toHaveAccessibleDescription(
      "How long until this is paid off on your current schedule. Check your loan statement.",
    );
    fireEvent.click(modeButton("Monthly payment"));
    expect(paymentInput()).toHaveAccessibleDescription(
      "The amount you pay, or plan to pay, each month.",
    );
  });

  it("gives a new debt the time unit picked last", () => {
    mockApi();
    render(<Harness unit="months" />);
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
    expect(balanceInput()).toHaveAccessibleDescription(/Error: Enter the balance you still owe\./);
    expect(nameInput()).not.toHaveAttribute("aria-invalid");
    fireEvent.change(balanceInput(), { target: { value: "15" } });
    expect(balanceInput()).not.toHaveAttribute("aria-invalid");
  });

  it("asks for Months when Years has a decimal, and treats 0 as an error", () => {
    mockApi();
    render(<Harness initial={[EMPTY]} />);
    fireEvent.change(termInput(), { target: { value: "4.5" } });
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
    expect(typeSelect()).toHaveAccessibleDescription("Error: Choose a type.");
    expect(balanceInput()).toHaveAccessibleDescription(/Enter the balance you still owe\./);
    expect(termInput()).toHaveAccessibleDescription(/Enter the time left to pay\./);
    expect(typeSelect()).toHaveFocus();
  });
});

describe("results", () => {
  it("shows case G exactly as the API returns it", async () => {
    mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={THREE_DEBTS} />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("$663.69"));
    expect(card("Total interest")).toBe("$10,454.06");
    expect(card("Debt-free in")).toBe("10 years 0 months");
    const each = within(screen.getByRole("list", { name: "Each debt" })).getAllByRole("listitem");
    expect(each[1]).toHaveTextContent(
      "Car loan (Car loan)Payment$311.38Paid off in5 years 0 monthsTotal interest$3,682.46",
    );
    const byType = within(screen.getByRole("list", { name: "By type" })).getAllByRole("listitem");
    expect(byType.map((li) => li.textContent)).toEqual([
      "Car loanBalance $15,000.00, interest $3,682.46",
      "Student loanBalance $20,000.00, interest $6,645.02",
      "Personal loanBalance $3,000.00, interest $126.58",
    ]);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows case V with the credit card and its notes under the card only", async () => {
    const fetchMock = mockApi({ "/api/debts": () => ({ json: caseV }) });
    render(<Harness initial={[...THREE_DEBTS, CARD]} />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("$863.69"));
    expect(card("Total interest")).toBe("$12,454.63");
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveAccessibleName("About this estimate for Credit card");
    expect(within(notes[0]!).getAllByRole("listitem")).toHaveLength(4);
    expect(notes[0]).toHaveTextContent(/No new purchases are added\./);
    const each = within(screen.getByRole("list", { name: "Each debt" })).getAllByRole("listitem");
    expect(each.find((li) => li.textContent?.startsWith("Credit card"))).toHaveTextContent(
      /Payment\$200\.00Paid off in3 years 0 months/,
    );
    const [sent] = sentBodies(fetchMock, "/api/debts") as { debts: Record<string, unknown>[] }[];
    expect(sent?.debts[3]).toMatchObject({ payment_mode: "fixed_payment", monthly_payment: "200" });
  });

  it("shows how much a too-small payment needs to be, from min_interest", async () => {
    mockApi({
      "/api/debts": () => ({
        status: 422,
        json: {
          errors: [
            {
              field: "debts[0].monthly_payment",
              message: "This payment doesn't cover the monthly interest.",
              min_interest: "100.00",
            },
          ],
        },
      }),
    });
    render(<Harness initial={[{ ...CARD, monthlyPayment: "100" }]} />);
    await waitFor(() => expect(paymentInput()).toHaveAttribute("aria-invalid", "true"));
    expect(paymentInput()).toHaveAccessibleDescription(
      /Error: This payment needs to be more than \$100\.00 to bring the balance down\.$/,
    );
  });

  it("leaves an incomplete debt out of the totals and says so", async () => {
    const fetchMock = mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={[...THREE_DEBTS, { ...EMPTY, name: "Phone plan" }]} />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("$663.69"));
    expect(screen.getByText("1 debt is incomplete and isn't included yet.")).toBeVisible();
    const sent = sentBodies(fetchMock, "/api/debts") as { debts: { id: string }[] }[];
    expect(sent.at(-1)?.debts.map((d) => d.id)).toEqual(["p1", "c1", "s1"]);
  });

  it("puts API errors on the right debt even when an earlier one is incomplete", async () => {
    mockApi({
      "/api/debts": () => ({
        status: 422,
        json: {
          errors: [{ field: "debts[1].annual_rate", message: "Rate must be below 1 (100%)." }],
        },
      }),
    });
    render(<Harness initial={[{ ...EMPTY, name: "Draft" }, ...THREE_DEBTS]} />);
    const rates = screen.getAllByRole("textbox", { name: "Interest rate (%) (required)" });
    await waitFor(() => expect(rates[2]).toHaveAttribute("aria-invalid", "true"));
    expect(rates[1]).not.toHaveAttribute("aria-invalid");
  });

  it("edits and deletes debts", () => {
    mockApi();
    render(<Harness initial={[THREE_DEBTS[0]!]} />);
    fireEvent.change(nameInput(), { target: { value: "Bank loan" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Bank loan" }));
    expect(screen.queryByRole("textbox", { name: "Name (required)" })).not.toBeInTheDocument();
  });
});
