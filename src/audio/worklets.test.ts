/**
 * The audio worklets' own code. An audio worklet has no page address (no `self`, no `location`):
 * a processor whose code reaches a module that asks for a worker's URL (`?worker&url`, which the
 * build turns into a read of the page's address) fails to load in the built app, while it works
 * in development, where every module is served apart. Every processor's imports, followed all the
 * way down, must stay clear of that.
 */
import { describe, expect, it } from "vitest";

const files = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const worklets = Object.keys(files).filter((f) => f.endsWith(".worklet.ts"));

/** `spec` (a relative import) from the module at `from`, as a key of `files` */
function resolveFrom(from: string, spec: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const p of spec.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  const base = parts.join("/");
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((k) => k in files) ?? null;
}
function reach(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of files[file].matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"/gm)) {
    if (m[1].includes("?")) continue;
    const f = resolveFrom(file, m[1]);
    if (f) reach(f, seen);
  }
  return seen;
}

describe("the audio worklets' code", () => {
  it("is found (the synth, the ears, the master's safety limiter)", () => {
    expect(worklets.length).toBeGreaterThanOrEqual(3);
  });
  for (const w of worklets)
    it(`${w} reaches nothing that asks for a worker's URL or the page's address`, () => {
      const seen = reach(w);
      expect(seen.size).toBeGreaterThan(1);
      for (const f of seen) {
        const text = files[f].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        expect(text, f).not.toMatch(/\?worker|\?url|import\.meta\.url|\bself\.location|\bwindow\./);
      }
    });
});
