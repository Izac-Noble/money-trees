/** Chart values from a schedule: the first starting balance, then each ending balance. */
export function balancesFromSchedule(
  rows: { starting_balance: string; ending_balance: string }[],
): string[] {
  const first = rows[0];
  return first ? [first.starting_balance, ...rows.map((r) => r.ending_balance)] : [];
}
