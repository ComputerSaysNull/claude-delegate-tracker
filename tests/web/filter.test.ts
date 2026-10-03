import { describe, expect, it } from "vitest";
import { choices, filterRows, isFiltering, NO_FILTER, type RowFilter } from "../../src/web/filter.ts";
import type { ListRow } from "../../src/server/streams.ts";

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
    ...overrides,
  };
}

const ROWS: ListRow[] = [
  row({ name: "a", title: "Refactor the auth module", state: "live", kind: "claude-code", model: "claude-sonnet-4" }),
  row({ name: "b", title: "Fix the login screen", state: "ok", kind: "one-shot", model: "claude-opus-4" }),
  row({ name: "c", title: "Write docs for the api", state: "failed", kind: "claude-code", model: "claude-sonnet-4" }),
  row({ name: "d", title: "Untouched delegate", state: "quiet", kind: "claude-code", model: null }),
];

describe("filterRows", () => {
  it("keeps everything when the text is empty or only spaces", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, text: "" })).toHaveLength(4);
    expect(filterRows(ROWS, { ...NO_FILTER, text: "   " })).toHaveLength(4);
  });

  it("requires every word of the text, in any order", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, text: "auth module" }).map((r) => r.name)).toEqual(["a"]);
    expect(filterRows(ROWS, { ...NO_FILTER, text: "module auth" }).map((r) => r.name)).toEqual(["a"]);
    expect(filterRows(ROWS, { ...NO_FILTER, text: "docs api" }).map((r) => r.name)).toEqual(["c"]);
    // Each word matches a different row; no row has both.
    expect(filterRows(ROWS, { ...NO_FILTER, text: "auth docs" })).toEqual([]);
  });

  it("matches text case-insensitively", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, text: "REFACTOR" }).map((r) => r.name)).toEqual(["a"]);
    expect(filterRows(ROWS, { ...NO_FILTER, text: "Auth MODULE" }).map((r) => r.name)).toEqual(["a"]);
  });

  it("keeps rows whose state is in the state set (multi-select)", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, states: ["live", "ok"] }).map((r) => r.name)).toEqual(["a", "b"]);
    expect(filterRows(ROWS, { ...NO_FILTER, states: ["quiet"] }).map((r) => r.name)).toEqual(["d"]);
  });

  it("keeps rows of the chosen kind", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, kind: "one-shot" }).map((r) => r.name)).toEqual(["b"]);
    expect(filterRows(ROWS, { ...NO_FILTER, kind: "claude-code" }).map((r) => r.name)).toEqual(["a", "c", "d"]);
  });

  it("keeps rows of the chosen model", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, model: "claude-opus-4" }).map((r) => r.name)).toEqual(["b"]);
    expect(filterRows(ROWS, { ...NO_FILTER, model: "claude-sonnet-4" }).map((r) => r.name)).toEqual(["a", "c"]);
  });

  it("combines all filters with AND", () => {
    const f: RowFilter = { text: "auth", states: ["live"], kind: "claude-code", model: "claude-sonnet-4" };
    expect(filterRows(ROWS, f).map((r) => r.name)).toEqual(["a"]);
  });

  it("keeps the original order of the rows", () => {
    expect(filterRows(ROWS, { ...NO_FILTER, states: ["failed", "ok", "live"] }).map((r) => r.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("isFiltering", () => {
  it("is false for the empty filter and whitespace-only text", () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ ...NO_FILTER, text: "   " })).toBe(false);
  });

  it("is true when any field is set", () => {
    expect(isFiltering({ ...NO_FILTER, text: "x" })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, states: ["ok"] })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, kind: "one-shot" })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, model: "claude-opus-4" })).toBe(true);
  });
});

describe("choices", () => {
  it("returns distinct, non-null values, sorted", () => {
    expect(choices(ROWS, "kind")).toEqual(["claude-code", "one-shot"]);
    expect(choices(ROWS, "model")).toEqual(["claude-opus-4", "claude-sonnet-4"]);
  });

  it("returns an empty list when there is nothing to choose", () => {
    expect(choices([], "kind")).toEqual([]);
    expect(choices([row({ model: null })], "model")).toEqual([]);
  });
});
