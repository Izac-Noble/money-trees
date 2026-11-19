import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { STORAGE_KEY, emptyData, loadData, toSaved, type AppData } from "./lib/storage";
import { mockApi } from "./test/mockApi";

const DISCLAIMER = "Estimates for learning and planning, not financial advice.";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function savedData(): AppData {
  const data = emptyData();
  data.loan = { ...data.loan, amount: "5000", ratePercent: "5", term: "2" };
  return data;
}

function fileWith(content: string): File {
  return new File([content], "export.json", { type: "application/json" });
}

async function chooseFile(content: string) {
  const input = screen.getByLabelText("Choose a Money Trees export file");
  fireEvent.change(input, { target: { files: [fileWith(content)] } });
}

describe("App shell", () => {
  it("shows three tabs and the disclaimer from /api/meta", async () => {
    mockApi();
    render(<App />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Loan",
      "Debts",
      "Payoff Plan",
    ]);
    expect(await screen.findByRole("contentinfo")).toHaveTextContent(DISCLAIMER);
    expect(fetch).toHaveBeenCalledWith("/api/meta", expect.anything());
  });

  it("keeps the current tab in the URL hash", () => {
    mockApi();
    window.history.replaceState(null, "", "/#debts");
    render(<App />);
    expect(screen.getByRole("tab", { name: "Debts" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Payoff Plan" }));
    expect(window.location.hash).toBe("#plan");
  });

  it("moves between tabs with the arrow keys", () => {
    mockApi();
    render(<App />);
    const loan = screen.getByRole("tab", { name: "Loan" });
    fireEvent.keyDown(loan, { key: "ArrowRight" });
    const debts = screen.getByRole("tab", { name: "Debts" });
    expect(debts).toHaveAttribute("aria-selected", "true");
    expect(debts).toHaveFocus();
    fireEvent.keyDown(debts, { key: "End" });
    expect(screen.getByRole("tab", { name: "Payoff Plan" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Payoff Plan" }), { key: "ArrowRight" });
    expect(loan).toHaveFocus();
  });

  it("remembers the last time unit picked, for every tab", () => {
    mockApi();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Months" }));
    expect(loadData().timeUnit).toBe("months");
    fireEvent.click(screen.getByRole("tab", { name: "Debts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add debt" }));
    expect(screen.getByRole("button", { name: "Months" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has no currency setting: USD only", () => {
    mockApi();
    render(<App />);
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
  });

  it("works when storage is unavailable", () => {
    mockApi();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<App />);
    expect(screen.getByText(/isn't saving your entries/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Loan amount/), { target: { value: "1000" } });
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("1000");
  });

  it("replaces data from a valid import only after confirming", async () => {
    mockApi();
    render(<App />);
    await chooseFile(JSON.stringify(toSaved(savedData())));
    const dialog = await screen.findByRole("dialog", { name: "Replace your data?" });
    expect(dialog).toHaveTextContent("an empty loan form, 0 debts");
    expect(dialog).toHaveTextContent("loan details, 0 debts");
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Replace my data" }));
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("5000");
    expect(loadData().loan.amount).toBe("5000");
  });

  it("changes nothing when the import is cancelled", async () => {
    mockApi();
    render(<App />);
    await chooseFile(JSON.stringify(toSaved(savedData())));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("");
  });

  it.each([
    ["not JSON", "{oops"],
    ["wrong shape", JSON.stringify({ version: 1, data: { currency: "EUR" } })],
    ["wrong version", JSON.stringify({ version: 9, data: emptyData() })],
  ])("rejects an invalid file (%s) and changes nothing", async (_label, content) => {
    mockApi();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSaved(savedData())));
    render(<App />);
    await chooseFile(content);
    await waitFor(() =>
      expect(screen.getByText(/isn't a Money Trees export, so nothing was changed/)).toBeVisible(),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("5000");
    expect(loadData().loan.amount).toBe("5000");
  });

  it("clears all data after an in-page confirmation", async () => {
    mockApi();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSaved(savedData())));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all data" }));
    const dialog = screen.getByRole("dialog", { name: "Clear all data?" });
    expect(dialog).toHaveTextContent("can't be undone");
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("5000");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear all data" })[1]!);
    expect(screen.getByLabelText(/^Loan amount/)).toHaveValue("");
    expect(loadData()).toEqual(emptyData());
  });

  it("exports saved inputs as a JSON file", () => {
    mockApi();
    const createUrl = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", { ...URL, createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Export data" }));
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Downloaded money-trees-data.json.")).toBeVisible();
  });
});
