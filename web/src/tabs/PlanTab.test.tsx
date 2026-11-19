import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Currency } from "../lib/format";
import type { DebtInput, PlanInput } from "../lib/storage";
import { THREE_DEBTS } from "../test/debts";
import caseM from "../test/fixtures/compare-case-m.json";
import { mockApi, sentBodies } from "../test/mockApi";
import { PlanTab } from "./PlanTab";

afterEach(() => vi.unstubAllGlobals());

function Harness({
  debts = THREE_DEBTS,
  extra = "300",
  currency = "USD",
}: {
  debts?: DebtInput[];
  extra?: string;
  currency?: Currency;
}) {
  const [plan, setPlan] = useState<PlanInput>({ extra });
  return (
    <PlanTab
      debts={debts}
      plan={plan}
      onChange={setPlan}
      currency={currency}
      disclaimer="Disclaimer text"
    />
  );
}

function cell(row: string, column: "Avalanche" | "Snowball"): string {
  const table = screen.getByRole("table");
  const header = within(table).getByRole("rowheader", { name: row });
  const cells = within(header.closest("tr")!).getAllByRole("cell");
  return (column === "Avalanche" ? cells[0] : cells[1])?.textContent ?? "";
}

describe("PlanTab", () => {
  it("asks for debts first and links to the Debts tab", () => {
    const fetchMock = mockApi();
    render(<Harness debts={[]} />);
    expect(screen.getByText(/Add your debts first/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the Debts tab" })).toHaveAttribute(
      "href",
      "#debts",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows cases K and L side by side exactly as the API returns them", async () => {
    const fetchMock = mockApi({ "/api/strategies/compare": () => ({ json: caseM }) });
    render(<Harness />);

    await waitFor(() => expect(cell("Total interest", "Avalanche")).toBe("$5,004.74"));
    expect(cell("Total interest", "Snowball")).toBe("$5,137.11");
    expect(cell("Debt-free in", "Avalanche")).toBe("3 years 9 months");
    expect(cell("Debt-free in", "Snowball")).toBe("3 years 9 months");
    expect(cell("Interest saved", "Avalanche")).toBe("$5,449.32");
    expect(cell("Interest saved", "Snowball")).toBe("$5,316.95");
    expect(cell("Time saved", "Avalanche")).toBe("6 years 3 months");
    expect(cell("First debt paid off", "Avalanche")).toBe("Month 24");
    expect(cell("First debt paid off", "Snowball")).toBe("Month 8");

    const avalancheOrder = screen.getByRole("list", { name: "avalanche payoff order" });
    expect(within(avalancheOrder).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Personal loan, month 24",
      "Car loan, month 27",
      "Student loan, month 45",
    ]);
    const snowballOrder = screen.getByRole("list", { name: "snowball payoff order" });
    expect(within(snowballOrder).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Personal loan, month 8",
      "Car loan, month 27",
      "Student loan, month 45",
    ]);

    expect(screen.getByText(/debt-free in 10 years 0 months, total interest \$10,454\.06/)).toBeVisible();
    const differences = within(screen.getByRole("list", { name: "Differences" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(differences).toEqual([
      "Avalanche costs $132.37 less in interest.",
      "Both are debt-free in the same month.",
      "Snowball pays off its first debt 1 year 4 months sooner.",
    ]);

    expect(sentBodies(fetchMock, "/api/strategies/compare")).toEqual([
      {
        debts: [
          {
            id: "p1",
            name: "Personal loan",
            category: "personal",
            principal: "3000",
            annual_rate: "0.04",
            term_months: 24,
          },
          {
            id: "c1",
            name: "Car loan",
            category: "auto",
            principal: "15000",
            annual_rate: "0.09",
            term_months: 60,
          },
          {
            id: "s1",
            name: "Student loan",
            category: "student",
            principal: "20000",
            annual_rate: "0.06",
            term_months: 120,
          },
        ],
        extra_monthly: "300",
      },
    ]);
  });

  it("explains each strategy in neutral words", async () => {
    mockApi({ "/api/strategies/compare": () => ({ json: caseM }) });
    const { container } = render(<Harness />);
    expect(
      screen.getByText("Pays the highest interest rate first. Usually costs the least interest."),
    ).toBeVisible();
    expect(
      screen.getByText("Pays the smallest balance first. Clears your first debt sooner."),
    ).toBeVisible();
    await screen.findByRole("table");
    expect(container.textContent).not.toMatch(/\b(best|smart|right)\b/i);
  });

  it("charts three lines: no extra, avalanche and snowball", async () => {
    mockApi({ "/api/strategies/compare": () => ({ json: caseM }) });
    render(<Harness />);
    await screen.findByRole("table");
    expect(screen.getByText(/No extra money \(balance reaches 0 in month 120\)/)).toBeVisible();
    expect(screen.getByText(/Avalanche \(balance reaches 0 in month 45\)/)).toBeVisible();
    expect(screen.getByText(/Snowball \(balance reaches 0 in month 45\)/)).toBeVisible();
  });

  it("formats values for UGX", async () => {
    mockApi({ "/api/strategies/compare": () => ({ json: caseM }) });
    render(<Harness currency="UGX" />);
    await waitFor(() => expect(cell("Total interest", "Avalanche")).toBe("UGX 5,005"));
  });

  it("sends 0 when the extra amount is left empty", async () => {
    const fetchMock = mockApi({ "/api/strategies/compare": () => ({ json: caseM }) });
    render(<Harness extra="" />);
    await screen.findByRole("table");
    const [sent] = sentBodies(fetchMock, "/api/strategies/compare") as { extra_monthly: string }[];
    expect(sent?.extra_monthly).toBe("0");
  });

  it("shows a format error on the extra amount without calling the API", () => {
    const fetchMock = mockApi();
    render(<Harness extra="abc" />);
    fireEvent.change(screen.getByLabelText("Extra money per month"), {
      target: { value: "12.345" },
    });
    expect(screen.getByLabelText("Extra money per month")).toHaveAccessibleDescription(
      /amount like/,
    );
    expect(sentBodies(fetchMock, "/api/strategies/compare")).toHaveLength(0);
  });

  it("points to the Debts tab when a debt is incomplete", () => {
    mockApi();
    render(<Harness debts={[{ ...THREE_DEBTS[0]!, balance: "" }]} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Some debts are missing details/);
    expect(screen.getByRole("link", { name: "Debts tab" })).toHaveAttribute("href", "#debts");
  });
});
