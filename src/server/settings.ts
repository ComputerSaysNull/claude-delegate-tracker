// This module is the only place a default lives. Docs and tests never restate them.
import path from "node:path";
import type { NodeTarget } from "./nodes.ts";
export interface Settings {
  port: number;                 // TRACKER_PORT
  transcriptDir: string | null; // TRANSCRIPT_DIR; no default: null when unset or blank
  allowedHosts: string[];       // ALLOWED_HOSTS; comma-separated; default none
  quietAfterSeconds: number;    // QUIET_AFTER_SECONDS; keep it well above the server's keepalive
  streamsPollSeconds: number;   // STREAMS_POLL_SECONDS; counted from the end of the previous pass
  followPollSeconds: number;    // FOLLOW_POLL_SECONDS; how often a followed stream is read
  metricsUrl: string | null;    // METRICS_URL; the model server's root; null when unset or blank
  metricsTokenEnv: string | null; // METRICS_TOKEN_ENV; the NAME of the env var holding a bearer token
  metricsPollSeconds: number;   // METRICS_POLL_SECONDS; counted from the end of the previous scrape
  nodes: NodeTarget[];          // NODES; comma-separated name=user@host[:port]; default none
  nodeKey: string | null;       // NODE_KEY; the dedicated key's path
  nodeKnownHosts: string | null; // NODE_KNOWN_HOSTS; the file pinning each node's host key
  nodesPollSeconds: number;     // NODES_POLL_SECONDS; counted from the end of the previous poll
  historyWindowSeconds: number; // HISTORY_WINDOW_SECONDS; how far back the figures over time reach
  dataDir: string | null;       // DATA_DIR; where the run records are kept; default from LOCALAPPDATA/XDG_DATA_HOME/HOME
  runsScanSeconds: number;      // RUNS_SCAN_SECONDS; how often the runs folder is checked for runs that ended
  limits: Limits;               // LOAD_WARN_PERCENT, LOAD_HOT_PERCENT, TEMP_WARN_C, TEMP_HOT_C
}

// Where a figure turns amber (warn) and red (hot): CPU and GPU use in percent, temperatures in °C.
export interface Limits {
  loadWarn: number;
  loadHot: number;
  tempWarn: number;
  tempHot: number;
}

export const DEFAULTS = {
  port: 8787,
  quietAfterSeconds: 120,
  streamsPollSeconds: 2,
  followPollSeconds: 1,
  metricsPollSeconds: 10,
  metricsTimeoutMs: 5000,
  nodesPollSeconds: 5,
  historyWindowSeconds: 3600,
  runsScanSeconds: 60,
  loadWarnPercent: 50,
  loadHotPercent: 80,
  tempWarnC: 70,
  tempHotC: 85,
  nodeTimeoutMs: 10000,
  sshPort: 22,
} as const;

function nodeTargets(env: Record<string, string | undefined>): NodeTarget[] {
  const raw = env.NODES?.trim() ?? "";
  if (raw === "") return [];
  const targets: NodeTarget[] = [];
  for (const entry of raw.split(",").map((e) => e.trim())) {
    const m = /^([^=@\s]+)=([^=@\s]+)@([^=@\s:]+)(?::([0-9]+))?$/.exec(entry);
    const port = m?.[4] === undefined ? DEFAULTS.sshPort : Number(m[4]);
    if (m === null || !(port >= 1 && port <= 65535) || targets.some((t) => t.name === m[1])) {
      throw new SettingsError(
        `NODES must be comma-separated name=user@host[:port] entries with distinct names, not "${entry}".`);
    }
    targets.push({ name: m[1], user: m[2], host: m[3], port });
  }
  return targets;
}

function optional(env: Record<string, string | undefined>, name: string): string | null {
  const raw = env[name]?.trim() ?? "";
  return raw === "" ? null : raw;
}

export class SettingsError extends Error {}

function dataDirDefault(env: Record<string, string | undefined>): string | null {
  const local = env.LOCALAPPDATA?.trim() ?? "";
  if (local !== "") return path.join(local, "claude-delegate-tracker");
  const xdg = env.XDG_DATA_HOME?.trim() ?? "";
  if (xdg !== "") return path.join(xdg, "claude-delegate-tracker");
  const home = env.HOME?.trim() ?? "";
  if (home !== "") return path.join(home, ".local", "share", "claude-delegate-tracker");
  return null;
}

function wholeNumber(env: Record<string, string | undefined>, name: string,
                     fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim() ?? "";
  if (raw === "") return fallback;
  const value = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    throw new SettingsError(
      `${name} must be a whole number from ${min} to ${max}, not "${env[name]}".`);
  }
  return value;
}

// A pair of thresholds, the warning one below the hot one.
function pair(env: Record<string, string | undefined>, warnName: string, warn: number,
              hotName: string, hot: number, max: number): [number, number] {
  const w = wholeNumber(env, warnName, warn, 1, max);
  const h = wholeNumber(env, hotName, hot, 1, max);
  if (w >= h) throw new SettingsError(`${warnName} (${w}) must be below ${hotName} (${h}).`);
  return [w, h];
}

export function loadSettings(env: Record<string, string | undefined>): Settings {
  const transcriptRaw = env.TRANSCRIPT_DIR?.trim() ?? "";
  const [loadWarn, loadHot] = pair(env, "LOAD_WARN_PERCENT", DEFAULTS.loadWarnPercent, "LOAD_HOT_PERCENT", DEFAULTS.loadHotPercent, 100);
  const [tempWarn, tempHot] = pair(env, "TEMP_WARN_C", DEFAULTS.tempWarnC, "TEMP_HOT_C", DEFAULTS.tempHotC, 150);
  return {
    port: wholeNumber(env, "TRACKER_PORT", DEFAULTS.port, 1, 65535),
    transcriptDir: transcriptRaw === "" ? null : transcriptRaw,
    allowedHosts: (env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h !== ""),
    quietAfterSeconds: wholeNumber(env, "QUIET_AFTER_SECONDS", DEFAULTS.quietAfterSeconds, 1, 86400),
    streamsPollSeconds: wholeNumber(env, "STREAMS_POLL_SECONDS", DEFAULTS.streamsPollSeconds, 1, 3600),
    followPollSeconds: wholeNumber(env, "FOLLOW_POLL_SECONDS", DEFAULTS.followPollSeconds, 1, 3600),
    metricsUrl: optional(env, "METRICS_URL"),
    metricsTokenEnv: optional(env, "METRICS_TOKEN_ENV"),
    metricsPollSeconds: wholeNumber(env, "METRICS_POLL_SECONDS", DEFAULTS.metricsPollSeconds, 1, 3600),
    nodes: nodeTargets(env),
    nodeKey: optional(env, "NODE_KEY"),
    nodeKnownHosts: optional(env, "NODE_KNOWN_HOSTS"),
    nodesPollSeconds: wholeNumber(env, "NODES_POLL_SECONDS", DEFAULTS.nodesPollSeconds, 1, 3600),
    historyWindowSeconds: wholeNumber(env, "HISTORY_WINDOW_SECONDS", DEFAULTS.historyWindowSeconds, 60, 86400),
    dataDir: (env.DATA_DIR?.trim() ?? "") === "" ? dataDirDefault(env) : (env.DATA_DIR ?? "").trim(),
    runsScanSeconds: wholeNumber(env, "RUNS_SCAN_SECONDS", DEFAULTS.runsScanSeconds, 5, 3600),
    limits: { loadWarn, loadHot, tempWarn, tempHot },
  };
}
