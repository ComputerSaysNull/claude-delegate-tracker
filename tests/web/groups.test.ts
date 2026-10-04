// The list grouped by when each delegation started, in the viewer's own days: Today,
// Yesterday, the other days of this week, Last week, then months.
import { afterEach, describe, expect, it } from "vitest";
import type { ListRow } from "../../src/server/streams.ts";
import { dateGroup, groupRows, todayCounts } from "../../src/web/groups.ts";

const savedTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = savedTz;
});

// Sunday 4 October 2026, 19:00 in Amsterdam (UTC+2).
const NOW = new Date("2026-10-04T17:00:00.000Z");
const label = (iso: string | null, now = NOW) => dateGroup(iso, now).label;

describe("the group a delegation falls in", () => {
  it("names today and yesterday with their date", () => {
    process.env.TZ = "Europe/Amsterdam";
    expect(label("2026-10-04T06:00:00.000Z")).toBe("Today · 4 Oct");
    expect(label("2026-10-03T20:00:00.000Z")).toBe("Yesterday · 3 Oct");
  });

  it("names the other days of this week, which starts on Monday, by weekday", () => {
    process.env.TZ = "Europe/Amsterdam";
    expect(label("2026-10-01T10:00:00.000Z")).toBe("Thursday · 1 Oct");
    expect(label("2026-09-28T10:00:00.000Z")).toBe("Monday · 28 Sep");
  });

  it("puts the week before in Last week", () => {
    process.env.TZ = "Europe/Amsterdam";
    expect(label("2026-09-27T10:00:00.000Z")).toBe("Last week");
    expect(label("2026-09-21T10:00:00.000Z")).toBe("Last week");
  });

  it("puts anything older in its month, with the year when it is not this year", () => {
    process.env.TZ = "Europe/Amsterdam";
    expect(label("2026-09-20T10:00:00.000Z")).toBe("September");
    expect(label("2026-08-15T10:00:00.000Z")).toBe("August");
    expect(label("2025-12-24T10:00:00.000Z")).toBe("December 2025");
  });

  it("counts days in the viewer's zone, so just after local midnight is today", () => {
    process.env.TZ = "Asia/Kolkata";
    // 3 Oct 19:00 UTC is 4 Oct 00:30 in Kolkata.
    expect(label("2026-10-03T19:00:00.000Z")).toBe("Today · 4 Oct");
  });

  it("on a Monday, yesterday is Yesterday rather than Last week", () => {
    process.env.TZ = "Europe/Amsterdam";
    const monday = new Date("2026-10-05T08:00:00.000Z");
    expect(label("2026-10-04T10:00:00.000Z", monday)).toBe("Yesterday · 4 Oct");
    expect(label("2026-10-03T10:00:00.000Z", monday)).toBe("Last week");
  });

  it("gives a delegation without a start time its own group", () => {
    expect(label(null)).toBe("No start time");
  });
});

function row(name: string, startedAt: string | null, state: ListRow["state"] = "ok"): ListRow {
  return {
    name, state, why: null, age: null, kind: "?", model: null, effort: null, title: name,
    startedAt, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null,
  };
}

describe("grouping the rows", () => {
  it("keeps the rows' order, and the groups in the order they first appear", () => {
    process.env.TZ = "Europe/Amsterdam";
    const groups = groupRows(
      [row("a", "2026-10-04T10:00:00.000Z"), row("b", "2026-10-04T09:00:00.000Z"), row("c", "2026-10-03T10:00:00.000Z"), row("d", "2025-01-02T10:00:00.000Z")],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.name)])).toEqual([
      ["Today · 4 Oct", ["a", "b"]],
      ["Yesterday · 3 Oct", ["c"]],
      ["January 2025", ["d"]],
    ]);
  });
});

describe("the summary line", () => {
  it("counts what is running and queued now, and what failed today", () => {
    process.env.TZ = "Europe/Amsterdam";
    const rows = [
      row("r1", "2026-10-04T10:00:00.000Z", "live"),
      row("r2", "2026-10-03T10:00:00.000Z", "live"),
      row("q", "2026-10-04T10:00:00.000Z", "queued"),
      row("f1", "2026-10-04T10:00:00.000Z", "failed"),
      row("f2", "2026-10-03T10:00:00.000Z", "failed"),
    ];
    expect(todayCounts(rows, NOW)).toEqual({ running: 2, queued: 1, failed: 1 });
  });
});
