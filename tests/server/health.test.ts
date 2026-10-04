// One test per rule in docs/ARCHITECTURE.md "Report health".
import { describe, expect, it } from "vitest";
import {
  buildHealth,
  type Health,
  type HealthInput,
} from "../../src/server/health.ts";
import { KNOWN_MAJOR } from "../../src/server/streams.ts";
import type { ListRow } from "../../src/server/streams.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { NodeFigures } from "../../src/server/nodes.ts";

const NOW = new Date("2024-01-02T03:04:05.000Z");

function list(over: Partial<ListResponse> = {}): ListResponse {
  return {
    rows: [],
    capped: false,
    total: 0,
    unstamped: 0,
    folderReadable: true,
    badLines: 0,
    schemaFailures: 0,
    ...over,
  };
}

function row(over: Partial<ListRow> = {}): ListRow {
  return {
    name: "s",
    state: "live",
    why: null,
    age: null,
    kind: "one-shot",
    model: null,
    effort: null,
    title: "",
    startedAt: null,
    elapsed: null,
    turns: null,
    unknownFormat: null,
    ...over,
  };
}

function model(over: Partial<ModelFigures> = {}): ModelFigures {
  return {
    status: "ok",
    running: null,
    waiting: null,
    kvCachePercent: null,
    decodeTokensPerSecond: null,
    decodeWindowSeconds: null,
    prefixHitPercent: null,
    preemptions: null,
    readAt: null,
    ...over,
  };
}

function node(over: Partial<NodeFigures> = {}): NodeFigures {
  return {
    name: "node",
    status: "ok",
    cpuPercent: null,
    cpuWindowSeconds: null,
    cpuTempC: null,
    gpuPercent: null,
    gpuTempC: null,
    readAt: null,
    ...over,
  };
}

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    folderConfigured: true,
    list: list(),
    retryInSeconds: null,
    clockSkewSeconds: 0,
    readIntervalSeconds: 2,
    model: model(),
    nodes: [],
    ...over,
  };
}

function texts(h: Health): string[] {
  return h.banners.map((b) => b.text);
}

describe("buildHealth", () => {
  it("a healthy input has no banners", () => {
    const h = buildHealth(input(), NOW);
    expect(h.banners).toEqual([]);
  });

  it("TRANSCRIPT_DIR not set gives the error and never the can't-be-read banner", () => {
    const h = buildHealth(input({ folderConfigured: false, list: list({ folderReadable: false }) }), NOW);
    const t = texts(h);
    expect(t).toContain("TRANSCRIPT_DIR is not set, so there is nothing to list.");
    expect(t.some((s) => s.includes("can't be read"))).toBe(false);
  });

  it("an unreadable folder reports the next try when retryInSeconds is set", () => {
    const h = buildHealth(input({ list: list({ folderReadable: false }), retryInSeconds: 4 }), NOW);
    expect(texts(h)).toContain("The transcript folder can't be read; showing the last known list. Next try in 4s.");
  });

  it("an unreadable folder omits the retry sentence when retryInSeconds is null", () => {
    const h = buildHealth(input({ list: list({ folderReadable: false }), retryInSeconds: null }), NOW);
    const t = texts(h);
    expect(t).toContain("The transcript folder can't be read; showing the last known list.");
    expect(t.some((s) => s.includes("Next try"))).toBe(false);
  });

  it("an unreachable model server warns", () => {
    const h = buildHealth(input({ model: model({ status: "unreachable" }) }), NOW);
    expect(texts(h)).toContain("The model server can't be reached.");
  });

  it("a model server without /metrics warns about the 404", () => {
    const h = buildHealth(input({ model: model({ status: "not available" }) }), NOW);
    expect(texts(h)).toContain("The model server has no /metrics (404).");
  });

  it("a not configured model server gives no banner", () => {
    const h = buildHealth(input({ model: model({ status: "not configured" }) }), NOW);
    expect(h.banners).toEqual([]);
  });

  it("an unreachable node warns naming it", () => {
    const h = buildHealth(input({ nodes: [node({ name: "alpha", status: "unreachable" })] }), NOW);
    expect(texts(h)).toContain("Node alpha can't be reached.");
  });

  it("a refused host key is an error naming the node", () => {
    const h = buildHealth(input({ nodes: [node({ name: "beta", status: "host key refused" })] }), NOW);
    expect(texts(h)).toContain("Node beta was refused: its host key does not match the pinned one.");
    expect(h.banners.find((b) => b.text.includes("Node beta was refused"))?.level).toBe("error");
  });

  it("unknown formats are listed once each in first-seen order, naming KNOWN_MAJOR", () => {
    const h = buildHealth(input({
      list: list({
        rows: [
          row({ name: "a", unknownFormat: "2.0" }),
          row({ name: "b", unknownFormat: "3.1" }),
          row({ name: "c", unknownFormat: "2.0" }),
        ],
      }),
    }), NOW);
    const matches = h.banners.filter((b) => b.text.includes("is newer than this tracker knows"));
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe(
      `Contract format 2.0, 3.1 is newer than this tracker knows (major ${KNOWN_MAJOR}); those streams are shown as best they can be.`,
    );
  });

  it("a single schema failure is reported in the singular", () => {
    const h = buildHealth(input({ list: list({ schemaFailures: 1 }) }), NOW);
    expect(texts(h)).toContain("1 event did not match the contract's schema; it is still shown.");
  });

  it("several schema failures are reported in the plural", () => {
    const h = buildHealth(input({ list: list({ schemaFailures: 3 }) }), NOW);
    expect(texts(h)).toContain("3 events did not match the contract's schema; they are still shown.");
  });

  it("no schema failures give no banner", () => {
    const h = buildHealth(input({ list: list({ schemaFailures: 0 }) }), NOW);
    expect(h.banners).toEqual([]);
  });

  it("a single unstamped name is reported in the singular", () => {
    const h = buildHealth(input({ list: list({ unstamped: 1 }) }), NOW);
    expect(texts(h)).toContain("1 stream name lacks the timestamp prefix; it sorts last.");
  });

  it("two unstamped names are reported in the plural", () => {
    const h = buildHealth(input({ list: list({ unstamped: 2 }) }), NOW);
    expect(texts(h)).toContain("2 stream names lack the timestamp prefix; they sort last.");
  });

  it("a single non-JSON line is reported in the singular", () => {
    const h = buildHealth(input({ list: list({ badLines: 1 }) }), NOW);
    expect(texts(h)).toContain("1 line was not JSON and was skipped.");
  });

  it("two non-JSON lines are reported in the plural", () => {
    const h = buildHealth(input({ list: list({ badLines: 2 }) }), NOW);
    expect(texts(h)).toContain("2 lines were not JSON and were skipped.");
  });

  it("a clock 6 s behind warns about 6s", () => {
    const h = buildHealth(input({ clockSkewSeconds: -6 }), NOW);
    expect(texts(h)).toContain("The WSL clock and this machine's clock differ by about 6s; ages and times are off by that much.");
  });

  it("a clock 5 s behind is within the limit and warns nothing", () => {
    const h = buildHealth(input({ clockSkewSeconds: -5 }), NOW);
    expect(h.banners).toEqual([]);
  });

  it("a clock 7 s ahead with a 2 s read interval is within the limit", () => {
    const h = buildHealth(input({ clockSkewSeconds: 7, readIntervalSeconds: 2 }), NOW);
    expect(h.banners).toEqual([]);
  });

  it("a clock 8 s ahead with a 2 s read interval warns about 8s", () => {
    const h = buildHealth(input({ clockSkewSeconds: 8, readIntervalSeconds: 2 }), NOW);
    expect(texts(h)).toContain("The WSL clock and this machine's clock differ by about 8s; ages and times are off by that much.");
  });

  it("a null clock skew warns nothing", () => {
    const h = buildHealth(input({ clockSkewSeconds: null }), NOW);
    expect(h.banners).toEqual([]);
  });

  it("with everything wrong, errors precede warnings and warnings follow the rule order", () => {
    const h = buildHealth(input({
      list: list({
        folderReadable: false,
        schemaFailures: 2,
        unstamped: 2,
        badLines: 2,
        rows: [row({ name: "a", unknownFormat: "2.0" })],
      }),
      retryInSeconds: 4,
      clockSkewSeconds: -8,
      model: model({ status: "unreachable" }),
      nodes: [
        node({ name: "alpha", status: "host key refused" }),
        node({ name: "beta", status: "unreachable" }),
      ],
    }), NOW);
    const levels = h.banners.map((b) => b.level);
    const firstWarning = levels.indexOf("warning");
    expect(firstWarning).toBeGreaterThan(-1);
    expect(levels.slice(firstWarning).every((l) => l === "warning")).toBe(true);
    const warnings = h.banners.filter((b) => b.level === "warning").map((b) => b.text);
    expect(warnings).toEqual([
      "The model server can't be reached.",
      "Node beta can't be reached.",
      `Contract format 2.0 is newer than this tracker knows (major ${KNOWN_MAJOR}); those streams are shown as best they can be.`,
      "2 events did not match the contract's schema; they are still shown.",
      "2 stream names lack the timestamp prefix; they sort last.",
      "2 lines were not JSON and were skipped.",
      "The WSL clock and this machine's clock differ by about 8s; ages and times are off by that much.",
    ]);
  });

  it("checkedAt is now's ISO string", () => {
    const d = new Date("2024-05-06T07:08:09.000Z");
    const h = buildHealth(input(), d);
    expect(h.checkedAt).toBe(d.toISOString());
  });

  it("transcriptFolder and clockSkewSeconds pass through", () => {
    const h = buildHealth(input({ clockSkewSeconds: -12, list: list({ folderReadable: false }) }), NOW);
    expect(h.transcriptFolder).toEqual({ configured: true, readable: false });
    expect(h.clockSkewSeconds).toBe(-12);
  });
});
