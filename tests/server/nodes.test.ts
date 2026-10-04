// One test per rule in docs/ARCHITECTURE.md "The nodes".
import { describe, expect, it, vi } from "vitest";
import {
  parseStats,
  nodeFiguresFrom,
  parseKnownHosts,
  hostKeyMatches,
  HostKeyRefused,
  NodesPoller,
  type NodeTarget,
  type NodesDeps,
  type StatsReading,
} from "../../src/server/nodes.ts";

const T0 = 1_700_000_000_000;

const FULL_SAMPLE = [
  "==stat",
  "cpu  100 0 50 800 50 0 0 0 0 0",
  "==thermal",
  "acpitz 45000",
  "acpitz 51500",
  "acpitz 38000",
  "==gpu",
  "7, 57",
].join("\n");

const POLL1 = [
  "==stat",
  "cpu  100 0 50 800 50 0 0 0 0 0",
  "==thermal",
  "acpitz 51500",
  "==gpu",
  "7, 57",
].join("\n");

const POLL2 = [
  "==stat",
  "cpu  300 0 200 1200 50 100 100 50 0 0",
  "==thermal",
  "acpitz 54500",
  "==gpu",
  "12, 61",
].join("\n");

describe("parseStats", () => {
  it("parses a full sample into cpu, the hottest zone and gpu", () => {
    const s = parseStats(FULL_SAMPLE, T0);
    expect(s.atMs).toBe(T0);
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.cpuTempC).toBe(51.5);
    expect(s.gpuPercent).toBe(7);
    expect(s.gpuTempC).toBe(57);
  });

  it("does not take a per-cpu line as the aggregate", () => {
    const s = parseStats(
      [
        "==stat",
        "cpu0  100 0 50 800 50 0 0 0 0 0",
        "==thermal",
        "acpitz 45000",
        "==gpu",
        "7, 57",
      ].join("\n"),
      T0,
    );
    expect(s.cpu).toBeNull();
    expect(s.cpuTempC).toBe(45);
    expect(s.gpuPercent).toBe(7);
    expect(s.gpuTempC).toBe(57);
  });

  it("gives gpu null for [N/A] and keeps the rest", () => {
    const s = parseStats(
      [
        "==stat",
        "cpu  100 0 50 800 50 0 0 0 0 0",
        "==thermal",
        "acpitz 51500",
        "==gpu",
        "[N/A], [N/A]",
      ].join("\n"),
      T0,
    );
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.cpuTempC).toBe(51.5);
    expect(s.gpuPercent).toBeNull();
    expect(s.gpuTempC).toBeNull();
  });

  it("gives gpu null when the gpu section is missing", () => {
    const s = parseStats(
      ["==stat", "cpu  100 0 50 800 50 0 0 0 0 0", "==thermal", "acpitz 51500"].join("\n"),
      T0,
    );
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.cpuTempC).toBe(51.5);
    expect(s.gpuPercent).toBeNull();
    expect(s.gpuTempC).toBeNull();
  });

  it("ignores a thermal line whose value is not a number", () => {
    const s = parseStats(
      ["==thermal", "acpitz 45000", "acpitz abc", "acpitz 51500"].join("\n"),
      T0,
    );
    expect(s.cpuTempC).toBe(51.5);
  });

  it("gives cpu null when the stat line has too few fields", () => {
    const s = parseStats(
      ["==stat", "cpu 100 0 50", "==thermal", "acpitz 51500"].join("\n"),
      T0,
    );
    expect(s.cpu).toBeNull();
    expect(s.cpuTempC).toBe(51.5);
  });

  it("gives all null for empty text", () => {
    expect(parseStats("", T0)).toEqual({
      atMs: T0,
      cpu: null,
      cpuTempC: null,
      gpuPercent: null,
      gpuTempC: null,
    });
  });
});

const reading = (
  atMs: number,
  cpu: { idle: number; total: number } | null,
  cpuTempC: number | null,
  gpuPercent: number | null,
  gpuTempC: number | null,
): StatsReading => ({ atMs, cpu, cpuTempC, gpuPercent, gpuTempC });

describe("nodeFiguresFrom", () => {
  it("returns all null when cur is null", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, null);
    expect(f.status).toBe("ok");
    expect(f.cpuPercent).toBeNull();
    expect(f.cpuWindowSeconds).toBeNull();
    expect(f.cpuTempC).toBeNull();
    expect(f.gpuPercent).toBeNull();
    expect(f.gpuTempC).toBeNull();
    expect(f.readAt).toBeNull();
  });

  it("a first reading gives no cpu use but keeps temps and gpu", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, { idle: 850, total: 1000 }, 51.5, 7, 57));
    expect(f.status).toBe("ok");
    expect(f.cpuPercent).toBeNull();
    expect(f.cpuWindowSeconds).toBeNull();
    expect(f.cpuTempC).toBe(51.5);
    expect(f.gpuPercent).toBe(7);
    expect(f.gpuTempC).toBe(57);
    expect(f.readAt).toBe(new Date(T0).toISOString());
  });

  it("cpu use is 100 × (1 − Δidle ÷ Δtotal), here 60% over 5 s", () => {
    const prev = reading(T0, { idle: 850, total: 1000 }, 51.5, 7, 57);
    const cur = reading(T0 + 5000, { idle: 1250, total: 2000 }, 54.5, 12, 61);
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.cpuPercent).toBe(60);
    expect(f.cpuWindowSeconds).toBe(5);
  });

  it("counters that went down give no cpu use, but the gauges stay", () => {
    const prev = reading(T0, { idle: 850, total: 1000 }, 51.5, 7, 57);
    const cur = reading(T0 + 5000, { idle: 100, total: 200 }, 51.5, 7, 57);
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.cpuPercent).toBeNull();
    expect(f.cpuWindowSeconds).toBeNull();
    expect(f.cpuTempC).toBe(51.5);
    expect(f.gpuPercent).toBe(7);
    expect(f.gpuTempC).toBe(57);
    expect(f.readAt).toBe(new Date(T0 + 5000).toISOString());
  });

  it("a measured gpu use of 0 stays 0", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, { idle: 850, total: 1000 }, 51.5, 0, 57));
    expect(f.gpuPercent).toBe(0);
    expect(f.gpuTempC).toBe(57);
  });

  it("unreachable and host key refused give all null figures but keep readAt", () => {
    const cur = reading(T0, { idle: 850, total: 1000 }, 51.5, 7, 57);
    for (const status of ["unreachable", "host key refused"] as const) {
      const f = nodeFiguresFrom("node-a", status, null, cur);
      expect(f.status).toBe(status);
      expect(f.cpuPercent).toBeNull();
      expect(f.cpuWindowSeconds).toBeNull();
      expect(f.cpuTempC).toBeNull();
      expect(f.gpuPercent).toBeNull();
      expect(f.gpuTempC).toBeNull();
      expect(f.readAt).toBe(new Date(T0).toISOString());
    }
  });
});

describe("parseKnownHosts and hostKeyMatches", () => {
  const key1 = Buffer.from("key-one");
  const key2 = Buffer.from("key-two");
  const key3 = Buffer.from("key-three");
  const b64 = (k: Buffer): string => k.toString("base64");

  it("accepts the matching blob of any pinned key type and refuses a different blob", () => {
    const known = parseKnownHosts(
      [
        `node-a.example ssh-ed25519 ${b64(key1)}`,
        `node-a.example ssh-rsa ${b64(key2)}`,
        `node-a.example ecdsa-sha2-nistp256 ${b64(key3)}`,
      ].join("\n"),
    );
    expect(hostKeyMatches(known, "node-a.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "node-a.example", 22, key2)).toBe(true);
    expect(hostKeyMatches(known, "node-a.example", 22, key3)).toBe(true);
    expect(hostKeyMatches(known, "node-a.example", 22, Buffer.from("key-four"))).toBe(false);
  });

  it("a comma-separated host list pins both hosts", () => {
    const known = parseKnownHosts(`a.example,b.example ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "a.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "b.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "c.example", 22, key1)).toBe(false);
  });

  it("[c.example]:2222 pins only port 2222", () => {
    const known = parseKnownHosts(`[c.example]:2222 ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "c.example", 2222, key1)).toBe(true);
    expect(hostKeyMatches(known, "c.example", 22, key1)).toBe(false);
  });

  it("[d.example]:22 counts as port 22", () => {
    const known = parseKnownHosts(`[d.example]:22 ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "d.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "d.example", 2222, key1)).toBe(false);
  });

  it("host names are case-insensitive", () => {
    const known = parseKnownHosts(`node-a.example ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "NODE-A.EXAMPLE", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "node-a.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "node-b.example", 22, key1)).toBe(false);
  });

  it("host names in the known_hosts file are case-insensitive too", () => {
    const known = parseKnownHosts(`Node-A.Example,[NODE-C.example]:2222 ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "node-a.example", 22, key1)).toBe(true);
    expect(hostKeyMatches(known, "node-c.example", 2222, key1)).toBe(true);
  });

  it("hashed, @revoked, comment and blank lines pin nothing", () => {
    const known = parseKnownHosts(
      [
        `|1|abc123|def456 ssh-ed25519 ${b64(key1)}`,
        `@revoked node-a.example ssh-ed25519 ${b64(key2)}`,
        "# a comment",
        "",
        "",
      ].join("\n"),
    );
    expect(hostKeyMatches(known, "node-a.example", 22, key1)).toBe(false);
    expect(hostKeyMatches(known, "node-a.example", 22, key2)).toBe(false);
  });

  it("an unknown host is refused", () => {
    const known = parseKnownHosts(`node-a.example ssh-ed25519 ${b64(key1)}`);
    expect(hostKeyMatches(known, "node-z.example", 22, key1)).toBe(false);
  });

  it("skips a line with fewer than three fields", () => {
    const known = parseKnownHosts(
      [
        "node-a.example ssh-ed25519",
        "node-b.example",
        `node-c.example ssh-ed25519 ${b64(key1)}`,
      ].join("\n"),
    );
    expect(hostKeyMatches(known, "node-a.example", 22, key1)).toBe(false);
    expect(hostKeyMatches(known, "node-b.example", 22, key1)).toBe(false);
    expect(hostKeyMatches(known, "node-c.example", 22, key1)).toBe(true);
  });
});

describe("NodesPoller", () => {
  function makePoller(over: Partial<NodesDeps> = {}) {
    let body = "";
    let failure: Error | null = null;
    let t = T0;
    const run = vi.fn(async (target: NodeTarget): Promise<string> => {
      void target;
      if (failure !== null) throw failure;
      return body;
    });
    const close = vi.fn();
    const poller = new NodesPoller({
      targets: [{ name: "node-a", user: "u", host: "node-a.example", port: 22 }],
      runner: { run, close },
      now: (): Date => new Date(t),
      ...over,
    });
    return {
      poller,
      run,
      close,
      body(v: string): void { body = v; },
      fail(e: Error): void { failure = e; },
      advance(ms: number): void { t += ms; },
    };
  }

  it("runner null leaves the built figures and never polls", async () => {
    const p = makePoller({ runner: null });
    await p.poller.poll();
    expect(p.poller.figures()).toEqual([
      { name: "node-a", status: "unreachable", cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, readAt: null },
    ]);
  });

  it("two good polls give ok with a cpuPercent", async () => {
    const p = makePoller();
    p.body(POLL1);
    await p.poller.poll();
    expect(p.poller.figures()[0].status).toBe("ok");
    expect(p.poller.figures()[0].cpuPercent).toBeNull();
    expect(p.poller.figures()[0].readAt).toBe(new Date(T0).toISOString());
    p.advance(5000);
    p.body(POLL2);
    await p.poller.poll();
    const f = p.poller.figures()[0];
    expect(f.status).toBe("ok");
    expect(f.cpuPercent).toBe(60);
    expect(f.cpuWindowSeconds).toBe(5);
    expect(f.cpuTempC).toBe(54.5);
    expect(f.gpuPercent).toBe(12);
    expect(f.gpuTempC).toBe(61);
    expect(p.run).toHaveBeenCalledTimes(2);
  });

  it("a HostKeyRefused error gives host key refused", async () => {
    const p = makePoller();
    p.fail(new HostKeyRefused("x"));
    await p.poller.poll();
    expect(p.poller.figures()[0].status).toBe("host key refused");
    expect(p.run).toHaveBeenCalledTimes(1);
  });

  it("a generic error gives unreachable and keeps the last readAt", async () => {
    const p = makePoller();
    p.body(POLL1);
    await p.poller.poll();
    expect(p.poller.figures()[0].status).toBe("ok");
    const good = p.poller.figures()[0].readAt;
    expect(good).not.toBeNull();
    p.fail(new Error("boom"));
    await p.poller.poll();
    const f = p.poller.figures()[0];
    expect(f.status).toBe("unreachable");
    expect(f.readAt).toBe(good);
    expect(f.cpuPercent).toBeNull();
    expect(f.cpuTempC).toBeNull();
    expect(f.gpuPercent).toBeNull();
    expect(f.gpuTempC).toBeNull();
  });

  it("one node failing does not affect the other", async () => {
    const p = makePoller({
      targets: [
        { name: "node-a", user: "u", host: "node-a.example", port: 22 },
        { name: "node-b", user: "u", host: "node-b.example", port: 22 },
      ],
      runner: {
        run: vi.fn(async (t: NodeTarget): Promise<string> => {
          if (t.name === "node-b") throw new Error("boom");
          return POLL1;
        }),
        close: vi.fn(),
      },
    });
    await p.poller.poll();
    const [a, b] = p.poller.figures();
    expect(a.status).toBe("ok");
    expect(a.cpuTempC).toBe(51.5);
    expect(b.status).toBe("unreachable");
    expect(b.cpuTempC).toBeNull();
  });

  it("onChange fires on a change and not on an identical repeat", async () => {
    const p = makePoller();
    p.body("==thermal\nacpitz 51500\n==gpu\n7, 57");
    let fired = 0;
    p.poller.onChange(() => { fired += 1; });
    await p.poller.poll();
    expect(fired).toBe(1);
    await p.poller.poll();
    expect(fired).toBe(1);
    p.advance(10_000);
    p.body("==thermal\nacpitz 54500\n==gpu\n12, 61");
    await p.poller.poll();
    expect(fired).toBe(2);
  });

  it("stop closes the runner", () => {
    const p = makePoller();
    p.poller.stop();
    expect(p.close).toHaveBeenCalledTimes(1);
  });
});
