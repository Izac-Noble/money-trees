// @vitest-environment node
// Fails if an em dash appears anywhere in the web app's source or HTML.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findEmDashes } from "./src/lib/emdash";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|html|json)$/.test(name) ? [path] : [];
  });
}

describe("UI text", () => {
  it("has no em dashes", () => {
    const files = [...sourceFiles(join(ROOT, "src")), join(ROOT, "index.html")];
    const hits = files.flatMap((file) =>
      findEmDashes(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`),
    );
    expect(hits).toEqual([]);
  });
});
