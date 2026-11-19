import { vi } from "vitest";
import meta from "./fixtures/meta.json";

type Handler = (body: unknown) => { status?: number; json: unknown };

/**
 * Stub fetch with canned API responses (generated from the real API in Spec 4's
 * cases). GET /api/meta is always answered; POST routes use the given handlers.
 */
export function mockApi(routes: Record<string, Handler> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/meta") return new Response(JSON.stringify(meta));
    const handler = routes[url];
    if (!handler) return new Response(JSON.stringify({ errors: [] }), { status: 404 });
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const { status = 200, json } = handler(body);
    return new Response(JSON.stringify(json), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Bodies sent to a POST route, in call order. */
export function sentBodies(fetchMock: ReturnType<typeof mockApi>, url: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input]) => String(input) === url)
    .map(([, init]) => JSON.parse(String(init?.body)));
}
