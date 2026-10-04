// Lists the transcript folder's *.jsonl streams (newest first) and incrementally
// reads appended lines from one stream. Offsets are bytes and decoding happens
// only on complete lines, so a UTF-8 character split across a chunk boundary is
// never decoded in halves.
import fs from "node:fs";

export const STAMP_RE = /^\d{8}T\d{6}\.\d{3}-/;
export const READ_CHUNK = 1024 * 1024;

export interface Listing {
  names: string[];
  all: Set<string>; // every name listed: the only names a URL may ask for
  total: number;
  unstamped: number;
}

export function listNewest(dir: string, limit: number): Listing {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const stamped: string[] = [];
  const unstamped: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    (STAMP_RE.test(entry.name) ? stamped : unstamped).push(entry.name);
  }
  // Stamped names sort by name, which orders the UTC stamp newest first.
  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  stamped.sort(desc);
  unstamped.sort(desc);
  return {
    names: [...stamped, ...unstamped].slice(0, limit),
    all: new Set([...stamped, ...unstamped]),
    total: stamped.length + unstamped.length,
    unstamped: unstamped.length,
  };
}

export class StreamReader {
  readonly path: string;
  offset: number; // bytes consumed so far (always just after a newline)

  constructor(path: string) {
    this.path = path;
    this.offset = 0;
  }

  read(): { lines: string[]; reset: boolean } {
    const size = fs.statSync(this.path).size;
    let reset = false;
    if (size < this.offset) {
      this.offset = 0;
      reset = true;
    }
    const fd = fs.openSync(this.path, "r");
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      let pos = this.offset;
      // Keep reading until EOF so a line longer than one chunk still comes back whole.
      for (;;) {
        const buf = Buffer.allocUnsafe(READ_CHUNK);
        const n = fs.readSync(fd, buf, 0, READ_CHUNK, pos);
        if (n === 0) break;
        chunks.push(buf.subarray(0, n));
        pos += n;
        total += n;
      }
      const data = Buffer.concat(chunks, total);
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl < 0) return { lines: [], reset };
      const consumed = lastNl + 1;
      this.offset += consumed;
      // Bytes between newlines are always whole characters: a UTF-8 continuation
      // byte can never equal 0x0a, so splitting on "\n" never halves a character.
      const lines = data
        .subarray(0, consumed)
        .toString("utf8")
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
        .filter((line) => line !== "");
      return { lines, reset };
    } finally {
      fs.closeSync(fd);
    }
  }
}
