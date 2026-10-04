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
