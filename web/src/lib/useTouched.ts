import { useCallback, useState } from "react";

/**
 * When to show a field's error: only after the user has left the field (blur), or
 * after they tried to use the form (`revealAll`). Typing in a field for the first
 * time never shows an error. Once shown, the error follows the current value, so it
 * clears as soon as the value is fixed.
 */
export function useTouched() {
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());

  const touch = useCallback((key: string) => {
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  /** Show errors on every field in `keys`, e.g. after pressing a button that needs them. */
  const revealAll = useCallback((keys: string[]) => {
    setRevealed((prev) => new Set([...prev, ...keys]));
  }, []);

  const reset = useCallback(() => {
    setTouched(new Set());
    setRevealed(new Set());
  }, []);

  const isVisible = useCallback(
    (key: string) => touched.has(key) || revealed.has(key),
    [touched, revealed],
  );

  return { touch, revealAll, reset, isVisible };
}
