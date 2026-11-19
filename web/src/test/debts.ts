import type { DebtInput } from "../lib/storage";

/** The three test debts from Specs 2 and 3. */
export const THREE_DEBTS: DebtInput[] = [
  {
    id: "p1",
    name: "Personal loan",
    category: "personal",
    balance: "3000",
    ratePercent: "4",
    term: "24", termUnit: "months",
  },
  { id: "c1", name: "Car loan", category: "auto", balance: "15000", ratePercent: "9", term: "60", termUnit: "months" },
  {
    id: "s1",
    name: "Student loan",
    category: "student",
    balance: "20000",
    ratePercent: "6",
    term: "120", termUnit: "months",
  },
];
