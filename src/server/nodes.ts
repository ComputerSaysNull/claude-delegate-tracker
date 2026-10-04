// Node figures over SSH: one open connection per node, one fixed command per poll, each
// host key pinned. Rules: docs/ARCHITECTURE.md "The nodes" and "The model server".
import { readFileSync } from "node:fs";
import { Client } from "ssh2";

export interface NodeTarget {
  name: string;   // the display name
  user: string;
  host: string;
  port: number;
}

// One run of the stats command. The command prints three sections:
//   ==stat     the first line of /proc/stat (`cpu  user nice system idle iowait irq softirq steal …`)
//   ==thermal  one `<type> <millidegrees>` line per thermal zone
//   ==gpu      `<utilization %>, <temperature °C>` from nvidia-smi
export interface StatsReading {
  atMs: number;
  cpu: { idle: number; total: number } | null; // idle = idle + iowait; total = user..steal
  cpuTempC: number | null;   // the hottest zone, one decimal
  gpuPercent: number | null;
  gpuTempC: number | null;
}

export type NodeStatus = "ok" | "unreachable" | "host key refused";

export interface NodeFigures {
  name: string;
  status: NodeStatus;
  cpuPercent: number | null;        // 100 × (1 − Δidle ÷ Δtotal) between two readings, one decimal
  cpuWindowSeconds: number | null;  // the seconds that CPU use was measured over, whole
  cpuTempC: number | null;
  gpuPercent: number | null;
  gpuTempC: number | null;
  readAt: string | null;            // ISO time of the newest good reading, kept while not ok
}

// Parse the command's output. A section that is missing or does not parse gives null for
// its figures; the others still count.
export function parseStats(text: string, atMs: number): StatsReading {
  const sections = new Map<string, string[]>();
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("==")) {
      section = line.slice(2).trim();
      continue;
    }
    if (section === "") continue;
    const lines = sections.get(section);
    if (lines === undefined) sections.set(section, [line]);
    else lines.push(line);
  }

  const cpu = cpuFrom(sections.get("stat"));
  const cpuTempC = thermalFrom(sections.get("thermal"));
  const gpu = gpuFrom(sections.get("gpu"));
  return { atMs, cpu, cpuTempC, gpuPercent: gpu.percent, gpuTempC: gpu.temp };
}

// The aggregate `cpu ` line: idle = idle + iowait; total = user..steal. Missing, too few
// fields, or any non-finite field gives null.
function cpuFrom(lines: string[] | undefined): { idle: number; total: number } | null {
  if (lines === undefined) return null;
  for (const line of lines) {
    if (!line.startsWith("cpu ")) continue;
    const fields = line.split(/\s+/).slice(1).map(Number);
    if (fields.length < 8) return null;
    for (const field of fields) {
      if (!Number.isFinite(field)) return null;
    }
    const idle = fields[3] + fields[4];
    const total = fields[0] + fields[1] + fields[2] + fields[3] + fields[4] + fields[5] + fields[6] + fields[7];
    return { idle, total };
  }
  return null;
}

// The hottest thermal zone, in °C to one decimal, over the zones whose millidegrees parse.
function thermalFrom(lines: string[] | undefined): number | null {
  if (lines === undefined) return null;
  let max: number | null = null;
  for (const line of lines) {
    if (line === "") continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const temp = Number(parts[1]);
    if (!Number.isFinite(temp)) continue;
    if (max === null || temp > max) max = temp;
  }
  return max === null ? null : Math.round(max / 100) / 10;
}

// The first non-empty `utilization, temperature` line; `[N/A]` gives null for that figure.
function gpuFrom(lines: string[] | undefined): { percent: number | null; temp: number | null } {
  if (lines === undefined) return { percent: null, temp: null };
  for (const line of lines) {
    if (line === "") continue;
    const parts = line.split(",");
    const percent = Number(parts[0].trim());
    const temp = parts.length >= 2 ? Number(parts[1].trim()) : NaN;
    return {
      percent: Number.isFinite(percent) ? percent : null,
      temp: Number.isFinite(temp) ? temp : null,
    };
  }
  return { percent: null, temp: null };
}

// Figures from the previous and current good readings. A first reading, or counters that
// went down (the node rebooted), give no CPU use. When status is not "ok", every figure is
// null but readAt keeps the last good reading's time.
export function nodeFiguresFrom(name: string, status: NodeStatus, prev: StatsReading | null,
                                cur: StatsReading | null): NodeFigures {
  if (cur === null) {
    return { name, status, cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, readAt: null };
  }
  const readAt = new Date(cur.atMs).toISOString();
  if (status !== "ok") {
    return { name, status, cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, readAt };
  }
  let cpuPercent: number | null = null;
  let cpuWindowSeconds: number | null = null;
  if (prev !== null && prev.cpu !== null && cur.cpu !== null && cur.atMs > prev.atMs) {
    const deltaTotal = cur.cpu.total - prev.cpu.total;
    const deltaIdle = cur.cpu.idle - prev.cpu.idle;
    if (deltaTotal > 0 && deltaIdle >= 0 && deltaTotal >= 0) {
      cpuPercent = Math.round((1 - deltaIdle / deltaTotal) * 1000) / 10;
      cpuWindowSeconds = Math.round((cur.atMs - prev.atMs) / 1000);
    }
  }
  return {
    name, status,
    cpuPercent, cpuWindowSeconds,
    cpuTempC: cur.cpuTempC,
    gpuPercent: cur.gpuPercent,
    gpuTempC: cur.gpuTempC,
    readAt,
  };
}

// known_hosts lines: `host[,host…] keytype base64key [comment]`; a host may be `[host]:port`.
// Comments, blank lines, `@cert-authority`/`@revoked` lines and hashed (`|1|…`) hosts are
// skipped, so a node listed only that way is refused. The key is keyed by `host` for port
// 22, else `[host]:port`.
export function parseKnownHosts(text: string): Map<string, Buffer[]> {
  const known = new Map<string, Buffer[]>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("@cert-authority") || line.startsWith("@revoked")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;
    const key = Buffer.from(fields[2], "base64");
    for (const host of fields[0].split(",")) {
      const entry = knownHostEntry(host);
      if (entry === null) continue;
      const list = known.get(entry);
      if (list === undefined) known.set(entry, [key]);
      else list.push(key);
    }
  }
  return known;
}

// `[h]:22` normalises to `h`; a plain `h` stays `h`; `[h]:p` stays `[h]:p`; hashed hosts
// (starting with `|`) and malformed entries give null so they are skipped.
function knownHostEntry(host: string): string | null {
  if (host.startsWith("|")) return null;
  const lower = host.toLowerCase();
  if (lower.startsWith("[")) {
    const end = lower.indexOf("]");
    if (end === -1) return lower;
    const inner = lower.slice(1, end);
    const port = lower.slice(end + 1);
    if (port === ":22") return inner;
    return lower;
  }
  return lower;
}

// Accept the node's host key only when its raw blob equals one pinned for that host.
export function hostKeyMatches(known: Map<string, Buffer[]>, host: string, port: number, key: Buffer): boolean {
  const name = port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`;
  const pinned = known.get(name);
  if (pinned === undefined) return false;
  return pinned.some((pinnedKey) => pinnedKey.equals(key));
}

export class HostKeyRefused extends Error {}

// Runs the stats command on one node and returns its output; throws HostKeyRefused when
// the host key does not match, any other error when the node can't be reached.
export interface NodeRunner {
  run(target: NodeTarget): Promise<string>;
  close(): void;
}

export interface SshRunnerDeps {
  keyPath: string;
  knownHostsPath: string;
  timeoutMs: number;
}

// The real runner: one ssh2 connection per node, kept open and reopened after it drops.
export function sshRunner(deps: SshRunnerDeps): NodeRunner {
  const key = readFileSync(deps.keyPath);
  const known = parseKnownHosts(readFileSync(deps.knownHostsPath, "utf8"));
  const connections = new Map<string, Promise<Client>>();

  function connect(target: NodeTarget): Promise<Client> {
    const client = new Client();
    const connection = new Promise<Client>((resolve, reject) => {
      let refused = false;
      client.on("ready", () => resolve(client));
      client.on("error", (err: Error) => {
        if (refused) reject(new HostKeyRefused("host key refused"));
        else reject(err);
      });
      client.on("close", () => {
        // Only forget this connection; a newer one to the same node may have replaced it.
        if (connections.get(target.name) === connection) connections.delete(target.name);
      });
      client.connect({
        host: target.host,
        port: target.port,
        username: target.user,
        privateKey: key,
        readyTimeout: deps.timeoutMs,
        hostVerifier: (hostKey: Buffer) => {
          const ok = hostKeyMatches(known, target.host, target.port, hostKey);
          if (!ok) refused = true;
          return ok;
        },
      });
    });
    connections.set(target.name, connection);
    return connection;
  }

  function getConnection(target: NodeTarget): Promise<Client> {
    const existing = connections.get(target.name);
    return existing === undefined ? connect(target) : existing;
  }

  async function run(target: NodeTarget): Promise<string> {
    let client: Client;
    try {
      client = await getConnection(target);
    } catch (err) {
      connections.delete(target.name);
      throw err;
    }
    return execStats(client, target);
  }

  // Run `stats` on an open connection, collecting stdout until the channel closes. Reject on
  // an exec error, a channel error, or when it takes longer than timeoutMs; any failure ends
  // the client and drops it so the next poll reconnects.
  function execStats(client: Client, target: NodeTarget): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let stdout = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        connections.delete(target.name);
        reject(new Error(`stats timed out after ${deps.timeoutMs}ms`));
      }, deps.timeoutMs);
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(stdout);
      };
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.end();
        connections.delete(target.name);
        reject(err);
      };
      client.exec("stats", (err, stream) => {
        if (err) {
          fail(err);
          return;
        }
        stream.on("data", (chunk: Buffer | string) => {
          stdout += String(chunk);
        });
        stream.on("close", () => succeed());
        stream.on("error", (streamErr: Error) => fail(streamErr));
      });
    });
  }

  function close(): void {
    const open = [...connections.values()];
    connections.clear();
    for (const connection of open) {
      void connection.then((client) => client.end()).catch(() => {});
    }
  }

  return { run, close };
}

export interface NodesDeps {
  targets: NodeTarget[];
  runner: NodeRunner | null;  // null when NODES, NODE_KEY or NODE_KNOWN_HOSTS is not set
  now: () => Date;
}

interface NodeState {
  prev: StatsReading | null;
  last: StatsReading | null;
  status: NodeStatus;
}

// Polls every node at once, on an interval counted from the end of the previous poll.
export class NodesPoller {
  private readonly deps: NodesDeps;
  private readonly listeners = new Set<(figures: NodeFigures[]) => void>();
  private current: NodeFigures[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly nodeStates = new Map<string, NodeState>();

  constructor(deps: NodesDeps) {
    this.deps = deps;
    this.current = deps.targets.map((t) => nodeFiguresFrom(t.name, "unreachable", null, null));
  }

  async poll(): Promise<void> {
    const runner = this.deps.runner;
    if (runner === null) return;
    const results = await Promise.allSettled(this.deps.targets.map((t) => runner.run(t)));
    const now = this.deps.now();
    this.deps.targets.forEach((target, i) => {
      const result = results[i];
      let state = this.nodeStates.get(target.name);
      if (state === undefined) {
        state = { prev: null, last: null, status: "unreachable" };
      }
      if (result.status === "fulfilled") {
        const reading = parseStats(result.value, now.getTime());
        state.prev = state.last;
        state.last = reading;
        state.status = "ok";
      } else if (result.reason instanceof HostKeyRefused) {
        state.status = "host key refused";
      } else {
        state.status = "unreachable";
      }
      this.nodeStates.set(target.name, state);
    });
    const current = this.deps.targets.map((t) => {
      const state = this.nodeStates.get(t.name);
      return nodeFiguresFrom(t.name, state?.status ?? "unreachable", state?.prev ?? null, state?.last ?? null);
    });
    if (JSON.stringify(current) === JSON.stringify(this.current)) return;
    this.current = current;
    for (const listener of this.listeners) listener(current);
  }

  figures(): NodeFigures[] {
    return this.current;
  }

  onChange(listener: (figures: NodeFigures[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(intervalSeconds: number): void {
    this.stop();
    if (this.deps.runner === null || this.deps.targets.length === 0) return;
    this.running = true;
    const tick = async (): Promise<void> => {
      try {
        await this.poll();
      } catch (e) {
        console.error(e);
      }
      if (this.running) this.timer = setTimeout(() => void tick(), intervalSeconds * 1000);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.deps.runner?.close();
  }
}
