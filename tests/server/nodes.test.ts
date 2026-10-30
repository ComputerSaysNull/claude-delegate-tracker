// One test per rule in docs/ARCHITECTURE.md "The nodes".
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  sshRunner,
  parseStats,
  nodeFiguresFrom,
  parseKnownHosts,
  hostKeyMatches,
  HostKeyRefused,
  NodesPoller,
  type NodeTarget,
  type NodesDeps,
  type StatsReading,
  type RdmaPort,
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

// plans#13: the full command output with mem, power, disk, net and link sections.
const SPEC13_SAMPLE = [
  "==stat",
  "cpu  100 0 50 800 50 0 0 0 0 0",
  "==thermal",
  "acpitz 51500",
  "==gpu",
  "7, 57",
  "==mem",
  "MemTotal:       127598644 kB",
  "MemAvailable:    5992420 kB",
  "==power",
  "36.43",
  "==disk",
  "3936289308672 418697383936",
  " 259       0 nvme0n1 8706089 642215 1619176946 2244668 2465471 6076045 223659354 20246041 0 4819589 22855541 71702 0 6898170776 70613 232859 294218",
  " 259       1 nvme1n1 1000 100 1000 200 300 400 500 600 700 800 900 1000",
  "==net",
  "    lo: 296551845 4460395    0    0    0     0          0         0 296551845 4460395    0    0    0     0       0          0",
  "enP7s7: 3163037026 10283683    0    0    0     0          0    852688 7312358678 11176458    0    0    0     0       0          0",
  "enp1s0f0np0: 716760362 8427241    0    0    0     0          0    133855 4540541438 7635054    0    0    0     0       0          0",
  "vpn0: 4988092460 42580701    0    0    0     0          0         0 65880620480 59455630    0    0    0     0       0          0",
  "docker0:    4129      53    0    0    0     0          0         0     7297      54    0 14017    0     0       0          0",
  "br-655b64c5acc5: 1664149   16974    0    0    0     0          0         0  2358273   15382    0    4    0     0       0          0",
  "veth5a20998: 1901785   16974    0    0    0     0          0         0 13434840   60280    0    0    0     0       0          0",
  "==link",
  "br-655b64c5acc5 up 10000 0 4",
  "docker0 down -1 0 14017",
  "enp1s0f0np0 up 200000 0 0",
  "enP7s7 up 1000 0 0",
  "lo unknown 0 0",
  "vpn0 unknown -1 0 0",
  "veth5a20998 up 10000 0 0",
].join("\n");

// plans#93: the ==rdma section, mapping RDMA devices to their interfaces and reporting per-port.
const RDMA_SAMPLE = [
  "==rdma",
  "/sys/class/infiniband/rdmaA/device/net/ethA",
  "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
  "/sys/class/infiniband/rdmaA/ports/1/rate:200 Gb/sec (4X HDR)",
  "/sys/class/infiniband/rdmaA/ports/1/counters/port_rcv_data:1000",
  "/sys/class/infiniband/rdmaA/ports/1/counters/port_xmit_data:2000",
  "/sys/class/infiniband/rdmaA/ports/1/counters/port_rcv_errors:3",
  "/sys/class/infiniband/rdmaA/ports/1/counters/port_xmit_discards:4",
  "/sys/class/infiniband/rdmaA/ports/1/counters/link_downed:5",
  "/sys/class/infiniband/rdmaA/ports/1/hw_counters/out_of_buffer:6",
  "/sys/class/infiniband/rdmaB/device/net/ethB",
  "/sys/class/infiniband/rdmaB/ports/1/state:1: DOWN",
  "/sys/class/infiniband/rdmaB/ports/1/rate:100 Gb/sec (4X HDR)",
  "/sys/class/infiniband/rdmaB/ports/1/counters/port_rcv_data:3000",
  "/sys/class/infiniband/rdmaB/ports/1/counters/port_xmit_data:4000",
].join("\n");

// Two good polls: the first has both ports up, the second has rdmaB down.
const RDMA_POLL1 = [
  "==rdma",
  "/sys/class/infiniband/rdmaA/device/net/ethA",
  "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
  "/sys/class/infiniband/rdmaB/device/net/ethB",
  "/sys/class/infiniband/rdmaB/ports/1/state:4: ACTIVE",
].join("\n");

const RDMA_POLL2 = [
  "==rdma",
  "/sys/class/infiniband/rdmaA/device/net/ethA",
  "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
  "/sys/class/infiniband/rdmaB/device/net/ethB",
  "/sys/class/infiniband/rdmaB/ports/1/state:1: DOWN",
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
      memTotalBytes: null,
      memAvailableBytes: null,
      gpuPowerW: null,
      disk: null,
      diskIo: null,
      net: null,
      rdma: null,
    });
  });

  it("parses mem, power, disk, diskIo and net", () => {
    const s = parseStats(SPEC13_SAMPLE, T0);
    expect(s.atMs).toBe(T0);
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.cpuTempC).toBe(51.5);
    expect(s.gpuPercent).toBe(7);
    expect(s.memTotalBytes).toBe(130_661_011_456);
    expect(s.memAvailableBytes).toBe(6_136_238_080);
    expect(s.gpuPowerW).toBe(36.43);
    expect(s.disk).toEqual({ sizeBytes: 3_936_289_308_672, usedBytes: 418_697_383_936 });
    expect(s.diskIo).toEqual({ readSectors: 1_619_177_946, writtenSectors: 223_659_854 });
    expect(s.net).toEqual({ rxBytes: 3_879_797_388, txBytes: 11_852_900_116 });
  });

  it("gives gpuPowerW null for [N/A] power and keeps the rest", () => {
    const s = parseStats(
      ["==stat", "cpu  100 0 50 800 50 0 0 0 0 0", "==power", "[N/A]"].join("\n"),
      T0,
    );
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.gpuPowerW).toBeNull();
  });

  it("a missing mem, power or disk section gives null for those figures", () => {
    const s = parseStats(
      ["==stat", "cpu  100 0 50 800 50 0 0 0 0 0", "==thermal", "acpitz 51500", "==gpu", "7, 57"].join("\n"),
      T0,
    );
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.memTotalBytes).toBeNull();
    expect(s.memAvailableBytes).toBeNull();
    expect(s.gpuPowerW).toBeNull();
    expect(s.disk).toBeNull();
    expect(s.diskIo).toBeNull();
  });

  it("leaves loopback, unknown-state tunnels and docker/br-/veth interfaces out of net", () => {
    const s = parseStats(
      [
        "==net",
        "lo: 100 100 0 0 0 0 0 0 100 100 0 0 0 0 0 0",
        "vpn0: 200 200 0 0 0 0 0 0 200 200 0 0 0 0 0 0",
        "docker0: 300 300 0 0 0 0 0 0 300 300 0 0 0 0 0 0",
        "br-abc: 400 400 0 0 0 0 0 0 400 400 0 0 0 0 0 0",
        "veth-abc: 500 500 0 0 0 0 0 0 500 500 0 0 0 0 0 0",
        "eth0: 1000 2000 0 0 0 0 0 0 3000 4000 0 0 0 0 0 0",
        "==link",
        "lo unknown 0 0",
        "vpn0 unknown -1 0 0",
        "docker0 down -1 0 0",
        "br-abc up 10000 0 0",
        "veth-abc up 10000 0 0",
        "eth0 up 1000 0 0",
      ].join("\n"),
      T0,
    );
    expect(s.net).toEqual({ rxBytes: 1000, txBytes: 3000 });
  });

  it("a missing ==link section makes net null", () => {
    const s = parseStats(
      ["==net", "eth0: 1000 2000 0 0 0 0 0 0 3000 4000 0 0 0 0 0 0"].join("\n"),
      T0,
    );
    expect(s.net).toBeNull();
  });

  it("an unknown section leaves every figure unchanged", () => {
    const base = parseStats(SPEC13_SAMPLE, T0);
    const withFuture = parseStats(`${SPEC13_SAMPLE}\n==future\nsome data\nmore data`, T0);
    expect(withFuture).toEqual(base);
  });

  it("the existing sample output still parses with the new fields null", () => {
    const s = parseStats(FULL_SAMPLE, T0);
    expect(s.cpu).toEqual({ idle: 850, total: 1000 });
    expect(s.cpuTempC).toBe(51.5);
    expect(s.memTotalBytes).toBeNull();
    expect(s.memAvailableBytes).toBeNull();
    expect(s.gpuPowerW).toBeNull();
    expect(s.disk).toBeNull();
    expect(s.diskIo).toBeNull();
    expect(s.net).toBeNull();
  });

  it("parses the ==rdma section into ports mapped to interfaces", () => {
    const s = parseStats(RDMA_SAMPLE, T0);
    expect(s.rdma).not.toBeNull();
    expect(s.rdma).toHaveLength(2);
    const a = s.rdma!.find((p) => p.id === "rdmaA/1")!;
    const b = s.rdma!.find((p) => p.id === "rdmaB/1")!;
    expect(a).toEqual({ id: "rdmaA/1", up: true, gbps: 200, rxWords: 1000, txWords: 2000, errors: 18 });
    expect(b).toEqual({ id: "rdmaB/1", up: false, gbps: 100, rxWords: 3000, txWords: 4000, errors: null });
  });

  it("an empty value is unknown, not 0", () => {
    const s = parseStats(
      [
        "==rdma",
        "/sys/class/infiniband/rdmaA/device/net/ethA",
        "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
        "/sys/class/infiniband/rdmaA/ports/1/rate:",
        "/sys/class/infiniband/rdmaA/ports/1/counters/port_rcv_data:",
        "/sys/class/infiniband/rdmaA/ports/1/counters/port_xmit_data: ",
        "/sys/class/infiniband/rdmaA/ports/1/counters/link_downed:",
      ].join("\n"),
      T0,
    );
    expect(s.rdma).toEqual([{ id: "rdmaA/1", up: true, gbps: null, rxWords: null, txWords: null, errors: null }]);
  });

  it("ignores a port whose device has no interface line, and gives rdma null when none maps", () => {
    const s = parseStats(
      [
        "==rdma",
        "/sys/class/infiniband/rdmaA/device/net/ethA",
        "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
        "/sys/class/infiniband/rdmaC/ports/1/state:4: ACTIVE",
      ].join("\n"),
      T0,
    );
    expect(s.rdma).not.toBeNull();
    expect(s.rdma).toHaveLength(1);
    expect(s.rdma![0].id).toBe("rdmaA/1");

    const none = parseStats(
      [
        "==rdma",
        "/sys/class/infiniband/rdmaA/device/net/ethA",
        "/sys/class/infiniband/rdmaB/ports/1/state:4: ACTIVE",
      ].join("\n"),
      T0,
    );
    expect(none.rdma).toBeNull();
  });

  it("a port with no state line is up false, and missing counters give null figures", () => {
    const s = parseStats(
      [
        "==rdma",
        "/sys/class/infiniband/rdmaA/device/net/ethA",
        "/sys/class/infiniband/rdmaA/ports/1/counters/port_rcv_data:1",
      ].join("\n"),
      T0,
    );
    expect(s.rdma).toHaveLength(1);
    expect(s.rdma![0]).toEqual({ id: "rdmaA/1", up: false, gbps: null, rxWords: 1, txWords: null, errors: null });
  });

  it("ignores lines that do not parse and unknown files inside the section", () => {
    const s = parseStats(
      [
        "==rdma",
        "/sys/class/infiniband/rdmaA/device/net/ethA",
        "/sys/class/infiniband/rdmaA/ports/1/state:4: ACTIVE",
        "/sys/class/infiniband/rdmaA/ports/1/counters/not_a_counter:99",
        "garbage",
        "/sys/class/infiniband/rdmaA/ports/1/rate:200 Gb/sec (4X HDR)",
      ].join("\n"),
      T0,
    );
    expect(s.rdma).toHaveLength(1);
    expect(s.rdma![0]).toEqual({ id: "rdmaA/1", up: true, gbps: 200, rxWords: null, txWords: null, errors: null });
  });

  it("a missing ==rdma section gives rdma null", () => {
    const s = parseStats(FULL_SAMPLE, T0);
    expect(s.rdma).toBeNull();
  });
});

const reading = (
  atMs: number,
  cpu: { idle: number; total: number } | null,
  cpuTempC: number | null,
  gpuPercent: number | null,
  gpuTempC: number | null,
  extra: Partial<StatsReading> = {},
): StatsReading => ({
  atMs, cpu, cpuTempC, gpuPercent, gpuTempC,
  memTotalBytes: null, memAvailableBytes: null, gpuPowerW: null,
  disk: null, diskIo: null, net: null, rdma: null,
  ...extra,
});

const rdmaPort = (id: string, over: Partial<RdmaPort> = {}): RdmaPort => ({
  id, up: false, gbps: null, rxWords: null, txWords: null, errors: null, ...over,
});

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

  it("memUsedPercent is 100 × (total − available) ÷ total, one decimal", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, { memTotalBytes: 1000, memAvailableBytes: 333 }));
    expect(f.memUsedPercent).toBe(66.7);
    expect(f.memAvailableBytes).toBe(333);
  });

  it("diskUsedPercent is 100 × used ÷ size, one decimal", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, { disk: { sizeBytes: 1000, usedBytes: 123 } }));
    expect(f.diskUsedPercent).toBe(12.3);
  });

  it("disk read/write bps are Δsectors × 512 ÷ Δs, whole bytes/s", () => {
    const prev = reading(T0, null, null, null, null, { diskIo: { readSectors: 1000, writtenSectors: 2000 } });
    const cur = reading(T0 + 3000, null, null, null, null, { diskIo: { readSectors: 1100, writtenSectors: 2050 } });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.diskReadBps).toBe(17067);
    expect(f.diskWriteBps).toBe(8533);
  });

  it("net rx/tx bps are Δbytes ÷ Δs, whole bytes/s", () => {
    const prev = reading(T0, null, null, null, null, { net: { rxBytes: 1000, txBytes: 2000 } });
    const cur = reading(T0 + 3000, null, null, null, null, { net: { rxBytes: 1100, txBytes: 2200 } });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.netRxBps).toBe(33);
    expect(f.netTxBps).toBe(67);
  });

  it("a first reading gives no rates but keeps the gauges", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      memTotalBytes: 1000, memAvailableBytes: 333, gpuPowerW: 36.43,
      disk: { sizeBytes: 1000, usedBytes: 123 },
      diskIo: { readSectors: 100, writtenSectors: 200 },
      net: { rxBytes: 10, txBytes: 20 },
    }));
    expect(f.memUsedPercent).toBe(66.7);
    expect(f.memAvailableBytes).toBe(333);
    expect(f.gpuPowerW).toBe(36.43);
    expect(f.diskUsedPercent).toBe(12.3);
    expect(f.diskReadBps).toBeNull();
    expect(f.diskWriteBps).toBeNull();
    expect(f.netRxBps).toBeNull();
    expect(f.netTxBps).toBeNull();
  });

  it("rates are null when a counter went down", () => {
    const prev = reading(T0, null, null, null, null, { diskIo: { readSectors: 500, writtenSectors: 600 }, net: { rxBytes: 5000, txBytes: 6000 } });
    const cur = reading(T0 + 5000, null, null, null, null, { diskIo: { readSectors: 100, writtenSectors: 200 }, net: { rxBytes: 100, txBytes: 200 } });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.diskReadBps).toBeNull();
    expect(f.diskWriteBps).toBeNull();
    expect(f.netRxBps).toBeNull();
    expect(f.netTxBps).toBeNull();
  });

  it("rates are null when time did not advance", () => {
    const prev = reading(T0, null, null, null, null, { diskIo: { readSectors: 100, writtenSectors: 200 }, net: { rxBytes: 100, txBytes: 200 } });
    const cur = reading(T0, null, null, null, null, { diskIo: { readSectors: 200, writtenSectors: 400 }, net: { rxBytes: 200, txBytes: 400 } });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.diskReadBps).toBeNull();
    expect(f.diskWriteBps).toBeNull();
    expect(f.netRxBps).toBeNull();
    expect(f.netTxBps).toBeNull();
  });

  it("rates are null when prev or cur lacks the counters", () => {
    const prev = reading(T0, null, null, null, null);
    const cur = reading(T0 + 5000, null, null, null, null, { diskIo: { readSectors: 100, writtenSectors: 200 }, net: { rxBytes: 100, txBytes: 200 } });
    let f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.diskReadBps).toBeNull();
    expect(f.diskWriteBps).toBeNull();
    expect(f.netRxBps).toBeNull();
    expect(f.netTxBps).toBeNull();

    const prev2 = reading(T0, null, null, null, null, { diskIo: { readSectors: 100, writtenSectors: 200 }, net: { rxBytes: 100, txBytes: 200 } });
    const cur2 = reading(T0 + 5000, null, null, null, null);
    f = nodeFiguresFrom("node-a", "ok", prev2, cur2);
    expect(f.diskReadBps).toBeNull();
    expect(f.diskWriteBps).toBeNull();
    expect(f.netRxBps).toBeNull();
    expect(f.netTxBps).toBeNull();
  });

  it("every new figure is null when status is not ok", () => {
    const cur = reading(T0, null, null, null, null, {
      memTotalBytes: 1000, memAvailableBytes: 333, gpuPowerW: 36.43,
      disk: { sizeBytes: 1000, usedBytes: 123 },
      diskIo: { readSectors: 100, writtenSectors: 200 },
      net: { rxBytes: 10, txBytes: 20 },
    });
    for (const status of ["unreachable", "host key refused"] as const) {
      const f = nodeFiguresFrom("node-a", status, null, cur);
      expect(f.status).toBe(status);
      expect(f.memUsedPercent).toBeNull();
      expect(f.memAvailableBytes).toBeNull();
      expect(f.gpuPowerW).toBeNull();
      expect(f.diskUsedPercent).toBeNull();
      expect(f.diskReadBps).toBeNull();
      expect(f.diskWriteBps).toBeNull();
      expect(f.netRxBps).toBeNull();
      expect(f.netTxBps).toBeNull();
      expect(f.readAt).toBe(new Date(T0).toISOString());
    }
  });

  it("cur.rdma null gives all seven link figures null, never 0 or false", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null));
    expect(f.linkPortsUp).toBeNull();
    expect(f.linkPortsSeenUp).toBeNull();
    expect(f.linkDown).toBeNull();
    expect(f.linkGbps).toBeNull();
    expect(f.linkRxBps).toBeNull();
    expect(f.linkTxBps).toBeNull();
    expect(f.linkDropsRising).toBeNull();
  });

  it("linkPortsUp, linkPortsSeenUp and linkGbps come from the current reading's up ports", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, gbps: 100 }), rdmaPort("rdmaB/1", { up: true, gbps: 200 })],
    }));
    expect(f.linkPortsUp).toBe(2);
    expect(f.linkPortsSeenUp).toBe(2);
    expect(f.linkGbps).toBe(200);

    const none = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: false, gbps: 100 }), rdmaPort("rdmaB/1", { up: false, gbps: 200 })],
    }));
    expect(none.linkPortsUp).toBe(0);
    expect(none.linkPortsSeenUp).toBe(0);
    expect(none.linkGbps).toBeNull();
    expect(none.linkDown).toBe(true);
  });

  it("linkDown: a never-up port does not trip it, a seen-up port now down does", () => {
    // A port seen up earlier but now down, while another is up → true.
    let f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: false }), rdmaPort("rdmaB/1", { up: true })],
    }), new Set(["rdmaA/1"]));
    expect(f.linkDown).toBe(true);

    // The seen-up port is still up; the never-up port down does not trip it → false.
    f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true }), rdmaPort("rdmaB/1", { up: false })],
    }), new Set(["rdmaA/1"]));
    expect(f.linkDown).toBe(false);

    // No link port is up at all → true, even with nothing ever seen up.
    f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: false }), rdmaPort("rdmaB/1", { up: false })],
    }));
    expect(f.linkDown).toBe(true);
  });

  it("linkPortsSeenUp is the union of seenUp and the current reading's up ports", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: false }), rdmaPort("rdmaB/1", { up: true })],
    }), new Set(["rdmaA/1", "rdmaC/1"]));
    expect(f.linkPortsUp).toBe(1);
    expect(f.linkPortsSeenUp).toBe(3);
  });

  it("a first reading gives no link rates or drops-rising but keeps the up figures", () => {
    const f = nodeFiguresFrom("node-a", "ok", null, reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, gbps: 200, rxWords: 1000, txWords: 2000, errors: 3 })],
    }));
    expect(f.linkPortsUp).toBe(1);
    expect(f.linkPortsSeenUp).toBe(1);
    expect(f.linkDown).toBe(false);
    expect(f.linkGbps).toBe(200);
    expect(f.linkRxBps).toBeNull();
    expect(f.linkTxBps).toBeNull();
    expect(f.linkDropsRising).toBeNull();
  });

  it("link rx/tx bps are Δwords × 4 ÷ Δs over up ports only, whole bytes/s", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [
        rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 }),
        rdmaPort("rdmaB/1", { up: true, rxWords: 3000, txWords: 4000 }),
        rdmaPort("rdmaC/1", { up: false, rxWords: 5000, txWords: 6000 }),
      ],
    });
    const cur = reading(T0 + 4000, null, null, null, null, {
      rdma: [
        rdmaPort("rdmaA/1", { up: true, rxWords: 1100, txWords: 2100 }),
        rdmaPort("rdmaB/1", { up: true, rxWords: 3300, txWords: 4300 }),
        rdmaPort("rdmaC/1", { up: false, rxWords: 9000, txWords: 10_000 }),
      ],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBe(400);
    expect(f.linkTxBps).toBe(400);
  });

  it("a counter that went down makes that rate null, but not the other direction", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 }), rdmaPort("rdmaB/1", { up: true, rxWords: 3000, txWords: 4000 })],
    });
    const cur = reading(T0 + 2000, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1100, txWords: 2100 }), rdmaPort("rdmaB/1", { up: true, rxWords: 2900, txWords: 4500 })],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBeNull();
    expect(f.linkTxBps).toBe(1200);
  });

  it("a port that was down in the earlier reading is not counted in rates", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 }), rdmaPort("rdmaB/1", { up: false, rxWords: 0, txWords: 0 })],
    });
    const cur = reading(T0 + 2000, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1100, txWords: 2100 }), rdmaPort("rdmaB/1", { up: true, rxWords: 5000, txWords: 6000 })],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBe(200);
    expect(f.linkTxBps).toBe(200);
  });

  it("link rates are null when time did not advance", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 })],
    });
    const cur = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1100, txWords: 2100 })],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBeNull();
    expect(f.linkTxBps).toBeNull();
  });

  it("a port up in cur but absent from prev is not counted in rates", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 })],
    });
    const cur = reading(T0 + 2000, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1100, txWords: 2100 }), rdmaPort("rdmaB/1", { up: true, rxWords: 5000, txWords: 6000 })],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBe(200);
    expect(f.linkTxBps).toBe(200);
  });

  it("no up port with counters gives null rates", () => {
    const prev = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: 1000, txWords: 2000 })],
    });
    const cur = reading(T0 + 2000, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, rxWords: null, txWords: null })],
    });
    const f = nodeFiguresFrom("node-a", "ok", prev, cur);
    expect(f.linkRxBps).toBeNull();
    expect(f.linkTxBps).toBeNull();
  });

  it("linkDropsRising is true on a rise, false when equal, null on a reset", () => {
    const rise = nodeFiguresFrom("node-a", "ok",
      reading(T0, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 3 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }),
      reading(T0 + 1000, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 5 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }));
    expect(rise.linkDropsRising).toBe(true);

    const equal = nodeFiguresFrom("node-a", "ok",
      reading(T0, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 3 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }),
      reading(T0 + 1000, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 3 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }));
    expect(equal.linkDropsRising).toBe(false);

    const reset = nodeFiguresFrom("node-a", "ok",
      reading(T0, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 5 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }),
      reading(T0 + 1000, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 2 }), rdmaPort("rdmaB/1", { up: true, errors: 4 })] }));
    expect(reset.linkDropsRising).toBeNull();
  });

  it("linkDropsRising is null when no port has errors in both readings", () => {
    const f = nodeFiguresFrom("node-a", "ok",
      reading(T0, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: null })] }),
      reading(T0 + 1000, null, null, null, null, { rdma: [rdmaPort("rdmaA/1", { up: true, errors: 3 })] }));
    expect(f.linkDropsRising).toBeNull();
  });

  it("status not ok gives all seven link figures null", () => {
    const cur = reading(T0, null, null, null, null, {
      rdma: [rdmaPort("rdmaA/1", { up: true, gbps: 200, rxWords: 1000, txWords: 2000, errors: 3 })],
    });
    for (const status of ["unreachable", "host key refused"] as const) {
      const f = nodeFiguresFrom("node-a", status, null, cur);
      expect(f.linkPortsUp).toBeNull();
      expect(f.linkPortsSeenUp).toBeNull();
      expect(f.linkDown).toBeNull();
      expect(f.linkGbps).toBeNull();
      expect(f.linkRxBps).toBeNull();
      expect(f.linkTxBps).toBeNull();
      expect(f.linkDropsRising).toBeNull();
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
      { name: "node-a", status: "unreachable", cpuPercent: null, cpuWindowSeconds: null, cpuTempC: null, gpuPercent: null, gpuTempC: null, readAt: null, memUsedPercent: null, memAvailableBytes: null, gpuPowerW: null, diskUsedPercent: null, diskReadBps: null, diskWriteBps: null, netRxBps: null, netTxBps: null, linkPortsUp: null, linkPortsSeenUp: null, linkDown: null, linkGbps: null, linkRxBps: null, linkTxBps: null, linkDropsRising: null },
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

  it("a port up in the first poll and down in the second gives linkDown and a smaller up count", async () => {
    const p = makePoller();
    p.body(RDMA_POLL1);
    await p.poller.poll();
    expect(p.poller.figures()[0].status).toBe("ok");
    expect(p.poller.figures()[0].linkPortsUp).toBe(2);
    p.advance(5000);
    p.body(RDMA_POLL2);
    await p.poller.poll();
    const f = p.poller.figures()[0];
    expect(f.status).toBe("ok");
    expect(f.linkPortsUp).toBe(1);
    expect(f.linkPortsSeenUp).toBe(2);
    expect(f.linkDown).toBe(true);
  });

  it("stop closes the runner", () => {
    const p = makePoller();
    p.poller.stop();
    expect(p.close).toHaveBeenCalledTimes(1);
  });
});

describe("sshRunner", () => {
  const target: NodeTarget = { name: "node-a", user: "u", host: "127.0.0.1", port: 1 };

  function files(over: { key?: boolean; known?: boolean } = {}): { keyPath: string; knownHostsPath: string } {
    const dir = mkdtempSync(join(tmpdir(), "nodes-"));
    const keyPath = join(dir, "key");
    const knownHostsPath = join(dir, "known_hosts");
    if (over.key !== false) writeFileSync(keyPath, "not a key\n");
    if (over.known !== false) writeFileSync(knownHostsPath, "");
    return { keyPath, knownHostsPath };
  }

  async function statusWith(runner: ReturnType<typeof sshRunner>): Promise<string> {
    const poller = new NodesPoller({ targets: [target], runner, now: () => new Date(T0) });
    await poller.poll();
    return poller.figures()[0].status;
  }

  it("a missing key file leaves the runner usable and its node unreachable", async () => {
    const runner = sshRunner({ ...files({ key: false }), timeoutMs: 1000 });
    await expect(runner.run(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await statusWith(runner)).toBe("unreachable");
  });

  it("a missing known_hosts file leaves the runner usable and its node unreachable", async () => {
    const runner = sshRunner({ ...files({ known: false }), timeoutMs: 1000 });
    await expect(runner.run(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await statusWith(runner)).toBe("unreachable");
  });

  it("reads the files again on the next poll, so a key put back is used without a restart", async () => {
    const paths = files({ key: false });
    const runner = sshRunner({ ...paths, timeoutMs: 1000 });
    await expect(runner.run(target)).rejects.toMatchObject({ code: "ENOENT" });
    writeFileSync(paths.keyPath, "not a key\n");
    // Past the read now: ssh2 refuses the key's content instead, still an unreachable node.
    const err = await runner.run(target).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).not.toBe("ENOENT");
    expect(err).not.toBeInstanceOf(HostKeyRefused);
    expect(await statusWith(runner)).toBe("unreachable");
  });
});
