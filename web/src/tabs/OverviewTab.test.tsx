import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../api";
import { emptyData, type AppData } from "../lib/storage";
import { THREE_DEBTS } from "../test/debts";
import householdH2 from "../test/fixtures/household-h2.json";
import householdH4 from "../test/fixtures/household-h4.json";
import metaFixture from "../test/fixtures/meta.json";
import { mockApi } from "../test/mockApi";
import { OverviewTab } from "./OverviewTab";

const meta = metaFixture as Meta;
const WAIT = { timeout: 4000 };

afterEach(() => vi.unstubAllGlobals());

function couple(withDebts = true): AppData {
  const data = emptyData();
  data.household = {
    ...data.household,
    kind: "couple",
    names: ["Sam", "Alex"],
    incomes: [{ key: "i1", label: "Sam's job", amount: "2000", frequency: "biweekly", owner: "p1" }],
  };
  if (withDebts) data.debts = [THREE_DEBTS[1]!];
  return data;
}

function single(): AppData {
  const data = emptyData();
  data.household = {
    ...data.household,
    names: ["Jordan", ""],
    incomes: [{ key: "i1", label: "Pay", amount: "1500", frequency: "biweekly", owner: "p1" }],
  };
  return data;
}

function renderOverview(data: AppData) {
  const onGoTo = vi.fn();
  const onSeePayoffPlan = vi.fn();
  render(
    <OverviewTab
      data={data}
      currency="USD"
      meta={meta}
      disclaimer="Disclaimer text"
      onGoTo={onGoTo}
      onSeePayoffPlan={onSeePayoffPlan}
    />,
  );
  return { onGoTo, onSeePayoffPlan };
}

function card(group: string, label: string): string {
  const dl = screen.getByLabelText(group);
  return within(dl).getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";
}

describe("OverviewTab", () => {
  it("welcomes a new user and points to the Household tab", () => {
    const fetchMock = mockApi();
    const { onGoTo } = renderOverview(emptyData());
    expect(screen.getByRole("heading", { name: "Welcome to Money Trees" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start with your household" }));
    expect(onGoTo).toHaveBeenCalledWith("household");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/household", expect.anything());
  });

  it("shows case H2 exactly as the API returns it", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    renderOverview(couple());
    await waitFor(() => expect(card("Monthly totals", "Take-home pay")).toBe("$8,583.33"), WAIT);
    expect(card("Monthly totals", "Spending")).toBe("$3,770.00");
    expect(card("Monthly totals", "Debt payments")).toBe("$863.69");
    expect(card("Monthly totals", "Saving")).toBe("$300.00");
    expect(card("Monthly totals", "Left over")).toBe("$3,649.64");

    const ratios = screen.getAllByRole("listitem").filter((li) => li.closest("section[aria-labelledby='ratios-heading']"));
    expect(ratios.map((li) => li.querySelector("p:nth-child(2)")?.textContent)).toEqual([
      "10.1%",
      "17.5%",
      "3.5%",
      "1.3 months",
    ]);
    expect(screen.getByText("The share of your take-home pay that goes to debt payments.")).toBeVisible();

    expect(card("Net worth totals", "Total assets")).toBe("$53,000.00");
    expect(card("Net worth totals", "Debts owed")).toBe("$43,000.00");
    expect(card("Net worth totals", "Net worth")).toBe("$10,000.00");
    expect(card("Net worth totals", "Liquid assets")).toBe("$10,000.00");
    expect(
      screen.getByText(
        "Liquid assets are what you could reach quickly: cash, emergency fund and investments.",
      ),
    ).toBeVisible();

    const notes = screen.getByRole("note", { name: "Notes" });
    expect(within(notes).getAllByRole("listitem")).toHaveLength(2);
    expect(notes).toHaveTextContent(/Income is take-home pay/);
  });

  it("charts spending by group, largest first", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    renderOverview(couple());
    const chart = await screen.findByRole("list", { name: "Spending by group, largest first" }, WAIT);
    expect(within(chart).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Housing$1,500.00",
      "Everyday$1,300.00",
      "Debt payments$863.69",
      "Bills$570.00",
      "Giving$400.00",
      "Saving$300.00",
    ]);
  });

  it("switches between Household, each first name and Joint for couples", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    renderOverview(couple());
    const switcher = await screen.findByRole("group", { name: "Show numbers for" }, WAIT);
    expect(within(switcher).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Household",
      "Sam",
      "Alex",
      "Joint",
    ]);
    fireEvent.click(within(switcher).getByRole("button", { name: "Sam" }));
    expect(card("Numbers for Sam", "Take-home pay")).toBe("$4,333.33");
    expect(card("Numbers for Sam", "Debt payments")).toBe("$330.27");
    expect(card("Numbers for Sam", "Debts owed")).toBe("$8,000.00");
    expect(card("Numbers for Sam", "Assets")).toBe("$15,000.00");
    fireEvent.click(within(switcher).getByRole("button", { name: "Joint" }));
    expect(card("Numbers for Joint", "Take-home pay")).toBe("$0.00");
    expect(card("Numbers for Joint", "Debt payments")).toBe("$311.38");
    expect(card("Numbers for Joint", "Assets")).toBe("$28,000.00");
    fireEvent.click(within(switcher).getByRole("button", { name: "Alex" }));
    expect(card("Numbers for Alex", "Take-home pay")).toBe("$4,250.00");
  });

  it("shows case H4's negative left over neutrally, with its notes", async () => {
    mockApi({ "/api/household": () => ({ json: householdH4 }) });
    renderOverview(single());
    await waitFor(() => expect(card("Monthly totals", "Left over")).toBe("-$40.00"), WAIT);
    expect(
      screen.getByText("You're spending $40.00 more than you bring in each month."),
    ).toBeVisible();
    expect(screen.queryByRole("group", { name: "Show numbers for" })).not.toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Notes" })).toHaveTextContent(
      /entered only as a monthly payment/,
    );
    expect(screen.queryByText(/See what it could do/)).not.toBeInTheDocument();
  });

  it("invites a look at the Payoff Plan when money is left over and debts exist", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    const { onSeePayoffPlan } = renderOverview(couple());
    const link = await screen.findByRole("button", { name: "See what it could do on the Payoff Plan." }, WAIT);
    expect(screen.getByText(/You have \$3,649\.64 left each month\./)).toBeVisible();
    fireEvent.click(link);
    expect(onSeePayoffPlan).toHaveBeenCalledWith("3649.64");
  });

  it("doesn't show the Payoff Plan link without debts", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    renderOverview(couple(false));
    await waitFor(() => expect(card("Monthly totals", "Left over")).toBe("$3,649.64"), WAIT);
    expect(screen.queryByText(/See what it could do/)).not.toBeInTheDocument();
  });

  it("asks for names before showing anything", () => {
    mockApi();
    const data = couple();
    data.household.names = ["Sam", ""];
    renderOverview(data);
    expect(screen.getByText(/Add both first names on the/)).toBeVisible();
  });
});
