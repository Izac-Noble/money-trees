export type Health = {
  status: string;
  env: string;
  engine_version: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "";

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${API_URL}/health`, { signal });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as Health;
}
