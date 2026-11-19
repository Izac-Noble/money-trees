import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Currency } from "../lib/format";
import { emptyData, type LoanInput } from "../lib/storage";
import caseB from "../test/fixtures/amortization-case-b.json";
import caseE from "../test/fixtures/amortization-case-e.json";
import { mockApi, sentBodies } from "../test/mockApi";
import { buildLoanRequest } from "../lib/loanRequest";
import { LoanTab } from "./LoanTab";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function Harness({ initial, currency = "USD" }: { initial?: Partial<LoanInput>; currency?: Currency }) {
  const [loan, setLoan] = useState<LoanInput>({ ...emptyData().loan, ...initial });
  return <LoanTab loan={loan} onChange={setLoan} currency={currency} disclaimer="Disclaimer text" />;
}

const CASE_B_FORM: Partial<LoanInput> = {
  amount: "200000",
  ratePercent: "6",
  term: "30",
  termUnit: "years",
};

function card(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

describe("buildLoanRequest", () => {
  it("converts the form into an API request without float math", () => {
    const built = buildLoanRequest({
      ...emptyData().loan,
      amount: "250,000",
      ratePercent: "6.5",
      term: "30",
      termUnit: "years",
      lumpSums: [{ key: "a", month: "12", amount: "10000" }],
    });
    expect(built.request).toEqual({
      principal: "250000",
      annual_rate: "0.065",
      term_months: 360,
      extra_monthly: "0",
      lump_sums: [{ month: 12, amount: "10000" }],
    });
  });

  it("waits until required fields are filled", () => {
    expect(buildLoanRequest({ ...emptyData().loan, amount: "1000" }).request).toBeNull();
  });

  it("flags badly formatted input by API field name", () => {
    const built = buildLoanRequest({ ...CASE_B_FORM, ...emptyData().loan, amount: "12.345" });
    expect(built.errors.principal).toMatch(/amount like/);
  });
});

describe("LoanTab", () => {
  it("shows case B exactly as the API returns it", async () => {
    const fetchMock = mockApi({ "/api/amortization": () => ({ json: caseB }) });
    render(<Harness initial={CASE_B_FORM} />);

    await waitFor(() => expect(card("Monthly payment")).toBe("$1,199.10"));
    expect(card("Payoff time")).toBe("30 years 0 months");
    expect(card("Total interest")).toBe("$231,677.04");
    expect(card("Total paid")).toBe("$431,677.04");
    expect(screen.queryByText("Interest saved")).not.toBeInTheDocument();
    expect(sentBodies(fetchMock, "/api/amortization")).toEqual([
      {
        principal: "200000",
        annual_rate: "0.06",
        term_months: 360,
        extra_monthly: "0",
        lump_sums: [],
      },
    ]);

    const table = screen.getByRole("table");
    const firstRow = within(table).getAllByRole("row")[1]!;
    expect(firstRow).toHaveTextContent("1$1,199.10$1,000.00$199.10$0.00$199,800.90");
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    fireEvent.click(screen.getByRole("button", { name: "Show all months (360)" }));
    expect(within(table).getAllByRole("row")).toHaveLength(361);
    const phoneList = screen.getByRole("list", { name: "Payment schedule by month" });
    expect(within(phoneList).getAllByRole("listitem")).toHaveLength(360);
    expect(within(phoneList).getAllByRole("listitem")[0]).toHaveTextContent(
      "Month 1Payment$1,199.10Interest$1,000.00Principal$199.10Extra$0.00Balance$199,800.90",
    );
  });

  it("shows savings and two chart lines when extras are used", async () => {
    const fetchMock = mockApi({
      "/api/amortization": (body) => ({
        json: (body as { extra_monthly: string }).extra_monthly === "200" ? caseE : caseB,
      }),
    });
    render(<Harness initial={{ ...CASE_B_FORM, extra: "200" }} />);

    await waitFor(() => expect(card("Interest saved")).toBe("$79,800.86"));
    expect(card("Time saved")).toBe("9 years 0 months");
    expect(card("Payoff time")).toBe("21 years 0 months");
    expect(card("Total interest")).toBe("$151,876.18");
    expect(screen.getByText(/With extra payments \(balance reaches 0 in month 252\)/)).toBeVisible();
    expect(screen.getByText(/Without extra payments \(balance reaches 0 in month 360\)/)).toBeVisible();
    const sent = sentBodies(fetchMock, "/api/amortization") as { extra_monthly: string }[];
    expect(sent.map((b) => b.extra_monthly).sort()).toEqual(["0", "200"]);
  });

  it("waits about 300 ms after typing stops before calling the API", async () => {
    vi.useFakeTimers();
    const fetchMock = mockApi({ "/api/amortization": () => ({ json: caseB }) });
    render(<Harness initial={{ ...CASE_B_FORM, amount: "" }} />);
    const amount = screen.getByLabelText(/^Loan amount/);
    for (const value of ["2", "20", "200000"]) {
      fireEvent.change(amount, { target: { value } });
      vi.advanceTimersByTime(100);
    }
    expect(sentBodies(fetchMock, "/api/amortization")).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const sent = sentBodies(fetchMock, "/api/amortization") as { principal: string }[];
    expect(sent.map((b) => b.principal)).toEqual(["200000"]);
  });

  it("puts API errors next to the matching field", async () => {
    mockApi({
      "/api/amortization": () => ({
        status: 422,
        json: {
          errors: [
            { field: "annual_rate", message: "Rate must be below 1 (100%)." },
            { field: "lump_sums[0].month", message: "Month must be within the term (1 to 360)." },
          ],
        },
      }),
    });
    render(
      <Harness
        initial={{
          ...CASE_B_FORM,
          ratePercent: "150",
          lumpSums: [{ key: "x", month: "400", amount: "5" }],
        }}
      />,
    );
    const rate = screen.getByLabelText(/^Interest rate \(%\)/);
    await waitFor(() => expect(rate).toHaveAttribute("aria-invalid", "true"));
    expect(rate).toHaveAccessibleDescription(/Rate must be below 1 \(100%\)\./);
    expect(screen.getByLabelText("Month, lump sum 1")).toHaveAccessibleDescription(
      /Month must be within the term/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/Some details need fixing/);
  });

  it("shows no errors on a new, empty form", () => {
    mockApi();
    render(<Harness />);
    expect(screen.queryByText(/Error:/)).not.toBeInTheDocument();
    for (const input of screen.getAllByRole("textbox")) {
      expect(input).not.toHaveAttribute("aria-invalid");
    }
  });

  it("marks required fields up front", () => {
    mockApi();
    render(<Harness />);
    expect(screen.getByLabelText(/^Loan amount/)).toHaveAccessibleName("Loan amount (required)");
    expect(screen.getByLabelText(/^Loan amount/)).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("textbox", { name: "Term (required)" })).toHaveAttribute("aria-required", "true");
  });

  it("doesn't show an error while typing for the first time", () => {
    mockApi();
    render(<Harness />);
    const amount = screen.getByLabelText(/^Loan amount/);
    fireEvent.change(amount, { target: { value: "12.345" } });
    expect(amount).not.toHaveAttribute("aria-invalid");
  });

  it("shows a missing field's error after leaving it, then clears it while typing", () => {
    mockApi();
    render(<Harness />);
    const amount = screen.getByLabelText(/^Loan amount/);
    fireEvent.blur(amount);
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("Error: Enter the loan amount.");

    fireEvent.change(amount, { target: { value: "12.345" } });
    expect(amount).toHaveAccessibleDescription(/Enter an amount like/);
    fireEvent.change(amount, { target: { value: "1000" } });
    expect(amount).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/Enter the loan amount/)).not.toBeInTheDocument();
    // Other fields the user never left stay quiet.
    expect(screen.getByLabelText(/^Interest rate/)).not.toHaveAttribute("aria-invalid");
  });

  it("shows the term conversion and switches units with the toggle", async () => {
    const fetchMock = mockApi({ "/api/amortization": () => ({ json: caseB }) });
    render(<Harness initial={{ ...CASE_B_FORM, term: "4" }} />);
    const term = screen.getByRole("textbox", { name: "Term (required)" });
    expect(term).toHaveAccessibleDescription("= 48 months");
    const years = screen.getByRole("button", { name: "Years" });
    const months = screen.getByRole("button", { name: "Months" });
    expect(years).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(term, { target: { value: "4.5" } });
    fireEvent.blur(term);
    expect(term).toHaveAccessibleDescription(
      "Error: Use whole years, or switch to Months for anything in between.",
    );
    fireEvent.click(months);
    expect(months).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(term, { target: { value: "54" } });
    expect(term).toHaveAccessibleDescription("= 4 years 6 months");
    await waitFor(() =>
      expect(
        (sentBodies(fetchMock, "/api/amortization") as { term_months: number }[]).map(
          (b) => b.term_months,
        ),
      ).toContain(54),
    );
  });

  it("keeps a new lump sum row quiet until a field is left", () => {
    mockApi();
    render(<Harness initial={CASE_B_FORM} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a lump sum" }));
    const month = screen.getByLabelText("Month, lump sum 1");
    expect(month).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(month);
    expect(month).toHaveAccessibleDescription("Error: Enter the month for this lump sum.");
    expect(screen.getByLabelText("Amount, lump sum 1")).not.toHaveAttribute("aria-invalid");
  });

  it("adds and removes lump sum rows", () => {
    mockApi();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Add a lump sum" }));
    expect(screen.getByLabelText("Amount, lump sum 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove lump sum 1" }));
    expect(screen.queryByLabelText("Amount, lump sum 1")).not.toBeInTheDocument();
  });
});
