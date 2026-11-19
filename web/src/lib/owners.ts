import type { Owner } from "./storage";

/** The first names, falling back to neutral labels while they're still blank. */
export function ownerLabel(owner: Owner, names: [string, string]): string {
  if (owner === "joint") return "Joint";
  const name = owner === "p1" ? names[0] : names[1];
  return name.trim() || (owner === "p1" ? "First person" : "Second person");
}
