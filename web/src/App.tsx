import { useEffect, useState } from "react";
import { fetchHealth, type Health } from "./api";

type State =
  | { kind: "loading" }
  | { kind: "ok"; health: Health }
  | { kind: "error"; message: string };

export default function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setState({ kind: "ok", health }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-emerald-50 px-4 py-16 text-emerald-950">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Money Trees</h1>
        <p className="mt-1 text-sm text-emerald-800">Scaffold — no features yet.</p>
        <div className="mt-6 rounded-lg border border-emerald-100 p-4 text-sm" role="status">
          {state.kind === "loading" && <span>Checking API…</span>}
          {state.kind === "ok" && (
            <span>
              API is <strong>{state.health.status}</strong> · engine v
              {state.health.engine_version} · {state.health.env}
            </span>
          )}
          {state.kind === "error" && (
            <span className="text-red-700">API unreachable: {state.message}</span>
          )}
        </div>
      </div>
    </main>
  );
}
