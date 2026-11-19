import type { DebtInput } from "../lib/storage";

function loan(id: string, name: string, category: string, balance: string, rate: string, months: string): DebtInput {
  return {
    id,
    name,
    category,
    balance,
    ratePercent: rate,
    paymentMode: "fixed_term",
    modeChosen: true,
    term: months,
    termUnit: "months",
    monthlyPayment: "",
    owner: "p1",
  };
}

/** The three test debts from Specs 2 and 3. */
export const THREE_DEBTS: DebtInput[] = [
  loan("p1", "Personal loan", "personal", "3000", "4", "24"),
  loan("c1", "Car loan", "auto", "15000", "9", "60"),
  loan("s1", "Student loan", "student", "20000", "6", "120"),
];

/** The Spec 3b credit card: $5,000 at 24%, $200 a month. */
export const CARD: DebtInput = {
  id: "cc",
  name: "Credit card",
  category: "credit_card",
  balance: "5000",
  ratePercent: "24",
  paymentMode: "fixed_payment",
  modeChosen: true,
  term: "",
  termUnit: "years",
  monthlyPayment: "200",
  owner: "p1",
};
