export type Health = {
  status: string;
  app_env: string;
  engine_version: string;
};

// Empty in local dev, so requests go through the Vite proxy. Set on Vercel per environment.
const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${API_URL}/health`, { signal });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as Health;
}
