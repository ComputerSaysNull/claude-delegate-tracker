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

// One run of the stats command. The command prints sections:
//   ==stat     the first line of /proc/stat (`cpu  user nice system idle iowait irq softirq steal …`)
//   ==thermal  one `<type> <millidegrees>` line per thermal zone
//   ==gpu      `<utilization %>, <temperature °C>` from nvidia-smi
//   ==mem      `MemTotal:` and `MemAvailable:` lines, in kB
//   ==power    the GPU power draw, one line in watts
//   ==disk     the df line, then one line per block device
//   ==net      one line per interface: 8 rx fields then 8 tx fields
//   ==link     one line per interface with its state
//   ==rdma     the RDMA device→interface mapping, then per-port state/rate/counter lines
// One RDMA port on the nodes' interconnect that maps to a network interface. Counters the node
// did not report are null; `errors` is the sum of the error counters that are present.
export interface RdmaPort {
  id: string;            // "<dev>/<n>"
  up: boolean;           // state is ACTIVE; false when the state line is missing
  gbps: number | null;   // from rate
  rxWords: number | null;
  txWords: number | null;
  errors: number | null; // sum of port_rcv_errors, port_xmit_discards, link_downed, out_of_buffer
}

export interface StatsReading {
  atMs: number;
  cpu: { idle: number; total: number } | null; // idle = idle + iowait; total = user..steal
  cpuTempC: number | null;   // the hottest zone, one decimal
  gpuPercent: number | null;
  gpuTempC: number | null;
  memTotalBytes: number | null;     // `==mem` MemTotal, in bytes
  memAvailableBytes: number | null; // `==mem` MemAvailable, in bytes
  gpuPowerW: number | null;         // `==power`, in watts
  disk: { sizeBytes: number; usedBytes: number } | null;         // the df line
  diskIo: { readSectors: number; writtenSectors: number } | null; // summed per device
  net: { rxBytes: number; txBytes: number } | null;               // summed, tunnels left out
  rdma: RdmaPort[] | null;                                        // RDMA ports mapped to interfaces
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
  memUsedPercent: number | null;    // 100 × (total − available) ÷ total, one decimal
  memAvailableBytes: number | null; // `==mem` MemAvailable, in bytes
  gpuPowerW: number | null;         // `==power`, in watts
  diskUsedPercent: number | null;   // 100 × used ÷ size, one decimal
  diskReadBps: number | null;       // Δsectors × 512 ÷ Δs, whole bytes/s
  diskWriteBps: number | null;      // Δsectors × 512 ÷ Δs, whole bytes/s
  netRxBps: number | null;          // Δbytes ÷ Δs, whole bytes/s
  netTxBps: number | null;          // Δbytes ÷ Δs, whole bytes/s
  linkPortsUp: number | null;       // link ports up in this reading
  linkPortsSeenUp: number | null;   // link ports seen up in any reading since the tracker started
  linkDown: boolean | null;         // a port seen up earlier is not up now, or no link port is up
  linkGbps: number | null;          // the highest rate among the ports that are up; null when none is up
  linkRxBps: number | null;         // Σ over up ports of Δrx words × 4 ÷ Δs, whole bytes/s
  linkTxBps: number | null;         // same for tx
  linkDropsRising: boolean | null;  // the errors sum over all link ports rose since the previous reading
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
  const mem = memFrom(sections.get("mem"));
  const gpuPowerW = powerFrom(sections.get("power"));
  const disk = diskFrom(sections.get("disk"));
  const diskIo = diskIoFrom(sections.get("disk"));
  const net = netFrom(sections.get("net"), sections.get("link"));
  const rdma = rdmaFrom(sections.get("rdma"));
  return {
    atMs, cpu, cpuTempC,
    gpuPercent: gpu.percent,
    gpuTempC: gpu.temp,
    memTotalBytes: mem.totalBytes,
    memAvailableBytes: mem.availableBytes,
    gpuPowerW,
    disk,
    diskIo,
    net,
    rdma,
  };
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

// The `MemTotal:` and `MemAvailable:` lines, in kB, × 1024 to bytes. A missing or non-numeric
// line leaves that figure null.
function memFrom(lines: string[] | undefined): { totalBytes: number | null; availableBytes: number | null } {
  const out: { totalBytes: number | null; availableBytes: number | null } = { totalBytes: null, availableBytes: null };
  if (lines === undefined) return out;
  for (const line of lines) {
    if (line === "") continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "MemTotal:") {
      const kb = Number(parts[1]);
      if (Number.isFinite(kb)) out.totalBytes = kb * 1024;
    } else if (parts[0] === "MemAvailable:") {
      const kb = Number(parts[1]);
      if (Number.isFinite(kb)) out.availableBytes = kb * 1024;
    }
  }
  return out;
}

// The first non-empty power line as a number; `[N/A]` or a missing section gives null.
function powerFrom(lines: string[] | undefined): number | null {
  if (lines === undefined) return null;
  for (const line of lines) {
    if (line === "") continue;
    const n = Number(line);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// The df line: exactly two numeric fields, size then used. Otherwise null.
function diskFrom(lines: string[] | undefined): { sizeBytes: number; usedBytes: number } | null {
  if (lines === undefined) return null;
  for (const line of lines) {
    if (line === "") continue;
    const fields = line.split(/\s+/);
    if (fields.length !== 2) continue;
    const sizeBytes = Number(fields[0]);
    const usedBytes = Number(fields[1]);
    if (Number.isFinite(sizeBytes) && Number.isFinite(usedBytes)) {
      return { sizeBytes, usedBytes };
    }
  }
  return null;
}

// Summed sectors over the per-device disk lines (at least 10 fields, a device name in the
// 3rd): read sectors the 6th field (index 5), written the 10th (index 9). No such line
// gives null.
function diskIoFrom(lines: string[] | undefined): { readSectors: number; writtenSectors: number } | null {
  if (lines === undefined) return null;
  let readSectors = 0;
  let writtenSectors = 0;
  let found = false;
  for (const line of lines) {
    if (line === "") continue;
    const fields = line.split(/\s+/);
    if (fields.length < 10) continue;
    const read = Number(fields[5]);
    const written = Number(fields[9]);
    if (!Number.isFinite(read) || !Number.isFinite(written)) continue;
    readSectors += read;
    writtenSectors += written;
    found = true;
  }
  return found ? { readSectors, writtenSectors } : null;
}

// Summed rx/tx over the net lines, leaving out interfaces whose link state is `unknown`
// (loopback and tunnels, whose traffic already passes a real port) and any name starting
// `docker`, `br-` or `veth`. A missing link section means we cannot tell tunnels apart, so
// net is null; no interface left gives null too.
function netFrom(net: string[] | undefined, link: string[] | undefined): { rxBytes: number; txBytes: number } | null {
  if (net === undefined || link === undefined) return null;
  const states = new Map<string, string>();
  for (const line of link) {
    if (line === "") continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    states.set(parts[0], parts[1]);
  }
  let rxBytes = 0;
  let txBytes = 0;
  let found = false;
  for (const line of net) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (states.get(name) === "unknown") continue;
    if (name.startsWith("docker") || name.startsWith("br-") || name.startsWith("veth")) continue;
    const fields = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    if (fields.length < 9) continue;
    const rx = fields[0];
    const tx = fields[8];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    rxBytes += rx;
    txBytes += tx;
    found = true;
  }
  return found ? { rxBytes, txBytes } : null;
}

// The RDMA ports that map to a network interface. The first kind of line maps a device to its
// interface; a port (`<dev>/<n>`) is a link port only when its device has that line. A section
// with no such mapping, or with none of its ports mapping, gives null. Lines that do not parse
// and unknown files inside the section are ignored.
function rdmaFrom(lines: string[] | undefined): RdmaPort[] | null {
  if (lines === undefined) return null;
  const prefix = "/sys/class/infiniband/";
  const netMark = "/device/net/";
  const ifaces = new Map<string, string>();
  for (const line of lines) {
    if (line === "") continue;
    const net = line.indexOf(netMark);
    if (line.startsWith(prefix) && net !== -1) {
      const dev = line.slice(prefix.length, net);
      if (dev !== "") ifaces.set(dev, line.slice(net + netMark.length));
    }
  }
  if (ifaces.size === 0) return null;
  const ports = new Map<string, RdmaPort>();
  for (const line of lines) {
    if (line === "") continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const path = line.slice(0, colon);
    if (!path.startsWith(prefix)) continue;
    const value = line.slice(colon + 1);
    if (value.trim() === "") continue; // an empty value is unknown; Number("") would read it as 0
    const parts = path.split("/");
    // ["", "sys", "class", "infiniband", dev, "ports", n, ...file]
    if (parts.length < 8 || parts[5] !== "ports") continue;
    const dev = parts[4];
    const n = Number(parts[6]);
    if (!Number.isInteger(n)) continue;
    if (!ifaces.has(dev)) continue;
    const file = parts.slice(7).join("/");
    const id = `${dev}/${n}`;
    let port = ports.get(id);
    if (port === undefined) {
      port = { id, up: false, gbps: null, rxWords: null, txWords: null, errors: null };
      ports.set(id, port);
    }
    if (file === "state") {
      const sep = value.indexOf(": ");
      port.up = sep !== -1 && value.slice(sep + 2) === "ACTIVE";
    } else if (file === "rate") {
      const gbps = Number(value.split(/\s+/)[0]);
      if (Number.isFinite(gbps)) port.gbps = gbps;
    } else if (file === "counters/port_rcv_data") {
      const words = Number(value);
      if (Number.isFinite(words)) port.rxWords = words;
    } else if (file === "counters/port_xmit_data") {
      const words = Number(value);
      if (Number.isFinite(words)) port.txWords = words;
    } else if (file === "counters/port_rcv_errors" || file === "counters/port_xmit_discards"
               || file === "counters/link_downed" || file === "hw_counters/out_of_buffer") {
      const errors = Number(value);
      if (Number.isFinite(errors)) port.errors = (port.errors ?? 0) + errors;
    }
  }
  return ports.size === 0 ? null : [...ports.values()];
}

// Figures from the previous and current good readings. A first reading, or counters that
// went down (the node rebooted), give no CPU use. When status is not "ok", every figure is
// null but readAt keeps the last good reading's time.
export function nodeFiguresFrom(name: string, status: NodeStatus, prev: StatsReading | null,
                                cur: StatsReading | null, seenUp: ReadonlySet<string> = new Set()): NodeFigures {
  if (cur === null) {
    return { name, status, cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null, diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null, linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null, linkTxBps: null, linkDropsRising: null, readAt: null };
  }
  const readAt = new Date(cur.atMs).toISOString();
  if (status !== "ok") {
    return { name, status, cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null, diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null, linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null, linkTxBps: null, linkDropsRising: null, readAt };
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
  // Gauges read from the current reading alone; null when the source is missing or empty.
  let memUsedPercent: number | null = null;
  if (cur.memTotalBytes !== null && cur.memAvailableBytes !== null && cur.memTotalBytes > 0) {
    memUsedPercent = Math.round(((cur.memTotalBytes - cur.memAvailableBytes) / cur.memTotalBytes) * 1000) / 10;
  }
  let diskUsedPercent: number | null = null;
  if (cur.disk !== null && cur.disk.sizeBytes > 0) {
    diskUsedPercent = Math.round((cur.disk.usedBytes / cur.disk.sizeBytes) * 1000) / 10;
  }
  // Rates need a previous reading, the same counters in both, time that advanced, and a
  // counter that did not go down (the node rebooted). Each pair is judged on its own.
  let diskReadBps: number | null = null;
  let diskWriteBps: number | null = null;
  if (prev !== null && prev.diskIo !== null && cur.diskIo !== null && cur.atMs > prev.atMs) {
    const seconds = (cur.atMs - prev.atMs) / 1000;
    const deltaRead = cur.diskIo.readSectors - prev.diskIo.readSectors;
    if (deltaRead >= 0) diskReadBps = Math.round((deltaRead * 512) / seconds);
    const deltaWritten = cur.diskIo.writtenSectors - prev.diskIo.writtenSectors;
    if (deltaWritten >= 0) diskWriteBps = Math.round((deltaWritten * 512) / seconds);
  }
  let netRxBps: number | null = null;
  let netTxBps: number | null = null;
  if (prev !== null && prev.net !== null && cur.net !== null && cur.atMs > prev.atMs) {
    const seconds = (cur.atMs - prev.atMs) / 1000;
    const deltaRx = cur.net.rxBytes - prev.net.rxBytes;
    if (deltaRx >= 0) netRxBps = Math.round(deltaRx / seconds);
    const deltaTx = cur.net.txBytes - prev.net.txBytes;
    if (deltaTx >= 0) netTxBps = Math.round(deltaTx / seconds);
  }
  // Link figures: all seven null when the current reading has no RDMA ports mapped to interfaces.
  let linkPortsUp: number | null = null;
  let linkPortsSeenUp: number | null = null;
  let linkDown: boolean | null = null;
  let linkGbps: number | null = null;
  let linkRxBps: number | null = null;
  let linkTxBps: number | null = null;
  let linkDropsRising: boolean | null = null;
  if (cur.rdma !== null) {
    const up = cur.rdma.filter((p) => p.up);
    linkPortsUp = up.length;
    const upIds = new Set(up.map((p) => p.id));
    const seen = new Set(seenUp);
    for (const id of upIds) seen.add(id);
    linkPortsSeenUp = seen.size;
    linkDown = [...seenUp].some((id) => !upIds.has(id)) || (cur.rdma.length > 0 && up.length === 0);
    for (const p of up) {
      if (p.gbps !== null && (linkGbps === null || p.gbps > linkGbps)) linkGbps = p.gbps;
    }
    // Rates need the same up ports in both readings with both word counts; a counter that went
    // down (the node rebooted) makes that direction null, judged on its own.
    if (prev !== null && prev.rdma !== null && cur.atMs > prev.atMs) {
      const seconds = (cur.atMs - prev.atMs) / 1000;
      const prevById = new Map(prev.rdma.map((p) => [p.id, p]));
      let rxDelta = 0;
      let txDelta = 0;
      let counted = false;
      let rxReset = false;
      let txReset = false;
      for (const p of cur.rdma) {
        if (!p.up) continue;
        const q = prevById.get(p.id);
        if (q === undefined || !q.up) continue;
        if (p.rxWords === null || p.txWords === null || q.rxWords === null || q.txWords === null) continue;
        counted = true;
        const drx = p.rxWords - q.rxWords;
        if (drx < 0) rxReset = true;
        else rxDelta += drx;
        const dtx = p.txWords - q.txWords;
        if (dtx < 0) txReset = true;
        else txDelta += dtx;
      }
      if (counted && !rxReset) linkRxBps = Math.round((rxDelta * 4) / seconds);
      if (counted && !txReset) linkTxBps = Math.round((txDelta * 4) / seconds);
    }
    // Drops rising over the ports present in both with errors in both; a reset (any value down)
    // makes it null, as does a missing sum.
    if (prev !== null && prev.rdma !== null) {
      const prevById = new Map(prev.rdma.map((p) => [p.id, p]));
      let prevSum = 0;
      let curSum = 0;
      let compared = false;
      let reset = false;
      for (const p of cur.rdma) {
        const q = prevById.get(p.id);
        if (q === undefined) continue;
        if (p.errors === null || q.errors === null) continue;
        compared = true;
        prevSum += q.errors;
        curSum += p.errors;
        if (p.errors < q.errors) reset = true;
      }
      if (compared && !reset) linkDropsRising = curSum > prevSum;
    }
  }
  return {
    name, status,
    cpuPercent, cpuWindowSeconds,
    cpuTempC: cur.cpuTempC,
    gpuPercent: cur.gpuPercent,
    gpuTempC: cur.gpuTempC,
    memUsedPercent,
    memAvailableBytes: cur.memAvailableBytes,
    gpuPowerW: cur.gpuPowerW,
    diskUsedPercent,
    diskReadBps,
    diskWriteBps,
    netRxBps,
    netTxBps,
    linkPortsUp,
    linkPortsSeenUp,
    linkDown,
    linkGbps,
    linkRxBps,
    linkTxBps,
    linkDropsRising,
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
  seenUp: Set<string>;
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
        state = { prev: null, last: null, status: "unreachable", seenUp: new Set() };
      }
      if (result.status === "fulfilled") {
        const reading = parseStats(result.value, now.getTime());
        state.prev = state.last;
        state.last = reading;
        state.status = "ok";
        for (const port of reading.rdma ?? []) {
          if (port.up) state.seenUp.add(port.id);
        }
      } else if (result.reason instanceof HostKeyRefused) {
        state.status = "host key refused";
      } else {
        state.status = "unreachable";
      }
      this.nodeStates.set(target.name, state);
    });
    const current = this.deps.targets.map((t) => {
      const state = this.nodeStates.get(t.name);
      return nodeFiguresFrom(t.name, state?.status ?? "unreachable", state?.prev ?? null, state?.last ?? null, state?.seenUp ?? new Set());
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
