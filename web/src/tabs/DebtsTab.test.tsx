import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../api";
import { buildDebts, termAfterCategoryChange } from "../lib/debtRequest";
import type { Currency } from "../lib/format";
import type { DebtInput } from "../lib/storage";
import caseG from "../test/fixtures/debts-case-g.json";
import metaFixture from "../test/fixtures/meta.json";
import { THREE_DEBTS } from "../test/debts";
import { mockApi, sentBodies } from "../test/mockApi";
import { DebtsTab } from "./DebtsTab";

const meta = metaFixture as Meta;

afterEach(() => vi.unstubAllGlobals());


function Harness({ initial = [], currency = "USD" }: { initial?: DebtInput[]; currency?: Currency }) {
  const [debts, setDebts] = useState(initial);
  return (
    <DebtsTab
      debts={debts}
      onChange={setDebts}
      currency={currency}
      meta={meta}
      disclaimer="Disclaimer text"
    />
  );
}

function card(label: string): string {
  const summary = screen.getByLabelText("Combined summary");
  return within(summary).getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
}

describe("buildDebts", () => {
  it("builds the API request with rates as fractions", () => {
    expect(buildDebts(THREE_DEBTS).debts?.[0]).toEqual({
      id: "p1",
      name: "Personal loan",
      category: "personal",
      principal: "3000",
      annual_rate: "0.04",
      term_months: 24,
    });
  });

  it("waits for every required field", () => {
    expect(buildDebts([{ ...THREE_DEBTS[0]!, category: "" }]).debts).toBeNull();
    expect(buildDebts([]).debts).toBeNull();
  });
});

describe("category pre-fill", () => {
  it("fills the suggested term only when the term is empty", () => {
    expect(termAfterCategoryChange("", 60)).toBe("60");
    expect(termAfterCategoryChange("48", 60)).toBe("48");
    expect(termAfterCategoryChange(" 7 ", 360)).toBe(" 7 ");
    expect(termAfterCategoryChange("", null)).toBe("");
  });

  it("never overwrites a typed term in the form", () => {
    mockApi();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));
    const term = screen.getByLabelText("Months left");
    const category = screen.getByLabelText("Category");

    fireEvent.change(category, { target: { value: "auto" } });
    expect(term).toHaveValue("60");

    fireEvent.change(term, { target: { value: "48" } });
    fireEvent.change(category, { target: { value: "mortgage" } });
    expect(term).toHaveValue("48");

    fireEvent.change(term, { target: { value: "" } });
    fireEvent.change(category, { target: { value: "other" } });
    expect(term).toHaveValue("");
  });

  it("doesn't offer credit cards", () => {
    mockApi();
    render(<Harness initial={[THREE_DEBTS[0]!]} />);
    const options = within(screen.getByLabelText("Category")).getAllByRole("option");
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

describe("DebtsTab", () => {
  it("shows case G exactly as the API returns it", async () => {
    const fetchMock = mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={THREE_DEBTS} />);

    await waitFor(() => expect(card("Total monthly payment")).toBe("$663.69"));
    expect(card("Total interest")).toBe("$10,454.06");
    expect(card("Debt-free in")).toBe("10 years 0 months");

    const each = within(screen.getByRole("list", { name: "Each debt" })).getAllByRole("listitem");
    expect(each[0]).toHaveTextContent("Personal loan (Personal loan)Payment$130.27Paid off in2 years 0 monthsTotal interest$126.58");
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
  });

  it("formats the same values for UGX", async () => {
    mockApi({ "/api/debts": () => ({ json: caseG }) });
    render(<Harness initial={THREE_DEBTS} currency="UGX" />);
    await waitFor(() => expect(card("Total monthly payment")).toBe("UGX 664"));
    expect(card("Total interest")).toBe("UGX 10,454");
  });

  it("puts API errors next to the right debt's field", async () => {
    mockApi({
      "/api/debts": () => ({
        status: 422,
        json: { errors: [{ field: "debts[1].annual_rate", message: "Rate must be below 1 (100%)." }] },
      }),
    });
    render(<Harness initial={THREE_DEBTS} />);
    const rates = screen.getAllByLabelText("Rate (%)");
    await waitFor(() => expect(rates[1]).toHaveAttribute("aria-invalid", "true"));
    expect(rates[1]).toHaveAccessibleDescription(/Rate must be below 1/);
    expect(rates[0]).not.toHaveAttribute("aria-invalid");
  });

  it("adds, edits and deletes debts", () => {
    mockApi();
    render(<Harness initial={[THREE_DEBTS[0]!]} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bank loan" } });
    expect(screen.getByRole("group", { name: "Bank loan" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a debt" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete Bank loan" }));
    expect(screen.getAllByLabelText("Name")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Debt 1" })).toBeInTheDocument();
  });
});
