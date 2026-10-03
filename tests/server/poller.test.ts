import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Poller } from "../../src/server/poller.ts";
import type { ListResponse } from "../../src/server/poller.ts";

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
      poller.start(0.01);
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
