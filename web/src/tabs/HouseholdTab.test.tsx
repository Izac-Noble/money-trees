import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../api";
import { buildHousehold } from "../lib/householdRequest";
import { emptyData, type AppData, type HouseholdInput } from "../lib/storage";
import { THREE_DEBTS } from "../test/debts";
import householdH2 from "../test/fixtures/household-h2.json";
import metaFixture from "../test/fixtures/meta.json";
import { mockApi, sentBodies } from "../test/mockApi";
import { DebtsTab } from "./DebtsTab";
import { HouseholdTab } from "./HouseholdTab";

const meta = metaFixture as Meta;

afterEach(() => vi.unstubAllGlobals());

let latest: AppData = emptyData();

function Harness({ initial }: { initial: AppData }) {
  const [data, setData] = useState(initial);
  latest = data;
  return (
    <>
      <HouseholdTab data={data} onChange={setData} currency="USD" meta={meta} />
      <button type="button" onClick={() => setData((d) => ({ ...d, debts: [THREE_DEBTS[1]!] }))}>
        Test: add car loan
      </button>
      <button type="button" onClick={() => setData((d) => ({ ...d, debts: [] }))}>
        Test: remove debts
      </button>
    </>
  );
}

function withHousehold(patch: Partial<HouseholdInput>, extra: Partial<AppData> = {}): AppData {
  const data = emptyData();
  return { ...data, ...extra, household: { ...data.household, ...patch } };
}

const COUPLE = withHousehold({ kind: "couple", names: ["Sam", "Alex"] });

describe("setup", () => {
  it("asks who it's for, with one name for Just me and two for Couple", () => {
    mockApi();
    render(<Harness initial={emptyData()} />);
    const group = screen.getByRole("group", { name: "Who's this for?" });
    expect(within(group).getByRole("button", { name: "Just me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Your first name (required)" })).toBeVisible();
    fireEvent.click(within(group).getByRole("button", { name: "Couple" }));
    expect(screen.getByRole("textbox", { name: "First person's first name (required)" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Second person's first name (required)" })).toBeVisible();
  });

  it("asks before switching Couple to Just me when partner or joint items exist", () => {
    mockApi();
    const initial = withHousehold({
      kind: "couple",
      names: ["Sam", "Alex"],
      assets: [{ key: "a", type: "cash", label: "", value: "4000", owner: "joint" }],
    });
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Just me" }));
    const dialog = screen.getByRole("dialog", { name: "Switch to Just me?" });
    expect(dialog).toHaveTextContent("belong to Alex or are joint");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(latest.household.kind).toBe("couple");
    expect(latest.household.assets[0]!.owner).toBe("joint");

    fireEvent.click(screen.getByRole("button", { name: "Just me" }));
    fireEvent.click(screen.getByRole("button", { name: "Move everything to Sam" }));
    expect(latest.household.kind).toBe("single");
    expect(latest.household.assets[0]!.owner).toBe("p1");
  });

  it("switches Couple to Just me without asking when nothing is shared", () => {
    mockApi();
    render(<Harness initial={COUPLE} />);
    fireEvent.click(screen.getByRole("button", { name: "Just me" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(latest.household.kind).toBe("single");
  });
});

describe("owner picker", () => {
  it("is hidden for Just me", () => {
    mockApi();
    render(<Harness initial={emptyData()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add income" }));
    expect(screen.queryByLabelText(/^Whose\?/)).not.toBeInTheDocument();
  });

  it("shows for couples with first names and Joint, and the right defaults", () => {
    mockApi();
    render(<Harness initial={COUPLE} />);
    fireEvent.click(screen.getByRole("button", { name: "Add income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add something you own" }));
    fireEvent.click(screen.getByRole("button", { name: "Add your own" }));
    const income = screen.getByLabelText("Whose? (Income 1)") as HTMLSelectElement;
    expect([...income.options].map((o) => o.textContent)).toEqual(["Sam", "Alex", "Joint"]);
    expect(income.value).toBe("p1");
    expect((screen.getByLabelText("Whose? (Groceries)") as HTMLSelectElement).value).toBe("joint");
    expect((screen.getByLabelText("Whose? (Checking and savings 1)") as HTMLSelectElement).value).toBe(
      "joint",
    );
    expect((screen.getByLabelText("Whose? (Your own expense 1)") as HTMLSelectElement).value).toBe(
      "joint",
    );
  });

  it("appears on each debt on the Debts tab for couples only", () => {
    mockApi();
    const { rerender } = render(
      <DebtsTab
        debts={[THREE_DEBTS[0]!]}
        onChange={() => {}}
        termUnit="years"
        onTermUnitChange={() => {}}
        currency="USD"
        meta={meta}
        disclaimer=""
        household={{ kind: "couple", names: ["Sam", "Alex"] }}
      />,
    );
    expect(screen.getByLabelText("Whose? (Personal loan)")).toBeVisible();
    rerender(
      <DebtsTab
        debts={[THREE_DEBTS[0]!]}
        onChange={() => {}}
        termUnit="years"
        onTermUnitChange={() => {}}
        currency="USD"
        meta={meta}
        disclaimer=""
        household={{ kind: "single", names: ["Sam", ""] }}
      />,
    );
    expect(screen.queryByLabelText(/^Whose\?/)).not.toBeInTheDocument();
  });
});

describe("expenses", () => {
  it("lists the ready-made rows by group", () => {
    mockApi();
    render(<Harness initial={emptyData()} />);
    const groups = screen.getAllByRole("group").map((g) => g.querySelector("legend")?.textContent);
    expect(groups.filter(Boolean)).toEqual([
      "Housing",
      "Debt payments",
      "Bills",
      "Everyday",
      "Giving",
      "Saving",
      "Your own",
    ]);
    // Mortgage and other debt rows only appear when such debts exist.
    expect(screen.queryByRole("textbox", { name: "Mortgage" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Other debt payments" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Car payment" })).toBeVisible();
  });

  it("treats a blank row as none, and shows red only for an invalid value", () => {
    mockApi();
    render(<Harness initial={emptyData()} />);
    const phone = screen.getByRole("textbox", { name: "Phone bill" });
    fireEvent.blur(phone);
    expect(phone).not.toHaveAttribute("aria-invalid");
    fireEvent.change(phone, { target: { value: "-5" } });
    fireEvent.blur(phone);
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/Error:/);
  });

  it("switches a debt payment row to read-only when a matching debt is added, and back", async () => {
    mockApi({ "/api/household": () => ({ json: householdH2 }) });
    render(<Harness initial={withHousehold({ names: ["Jordan", ""] })} />);
    expect(screen.getByRole("textbox", { name: "Car payment" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Test: add car loan" }));
    expect(screen.queryByRole("textbox", { name: "Car payment" })).not.toBeInTheDocument();
    const row = screen.getByRole("listitem", { name: "Car payment" });
    expect(row).toHaveTextContent("From your Debts tab.");
    expect(within(row).getByRole("link", { name: "Go to Debts" })).toHaveAttribute("href", "#debts");
    await waitFor(() => expect(row).toHaveTextContent("Car loan: $311.38 a month"));

    fireEvent.click(screen.getByRole("button", { name: "Test: remove debts" }));
    expect(screen.getByRole("textbox", { name: "Car payment" })).toBeVisible();
  });

  it("adds a custom row with a label", () => {
    mockApi();
    render(<Harness initial={emptyData()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add your own" }));
    expect(screen.getByRole("textbox", { name: "What it's for" })).toBeVisible();
  });
});

describe("income and assets", () => {
  it("shows each income's monthly amount from the API", async () => {
    const fetchMock = mockApi({ "/api/household": () => ({ json: householdH2 }) });
    const initial = withHousehold({
      kind: "couple",
      names: ["Sam", "Alex"],
      incomes: [{ key: "i1", label: "Sam's job", amount: "2000", frequency: "biweekly", owner: "p1" }],
    });
    render(<Harness initial={initial} />);
    expect(screen.getByText("Take-home pay: what actually lands in your account.")).toBeVisible();
    expect(await screen.findByText("= $4,333.33 a month")).toBeVisible();
    const [sent] = sentBodies(fetchMock, "/api/household") as { incomes: unknown[] }[];
    expect(sent?.incomes).toEqual([
      { id: "i1", label: "Sam's job", owner: "p1", amount: "2000", frequency: "biweekly" },
    ]);
  });

  it("explains the emergency fund asset", () => {
    mockApi();
    render(
      <Harness
        initial={withHousehold({
          assets: [{ key: "a", type: "emergency_fund", label: "", value: "", owner: "p1" }],
        })}
      />,
    );
    expect(
      screen.getByText("The amount saved so far. Your monthly contribution goes under Expenses."),
    ).toBeVisible();
  });
});

describe("buildHousehold", () => {
  it("sends p1 for every owner in a single household and skips blank rows", () => {
    const data = withHousehold(
      {
        names: ["Jordan", ""],
        incomes: [
          { key: "i", label: "Pay", amount: "1500", frequency: "biweekly", owner: "joint" },
          { key: "blank", label: "", amount: "", frequency: "monthly", owner: "p1" },
        ],
        expenses: {
          housing: { amount: "1400", frequency: "monthly", owner: "joint" },
          phone: { amount: "", frequency: "monthly", owner: "joint" },
        },
      },
      { debts: [{ ...THREE_DEBTS[1]!, owner: "joint" }] },
    );
    const built = buildHousehold(data, meta);
    expect(built.request?.people).toEqual([{ id: "p1", name: "Jordan" }]);
    expect(built.request?.incomes.map((i) => i.owner)).toEqual(["p1"]);
    expect(built.request?.expenses).toEqual([
      { id: "expense-housing", category: "housing", owner: "p1", amount: "1400", frequency: "monthly" },
    ]);
    expect(built.request?.debts[0]).toMatchObject({ id: "c1", owner: "p1" });
    expect(built.fromDebts).toEqual(new Set(["car_payment"]));
  });

  it("waits for names before sending anything", () => {
    expect(buildHousehold(COUPLE, meta).request).not.toBeNull();
    expect(buildHousehold(withHousehold({ kind: "couple", names: ["Sam", ""] }), meta).request).toBeNull();
  });
});
