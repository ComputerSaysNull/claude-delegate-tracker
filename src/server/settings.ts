// This module is the only place a default lives. Docs and tests never restate them.
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
}

export const DEFAULTS = {
  port: 8787,
  quietAfterSeconds: 120,
  streamsPollSeconds: 2,
  followPollSeconds: 1,
  metricsPollSeconds: 10,
  metricsTimeoutMs: 5000,
  nodesPollSeconds: 5,
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

export function loadSettings(env: Record<string, string | undefined>): Settings {
  const transcriptRaw = env.TRANSCRIPT_DIR?.trim() ?? "";
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
  };
}
