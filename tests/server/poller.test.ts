import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Poller } from "../../src/server/poller.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import { buildView } from "../../src/server/view.ts";
import type { ViewPatch } from "../../src/server/view.ts";

vi.mock("../../src/server/view.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/view.ts")>();
  return { ...actual, buildView: vi.fn(actual.buildView) };
});

const NOW = new Date("2026-10-03T12:00:00.000Z");

function startEvent(at: string): Record<string, unknown> {
  return { t: "start", at, format: "1.1", tool: "delegate", task: "T", model_key: "m", effort: "low", max_turns: 4, tools: ["read_file"] };
}

function endEvent(at: string, ok = true): Record<string, unknown> {
  return { t: "end", at, ok, turns: 1, max_turns: 4, elapsed_seconds: 5, finish_reason: "stop" };
}

function writeStream(dir: string, name: string, events: Record<string, unknown>[]): void {
  writeFileSync(join(dir, name), events.map((e) => JSON.stringify(e) + "\n").join(""));
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "poller-"));
}

function makePoller(dir: string | null): Poller {
  return new Poller({ dir, quietAfterSeconds: 60, now: () => NOW });
}

function makeStream(dir: string, name: string, at: string): string {
  writeStream(dir, name, [startEvent(at), endEvent(at)]);
  return name;
}

describe("poller", () => {
  it("dir null means not readable and no rows", () => {
    const poller = makePoller(null);
    poller.pass();
    const list = poller.list();
    expect(list.folderReadable).toBe(false);
    expect(list.rows).toEqual([]);
    expect(list.total).toBe(0);
  });

  it("a missing folder is reported as not readable", () => {
    const dir = join(tmpdir(), `poller-missing-${Date.now()}-${Math.random()}`);
    const poller = makePoller(dir);
    poller.pass();
    const list = poller.list();
    expect(list.folderReadable).toBe(false);
    expect(list.rows).toEqual([]);
  });

  it("keeps the previous rows when the folder becomes unreadable", () => {
    const dir = makeDir();
    try {
      const name = makeStream(dir, "20261001T120000.000-a.jsonl", "2026-10-01T12:00:00.000Z");
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.list().folderReadable).toBe(true);
      expect(poller.list().rows).toHaveLength(1);

      const moved = `${dir}-away`;
      renameSync(dir, moved);
      poller.pass();

      const list = poller.list();
      expect(list.folderReadable).toBe(false);
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0].name).toBe(name);
    } finally {
      rmSync(`${dir}-away`, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orders rows by start.at, not by name", () => {
    const dir = makeDir();
    try {
      // Names sort newest-first as 03, 02, 01; start.at is the opposite order.
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-03T12:00:00.000Z"), endEvent("2026-10-03T12:00:05.000Z")]);
      writeStream(dir, "20261002T120000.000-b.jsonl", [startEvent("2026-10-02T12:00:00.000Z"), endEvent("2026-10-02T12:00:05.000Z")]);
      writeStream(dir, "20261003T120000.000-c.jsonl", [startEvent("2026-10-01T12:00:00.000Z"), endEvent("2026-10-01T12:00:05.000Z")]);
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.list().rows.map((r) => r.name)).toEqual([
        "20261001T120000.000-a.jsonl",
        "20261002T120000.000-b.jsonl",
        "20261003T120000.000-c.jsonl",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps at LIST_LIMIT and reflects total and unstamped", () => {
    const dir = makeDir();
    try {
      for (let i = 1; i <= 22; i++) {
        const day = String(i).padStart(2, "0");
        writeStream(dir, `202610${day}T120000.000-f${i}.jsonl`, [startEvent(`2026-10-${day}T12:00:00.000Z`), endEvent(`2026-10-${day}T12:00:05.000Z`)]);
      }
      // One file without a name stamp.
      writeStream(dir, "notes.jsonl", []);
      const poller = makePoller(dir);
      poller.pass();
      const list = poller.list();
      expect(list.rows).toHaveLength(20);
      expect(list.capped).toBe(true);
      expect(list.total).toBe(23);
      expect(list.unstamped).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports not capped for a small folder", () => {
    const dir = makeDir();
    try {
      for (const [name, at] of [
        ["20261001T120000.000-a.jsonl", "2026-10-01T12:00:00.000Z"],
        ["20261002T120000.000-b.jsonl", "2026-10-02T12:00:00.000Z"],
        ["20261003T120000.000-c.jsonl", "2026-10-03T12:00:00.000Z"],
      ] as const) {
        writeStream(dir, name, [startEvent(at), endEvent(at)]);
      }
      const poller = makePoller(dir);
      poller.pass();
      const list = poller.list();
      expect(list.capped).toBe(false);
      expect(list.rows).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sees an appended line on the next pass", () => {
    const dir = makeDir();
    try {
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-01T12:00:00.000Z")]);
      const poller = makePoller(dir);
      poller.pass();
      const before = JSON.stringify(poller.list().rows[0]);
      appendFileSync(join(dir, "20261001T120000.000-a.jsonl"), JSON.stringify(endEvent("2026-10-01T12:00:05.000Z")) + "\n");
      poller.pass();
      expect(JSON.stringify(poller.list().rows[0])).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not re-read a finished stream", () => {
    const dir = makeDir();
    try {
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-01T12:00:00.000Z"), endEvent("2026-10-01T12:00:05.000Z")]);
      const poller = makePoller(dir);
      poller.pass();
      const before = JSON.stringify(poller.list().rows[0]);
      const badBefore = poller.list().badLines;
      appendFileSync(join(dir, "20261001T120000.000-a.jsonl"),
        JSON.stringify(endEvent("2026-10-01T12:00:06.000Z", false)) + "\n" + "this is not json\n");
      poller.pass();
      expect(JSON.stringify(poller.list().rows[0])).toBe(before);
      expect(poller.list().badLines).toBe(badBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops a deleted file without throwing", () => {
    const dir = makeDir();
    try {
      const a = makeStream(dir, "20261001T120000.000-a.jsonl", "2026-10-01T12:00:00.000Z");
      makeStream(dir, "20261002T120000.000-b.jsonl", "2026-10-02T12:00:00.000Z");
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.list().rows).toHaveLength(2);
      rmSync(join(dir, "20261002T120000.000-b.jsonl"));
      expect(() => poller.pass()).not.toThrow();
      const list = poller.list();
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0].name).toBe(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("notifies on change only, and unsubscribe stops it", () => {
    const dir = makeDir();
    try {
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-01T12:00:00.000Z")]);
      const poller = makePoller(dir);
      const seen: ListResponse[] = [];
      const off = poller.onChange((l) => seen.push(l));
      poller.pass();
      expect(seen).toHaveLength(1);
      poller.pass();
      expect(seen).toHaveLength(1);
      appendFileSync(join(dir, "20261001T120000.000-a.jsonl"), JSON.stringify(endEvent("2026-10-01T12:00:05.000Z")) + "\n");
      poller.pass();
      expect(seen).toHaveLength(2);
      off();
      appendFileSync(join(dir, "20261001T120000.000-a.jsonl"), "another line\n");
      poller.pass();
      expect(seen).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs passes on an interval and stop ends them", () => {
    vi.useFakeTimers();
    const dir = makeDir();
    try {
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-01T12:00:00.000Z")]);
      const poller = makePoller(dir);
      const passSpy = vi.spyOn(poller, "pass");
      poller.start(0.01, 0.01);
      expect(passSpy).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      const afterAdvance = passSpy.mock.calls.length;
      expect(afterAdvance).toBeGreaterThan(1);
      poller.stop();
      vi.advanceTimersByTime(100);
      expect(passSpy.mock.calls.length).toBe(afterAdvance);
    } finally {
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("follow and view", () => {
  it("view() returns null for a name the listing did not hold, even one outside the folder", () => {
    const parent = makeDir();
    const dir = join(parent, "in");
    mkdirSync(dir);
    try {
      writeStream(dir, "20261001T120000.000-a.jsonl", [startEvent("2026-10-01T12:00:00.000Z"), endEvent("2026-10-01T12:00:05.000Z")]);
      writeFileSync(join(parent, "secret.jsonl"), "SECRET");
      const poller = makePoller(dir);
      poller.pass();
      // ../secret.jsonl is a real file just outside the folder; the name is still unknown.
      expect(poller.view("../secret.jsonl")).toBeNull();
      expect(poller.view("20260901T120000.000-unknown.jsonl")).toBeNull();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("returns a listed name's view with its name and seq 1 after a pass", () => {
    const dir = makeDir();
    try {
      const name = makeStream(dir, "20261001T120000.000-a.jsonl", "2026-10-01T12:00:00.000Z");
      const poller = makePoller(dir);
      poller.pass();
      const view = poller.view(name);
      expect(view).not.toBeNull();
      expect(view!.name).toBe(name);
      expect(view!.seq).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still lets an older stream, not among the newest 25, be viewed by name", () => {
    const dir = makeDir();
    try {
      for (let i = 1; i <= 26; i++) {
        const day = String(i).padStart(2, "0");
        writeStream(dir, `202610${day}T120000.000-n${i}.jsonl`, [startEvent(`2026-10-${day}T12:00:00.000Z`), endEvent(`2026-10-${day}T12:00:05.000Z`)]);
      }
      const older = "20260930T120000.000-old.jsonl";
      writeStream(dir, older, [startEvent("2026-09-30T12:00:00.000Z"), endEvent("2026-09-30T12:00:05.000Z")]);
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.list().rows.some((r) => r.name === older)).toBe(false);
      const view = poller.view(older);
      expect(view).not.toBeNull();
      expect(view!.name).toBe(older);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follow() returns null for an unknown name and delivers a seq-2 patch after an initial view", () => {
    const dir = makeDir();
    try {
      const name = "20261001T120000.000-a.jsonl";
      writeStream(dir, name, [startEvent("2026-10-01T12:00:00.000Z")]); // still open
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.follow("unknown", () => {})).toBeNull();

      const patches: ViewPatch[] = [];
      const off = poller.follow(name, (p) => patches.push(p));
      expect(off).not.toBeNull();

      // The initial view is numbered 1 and delivered to the follower.
      expect(poller.view(name)).toMatchObject({ name, seq: 1 });
      expect(patches[patches.length - 1].seq).toBe(1);

      appendFileSync(join(dir, name), JSON.stringify(endEvent("2026-10-01T12:00:05.000Z")) + "\n");
      poller.followPass();
      expect(patches[patches.length - 1]).toMatchObject({ name, seq: 2 });

      // A followPass with no change delivers nothing more.
      poller.followPass();
      expect(patches).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a followed stream that leaves the newest 25 and drops it after unfollow", () => {
    const dir = makeDir();
    try {
      const target = "20260930T120000.000-target.jsonl";
      writeStream(dir, target, [startEvent("2026-09-30T12:00:00.000Z")]); // still open
      const poller = makePoller(dir);
      poller.pass();

      const patches: ViewPatch[] = [];
      const off = poller.follow(target, (p) => patches.push(p));
      expect(off).not.toBeNull();

      for (let i = 1; i <= 26; i++) {
        const day = String(i).padStart(2, "0");
        writeStream(dir, `202610${day}T120000.000-n${i}.jsonl`, [startEvent(`2026-10-${day}T12:00:00.000Z`)]);
      }
      poller.pass();
      expect(poller.list().rows.some((r) => r.name === target)).toBe(false);

      appendFileSync(join(dir, target), JSON.stringify(endEvent("2026-09-30T12:00:05.000Z")) + "\n");
      poller.followPass();
      expect(patches[patches.length - 1]).toMatchObject({ name: target, seq: 2 });

      off!();
      poller.pass();
      // The name stays known even though the entry was dropped.
      expect(poller.view(target)).not.toBeNull();
      expect(poller.view(target)!.name).toBe(target);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not build a view for a stream nobody follows or views", () => {
    vi.mocked(buildView).mockClear();
    const dir = makeDir();
    try {
      const a = "20261001T120000.000-a.jsonl";
      const b = "20261002T120000.000-b.jsonl";
      writeStream(dir, a, [startEvent("2026-10-01T12:00:00.000Z")]);
      writeStream(dir, b, [startEvent("2026-10-02T12:00:00.000Z")]);
      const poller = makePoller(dir);
      poller.pass();
      poller.follow(b, () => {});
      poller.pass();
      const built = vi.mocked(buildView).mock.calls.map((c) => c[0]);
      expect(built).toContain(b);
      expect(built).not.toContain(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("health inputs", () => {
  const A = "20261003T115950.000-a.jsonl";

  it("counts events that fail the schema check, and still uses them", () => {
    const dir = makeDir();
    try {
      writeStream(dir, A, [startEvent("2026-10-03T11:59:50.000Z"), { t: "turn", at: "2026-10-03T11:59:55.000Z", turn: "not a number" }, endEvent("2026-10-03T11:59:58.000Z")]);
      const poller = new Poller({
        dir, quietAfterSeconds: 60, now: () => NOW,
        schemaCheck: (evt) => typeof evt.turn !== "string",
      });
      poller.pass();
      expect(poller.list().schemaFailures).toBe(1);
      expect(poller.list().rows[0].state).toBe("ok"); // the end after it still counted
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts no schema failures without a schema check", () => {
    const dir = makeDir();
    try {
      writeStream(dir, A, [startEvent("2026-10-03T11:59:50.000Z"), { t: "turn", at: "2026-10-03T11:59:55.000Z", turn: "x" }]);
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.list().schemaFailures).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("measures clock skew only on lines that appeared since the previous read", () => {
    const dir = makeDir();
    try {
      // An old file's lines on the first read say nothing about the clocks.
      writeStream(dir, A, [startEvent("2026-10-01T00:00:00.000Z")]);
      let now = NOW;
      const poller = new Poller({ dir, quietAfterSeconds: 60, now: () => now });
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBeNull();
      // A fresh line stamped 9 s before "now": the WSL clock is behind.
      appendFileSync(join(dir, A), JSON.stringify({ t: "alive", at: "2026-10-03T11:59:51.000Z" }) + "\n");
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBe(9);
      // With nothing new, the last reading is kept.
      now = new Date(NOW.getTime() + 60_000);
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBe(9);
      // A fresh line stamped 7 s after "now": the WSL clock is ahead.
      appendFileSync(join(dir, A), JSON.stringify({ t: "alive", at: "2026-10-03T12:01:07.000Z" }) + "\n");
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBe(-7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not measure skew on a replaced file's lines, which are read again from the start", () => {
    const dir = makeDir();
    try {
      writeStream(dir, A, [startEvent("2026-10-03T11:59:50.000Z"), { t: "alive", at: "2026-10-03T11:59:52.000Z" }]);
      const poller = makePoller(dir);
      poller.pass();
      appendFileSync(join(dir, A), JSON.stringify({ t: "alive", at: "2026-10-03T11:59:58.000Z" }) + "\n");
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBe(2);
      // The sync client replaces the file with a shorter, older copy.
      writeStream(dir, A, [startEvent("2026-10-01T00:00:00.000Z")]);
      poller.pass();
      expect(poller.status().clockSkewSeconds).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("backs off 1, 2, 4 … 30 s while the folder can't be read, and resets once it can", () => {
    const dir = makeDir();
    try {
      makeStream(dir, A, "2026-10-03T11:59:50.000Z");
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.status().retryInSeconds).toBeNull();
      const moved = `${dir}-away`;
      renameSync(dir, moved);
      const waits: (number | null)[] = [];
      for (let i = 0; i < 7; i++) {
        poller.pass();
        waits.push(poller.status().retryInSeconds);
      }
      expect(waits).toEqual([1, 2, 4, 8, 16, 30, 30]);
      renameSync(moved, dir);
      poller.pass();
      expect(poller.status().retryInSeconds).toBeNull();
      // A later outage starts again from 1 s.
      renameSync(dir, moved);
      poller.pass();
      expect(poller.status().retryInSeconds).toBe(1);
      renameSync(moved, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(`${dir}-away`, { recursive: true, force: true });
    }
  });

  it("tells status listeners when the status changes, and only then", () => {
    const dir = makeDir();
    try {
      makeStream(dir, A, "2026-10-03T11:59:50.000Z");
      const poller = makePoller(dir);
      const seen: unknown[] = [];
      poller.onStatus((s) => seen.push(s));
      poller.pass();
      poller.pass();
      expect(seen).toEqual([]);
      const moved = `${dir}-away`;
      renameSync(dir, moved);
      poller.pass();
      expect(seen).toEqual([{ clockSkewSeconds: null, retryInSeconds: 1 }]);
      renameSync(moved, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(`${dir}-away`, { recursive: true, force: true });
    }
  });
});

describe("history", () => {
  // 45 finished streams, one a minute; names sort newest first.
  function fill(dir: string, count: number): string[] {
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const at = new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString();
      const stamp = at.replace(/[-:]/g, "").replace("Z", "").replace(/\.(\d{3})$/, ".$1");
      names.push(makeStream(dir, `${stamp}-s${i}.jsonl`, at));
    }
    return names.reverse(); // newest first
  }

  it("pages back from a listed name, 20 at a time, newest first, without repeating", () => {
    const dir = makeDir();
    try {
      const names = fill(dir, 45);
      const poller = makePoller(dir);
      poller.pass();
      const live = poller.list().rows.map((r) => r.name);
      expect(live).toEqual(names.slice(0, 20));
      const page1 = poller.history(live[live.length - 1]);
      expect(page1?.rows.map((r) => r.name)).toEqual(names.slice(20, 40));
      expect(page1?.nextBefore).toBe(names[39]);
      const page2 = poller.history(page1!.nextBefore!);
      expect(page2?.rows.map((r) => r.name)).toEqual(names.slice(40, 45));
      expect(page2?.nextBefore).toBeNull();
      expect(page2?.rows[0].state).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a cursor the folder listing did not hold, even a path that exists", () => {
    const dir = makeDir();
    try {
      fill(dir, 3);
      writeFileSync(join(dir, "..", "outside.jsonl"), "");
      const poller = makePoller(dir);
      poller.pass();
      expect(poller.history("nope.jsonl")).toBeNull();
      expect(poller.history("../outside.jsonl")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(join(dir, "..", "outside.jsonl"), { force: true });
    }
  });

  it("reads older streams on request only: they get no reader that keeps polling", () => {
    const dir = makeDir();
    try {
      const names = fill(dir, 30);
      const poller = makePoller(dir);
      poller.pass();
      poller.history(names[19]);
      // An older stream that grows is not re-read by the next pass: it was never listed live.
      appendFileSync(join(dir, names[25]), JSON.stringify(startEvent("2026-10-03T12:00:00.000Z")) + "\n");
      poller.pass();
      expect(poller.list().rows.map((r) => r.name)).not.toContain(names[25]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
