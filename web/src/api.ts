// Always a same-origin, relative path. On Vercel, /api/* is routed to the Python
// service; locally, the Vite dev server proxies /api to uvicorn.
export const API_BASE = "/api";

export type Health = {
  status: string;
  app_env: string;
  engine_version: string;
};

export type Meta = {
  engine_version: string;
  disclaimer: string;
  categories: { value: string; suggested_term_months: number | null }[];
  strategies: string[];
  limits: {
    max_debts: number;
    max_name_length: number;
    min_term_months: number;
    max_term_months: number;
  };
};

export type ScheduleRow = {
  month: number;
  starting_balance: string;
  interest: string;
  scheduled_principal: string;
  extra_principal: string;
  payment: string;
  ending_balance: string;
};

export type AmortizationResponse = {
  engine_version: string;
  summary: {
    payment: string;
    payoff_month: number;
    total_interest: string;
    total_paid: string;
    interest_saved: string | null;
    months_saved: number | null;
  };
  schedule: ScheduleRow[];
};

export type AmortizationRequest = {
  principal: string;
  annual_rate: string;
  term_months: number;
  extra_monthly?: string;
  lump_sums?: { month: number; amount: string }[];
};

export type FieldError = { field: string | null; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; errors: FieldError[] };

const GENERIC_ERROR: FieldError = {
  field: null,
  message: "Couldn't reach the calculator. Check your connection and try again.",
};

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${API_BASE}/health`, { signal });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return (await res.json()) as Health;
}

export async function fetchMeta(signal?: AbortSignal): Promise<Meta> {
  const res = await fetch(`${API_BASE}/meta`, { signal });
  if (!res.ok) throw new Error(`Meta request failed: ${res.status}`);
  return (await res.json()) as Meta;
}

export async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { ok: false, errors: [GENERIC_ERROR] };
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, errors: [GENERIC_ERROR] };
  }
  if (res.ok) return { ok: true, data: payload as T };
  const errors = (payload as { errors?: FieldError[] } | null)?.errors;
  return { ok: false, errors: Array.isArray(errors) && errors.length ? errors : [GENERIC_ERROR] };
}

export function postAmortization(
  body: AmortizationRequest,
  signal?: AbortSignal,
): Promise<ApiResult<AmortizationResponse>> {
  return postJson<AmortizationResponse>("/amortization", body, signal);
}
