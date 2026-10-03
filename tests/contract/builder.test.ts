// The vendored samples drive the same stream builder the page uses: every line
// applies cleanly, unknown fields and kinds leave the derived row unchanged.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyLine, listRow, newStreamState, type StreamState } from "../../src/server/streams.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const samplesDir = join(root, "contract", "samples");
const sampleFiles = readdirSync(samplesDir).filter((f) => f.endsWith(".jsonl"));
const STATES = ["live", "queued", "quiet", "ok", "failed", "cut off"];
const toLine = (v: unknown): string => JSON.stringify(v) as string;

function linesOf(file: string): string[] {
  return readFileSync(join(samplesDir, file), "utf8").split("\n").filter((l) => l.trim() !== "");
}

function load(file: string): StreamState {
  const s = newStreamState();
  for (const l of linesOf(file)) applyLine(s, l);
  return s;
}

describe("contract samples", () => {
  it("has at least one sample", () => {
    expect(sampleFiles.length).toBeGreaterThan(0);
  });

  it.each(sampleFiles)("%s: every line applies cleanly, no bad lines, valid row", (f) => {
    const s = newStreamState();
    const lines = linesOf(f);
    expect(() => {
      for (const l of lines) applyLine(s, l);
    }).not.toThrow();
    expect(s.badLines).toBe(0);
    const row = listRow(f, s, new Date(), 120);
    expect(STATES).toContain(row.state);
  });

  it("the agentic sample ends ok, cut off or failed", () => {
    const agentic = sampleFiles.find((f) => f.includes("agentic"));
    expect(agentic).toBeDefined();
    const s = load(agentic!);
    expect(s.end).not.toBeNull();
    expect(STATES.slice(3)).toContain(listRow(agentic!, s, new Date(), 120).state);
  });

  it.each(sampleFiles)(
    "%s: unknown fields and a future kind leave the derived row unchanged",
    (f) => {
      const lines = linesOf(f);
      const original = newStreamState();
      for (const l of lines) applyLine(original, l);
      const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;

      const copied = newStreamState();
      for (const l of lines) {
        const evt = JSON.parse(l) as Record<string, unknown>;
        applyLine(copied, toLine({ ...evt, zzz_unknown_extra: 1 }));
      }
      applyLine(copied, toLine({ t: "from_the_future", at: last.at, x: 1 }));

      const now = new Date("2026-10-01T13:00:09.000Z");
      const a = listRow(f, original, now, 120);
      const b = listRow(f, copied, now, 120);
      expect(b.state).toBe(a.state);
      expect(b.kind).toBe(a.kind);
      expect(b.turns).toBe(a.turns);
      expect(b.elapsed).toBe(a.elapsed);
    },
  );

  it("a copy whose start has format 2.0 gives unknownFormat 2.0", () => {
    const f = sampleFiles[0];
    const copied = newStreamState();
    for (const l of linesOf(f)) {
      const evt = JSON.parse(l) as Record<string, unknown>;
      applyLine(copied, toLine({ ...evt, ...(evt.t === "start" ? { format: "2.0" } : {}) }));
    }
    expect(listRow(f, copied, new Date(), 120).unknownFormat).toBe("2.0");
  });
});
