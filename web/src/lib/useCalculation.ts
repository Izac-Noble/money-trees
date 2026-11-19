import { useEffect, useRef, useState } from "react";
import type { ApiResult, FieldError } from "../api";
import { useDebounced } from "./useDebounced";

export type CalcStatus<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; data: T }
  | { kind: "error"; errors: FieldError[] };

/**
 * Call the API about 300 ms after `requestKey` stops changing. An empty key means
 * the inputs aren't ready, so nothing is sent. Stale requests are aborted.
 */
export function useCalculation<T>(
  requestKey: string,
  run: (requestKey: string, signal: AbortSignal) => Promise<ApiResult<T>>,
): CalcStatus<T> {
  const debouncedKey = useDebounced(requestKey, 300);
  const [status, setStatus] = useState<CalcStatus<T>>({ kind: "idle" });
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!debouncedKey) {
      setStatus({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setStatus({ kind: "loading" });
    runRef
      .current(debouncedKey, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setStatus(
          result.ok ? { kind: "done", data: result.data } : { kind: "error", errors: result.errors },
        );
      })
      .catch(() => {
        // Aborted because the inputs changed; a newer request is on its way.
      });
    return () => controller.abort();
  }, [debouncedKey]);

  return status;
}

/** Split API errors into per-field messages and general ones. */
export function splitErrors(status: CalcStatus<unknown>): {
  byField: Record<string, string>;
  general: string[];
} {
  const byField: Record<string, string> = {};
  const general: string[] = [];
  if (status.kind === "error") {
    for (const e of status.errors) {
      if (e.field) byField[e.field] = e.message;
      else general.push(e.message);
    }
  }
  return { byField, general };
}
