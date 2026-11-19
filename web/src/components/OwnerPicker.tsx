import { ownerLabel } from "../lib/owners";
import type { Owner } from "../lib/storage";

type Props = {
  id: string;
  value: Owner;
  onChange: (owner: Owner) => void;
  /** First names of the two people, from the Household tab. */
  names: [string, string];
  /** What this row is, for screen readers, e.g. "Sam's job". */
  itemLabel?: string;
};

/** "Whose?" for couples: the two first names, or Joint. Hidden for singles by callers. */
export function OwnerPicker({ id, value, onChange, names, itemLabel }: Props) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        Whose?
        {itemLabel && <span className="sr-only"> ({itemLabel})</span>}
      </label>
      <select
        id={id}
        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-2"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "p1" || next === "p2" || next === "joint") onChange(next);
        }}
      >
        {(["p1", "p2", "joint"] as const).map((owner) => (
          <option key={owner} value={owner}>
            {ownerLabel(owner, names)}
          </option>
        ))}
      </select>
    </div>
  );
}
