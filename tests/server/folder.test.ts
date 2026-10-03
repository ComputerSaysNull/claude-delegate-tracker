import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listNewest, READ_CHUNK, StreamReader } from "../../src/server/folder.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "folder-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listNewest", () => {
  it("orders stamped newest-first, then unstamped; counts all .jsonl", () => {
    for (const name of [
      "20261001T120000.000-a.jsonl",
      "20261002T120000.000-b.jsonl",
      "20261003T120000.000-c.jsonl",
      "zzz-no-stamp.jsonl",
    ]) {
      fs.writeFileSync(path.join(dir, name), "");
    }
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    fs.mkdirSync(path.join(dir, "x.jsonl"));

    const listing = listNewest(dir, 10);
    expect(listing.names).toEqual([
      "20261003T120000.000-c.jsonl",
      "20261002T120000.000-b.jsonl",
      "20261001T120000.000-a.jsonl",
      "zzz-no-stamp.jsonl",
    ]);
    expect(listing.total).toBe(4);
    expect(listing.unstamped).toBe(1);
    expect(listNewest(dir, 2).names).toEqual([
      "20261003T120000.000-c.jsonl",
      "20261002T120000.000-b.jsonl",
    ]);
  });
});

describe("StreamReader", () => {
  it("returns complete lines, then nothing new", () => {
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, "alpha\nbeta\n");
    const r = new StreamReader(p);
    expect(r.read()).toEqual({ lines: ["alpha", "beta"], reset: false });
    expect(r.read()).toEqual({ lines: [], reset: false });
  });

  it("holds a half-written last line until its newline arrives", () => {
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, "one\ntwo\npartial");
    const r = new StreamReader(p);
    expect(r.read().lines).toEqual(["one", "two"]);
    expect(r.read().lines).toEqual([]);
    fs.appendFileSync(p, "\n");
    expect(r.read().lines).toEqual(["partial"]);
  });

  it("decodes a character straddling a chunk boundary exactly", () => {
    const line = "a".repeat(READ_CHUNK - 1) + "€";
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, line + "\n");
    const r = new StreamReader(p);
    const out = r.read();
    expect(out.reset).toBe(false);
    expect(out.lines).toEqual([line]);
  });

  it("returns a line longer than READ_CHUNK whole", () => {
    const line = "a".repeat(READ_CHUNK + 10);
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, line + "\n");
    const r = new StreamReader(p);
    expect(r.read().lines).toEqual([line]);
  });

  it("resets when the file shrank", () => {
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, "alpha\nbeta\n");
    const r = new StreamReader(p);
    expect(r.read().lines).toEqual(["alpha", "beta"]);
    fs.writeFileSync(p, "short\n");
    const out = r.read();
    expect(out.reset).toBe(true);
    expect(out.lines).toEqual(["short"]);
  });

  it("advances offset by consumed bytes and strips CR from CRLF", () => {
    const p = path.join(dir, "s.jsonl");
    fs.writeFileSync(p, "one\r\ntwo\r\n");
    const r = new StreamReader(p);
    const out = r.read();
    expect(out.lines).toEqual(["one", "two"]);
    expect(r.offset).toBe(Buffer.byteLength("one\r\ntwo\r\n"));
  });
});
