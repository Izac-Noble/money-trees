import { describe, expect, it } from "vitest";
import type { IndexHtmlTransformHook } from "vite";
import { NOINDEX_META, robotsMeta, shouldNoindex } from "./robots";

const HTML = "<html><head><title>x</title></head><body></body></html>";

function transform(appEnv: string | undefined): string {
  const hook = robotsMeta(appEnv).transformIndexHtml as IndexHtmlTransformHook;
  return hook(HTML, {} as Parameters<IndexHtmlTransformHook>[1]) as string;
}

describe("robots meta", () => {
  it.each([undefined, "", "development", "staging", "preview", "Production"])(
    "adds noindex when APP_ENV is %j",
    (env) => {
      expect(shouldNoindex(env)).toBe(true);
      expect(transform(env)).toContain(NOINDEX_META);
    },
  );

  it("leaves production builds indexable", () => {
    expect(shouldNoindex("production")).toBe(false);
    expect(transform("production")).toBe(HTML);
  });
});
