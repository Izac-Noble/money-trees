export type Health = {
  status: string;
  app_env: string;
  engine_version: string;
};

// Always a same-origin, relative path. On Vercel, /api/* is routed to the Python
// service; locally, the Vite dev server proxies /api to uvicorn.
export const API_BASE = "/api";

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${API_BASE}/health`, { signal });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as Health;
}
