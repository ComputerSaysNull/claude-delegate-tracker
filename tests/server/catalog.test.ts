// Server-side list filtering: the slimmed stream state a cached catalog keeps, the
// one-row match rule, and the query-parameter round trip the list page and the
// /api/streams route both rely on.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterFromParams,
  filterToParams,
  NO_FILTER,
  rowMatches,
  slimState,
  type RowFilter,
} from "../../src/server/catalog.ts";
import { applyLine, listRow, newStreamState, type ListRow, type StreamState } from "../../src/server/streams.ts";

const QUIET = 60;
const DURING = new Date("2026-10-01T12:00:05.000Z");
const LONG_AFTER = new Date("2026-10-05T00:00:00.000Z");
const QUIET_MAKING = new Date("2026-10-01T14:30:00.000Z");

describe("slimState", () => {
  const root = join(import.meta.dirname, "../..");
  const samplesDir = join(root, "contract", "samples");

  function loadState(file: string): StreamState {
    const s = newStreamState();
    for (const line of readFileSync(join(samplesDir, file), "utf8").split("\n")) {
      if (line.trim() !== "") applyLine(s, line);
    }
    return s;
  }

  it("leaves every contract sample's list row unchanged", () => {
    const files = readdirSync(samplesDir).filter((f) => f.endsWith(".jsonl")).sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const s = loadState(file);
      const slim = slimState(s);
      for (const now of [DURING, LONG_AFTER, QUIET_MAKING]) {
        expect(listRow(file, slim, now, QUIET)).toEqual(listRow(file, s, now, QUIET));
      }
    }
  });

  it("drops task and files_read from the slimmed start", () => {
    const s = newStreamState();
    applyLine(s, JSON.stringify({
      t: "start", at: "2026-10-01T12:00:00.000Z", task: "Do the thing",
      files_read: [{ path: "x" }], tool: "delegate", tools: ["read_file"],
    }));
    const slim = slimState(s);
    expect(slim.start).not.toBeNull();
    expect("task" in slim.start!).toBe(false);
    expect("files_read" in slim.start!).toBe(false);
  });

  it("cuts a failed end's error to its first line", () => {
    const s = newStreamState();
    applyLine(s, JSON.stringify({ t: "start", at: "2026-10-01T12:00:00.000Z", tool: "delegate", tools: [] }));
    applyLine(s, JSON.stringify({
      t: "end", at: "2026-10-01T12:00:01.000Z", ok: false,
      error: "first line\r\nsecond line\nthird line",
    }));
    const slim = slimState(s);
    expect(slim.end?.error).toBe("first line");
  });
});

describe("rowMatches", () => {
  function row(overrides: Partial<ListRow> = {}): ListRow {
    return {
      name: "stream-1",
      state: "live",
      why: null,
      age: null,
      kind: "claude-code",
      model: null,
      effort: null,
      title: "Refactor the auth module",
      startedAt: null,
      elapsed: null,
      turns: null,
      unknownFormat: null,
      left: null,
      queueOf: null,
      workspace: null,
      mcpTask: null,
      ...overrides,
    };
  }

  it("keeps a row when nothing is filtering", () => {
    expect(rowMatches(row(), NO_FILTER)).toBe(true);
    expect(rowMatches(row(), { ...NO_FILTER, text: "   " })).toBe(true);
  });

  it("requires every word of the text, case-insensitively, in the title", () => {
    const r = row({ title: "Refactor the auth module" });
    expect(rowMatches(r, { ...NO_FILTER, text: "auth module" })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, text: "AUTH MODULE" })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, text: "module auth" })).toBe(true);
    // Each word matches a different row; no row has both.
    expect(rowMatches(r, { ...NO_FILTER, text: "auth docs" })).toBe(false);
  });

  it("matches a row's state against the state set", () => {
    const r = row({ state: "live" });
    expect(rowMatches(r, { ...NO_FILTER, states: ["live", "ok"] })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, states: ["ok"] })).toBe(false);
  });

  it("matches a row's kind", () => {
    const r = row({ kind: "one-shot" });
    expect(rowMatches(r, { ...NO_FILTER, kind: "one-shot" })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, kind: "claude-code" })).toBe(false);
  });

  it("matches a row's model", () => {
    const r = row({ model: "claude-opus-4" });
    expect(rowMatches(r, { ...NO_FILTER, model: "claude-opus-4" })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, model: "flash" })).toBe(false);
  });

  it("matches a row's workspace against the repo", () => {
    const r = row({ workspace: "web-shop" });
    expect(rowMatches(r, { ...NO_FILTER, repo: "web-shop" })).toBe(true);
    expect(rowMatches(r, { ...NO_FILTER, repo: "api" })).toBe(false);
    // A row with no workspace never matches a repo.
    expect(rowMatches(row({ workspace: null }), { ...NO_FILTER, repo: "web-shop" })).toBe(false);
  });

  it("combines all filters with AND", () => {
    const r = row({ state: "live", kind: "claude-code", model: "claude-sonnet-4", title: "auth module" });
    const f: RowFilter = { text: "auth", states: ["live"], kind: "claude-code", model: "claude-sonnet-4", repo: null };
    expect(rowMatches(r, f)).toBe(true);
    expect(rowMatches(r, { ...f, states: ["ok"] })).toBe(false);
  });
});

describe("filter params", () => {
  it("reads the same query keys the address uses", () => {
    const q = new URLSearchParams("q=auth+module&state=live,ok&kind=one-shot&model=flash&repo=docs");
    expect(filterFromParams(q)).toEqual({
      text: "auth module",
      states: ["live", "ok"],
      kind: "one-shot",
      model: "flash",
      repo: "docs",
    });
  });

  it("drops a state it does not know, and repeats", () => {
    expect(filterFromParams(new URLSearchParams("state=live,bogus,live,cut%20off")).states).toEqual(["live", "cut off"]);
  });

  it("round-trips a filter through filterToParams", () => {
    const f: RowFilter = { text: "auth module", states: ["live", "ok"], kind: "one-shot", model: "flash", repo: "docs" };
    const q = new URLSearchParams();
    filterToParams(f, q);
    expect(filterFromParams(q)).toEqual(f);
  });

  it("writes nothing for the empty filter", () => {
    const q = new URLSearchParams();
    filterToParams(NO_FILTER, q);
    expect(q.toString()).toBe("");
  });

  it("leaves other query keys alone", () => {
    const q = new URLSearchParams("before=20261001T120000.000-a.jsonl");
    filterToParams({ ...NO_FILTER, model: "rare" }, q);
    expect(q.get("before")).toBe("20261001T120000.000-a.jsonl");
    expect(filterFromParams(q).model).toBe("rare");
  });
});
