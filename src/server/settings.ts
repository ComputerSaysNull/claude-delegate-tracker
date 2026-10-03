// This module is the only place a default lives. Docs and tests never restate them.
export interface Settings {
  port: number;                 // TRACKER_PORT
  transcriptDir: string | null; // TRANSCRIPT_DIR; no default: null when unset or blank
  allowedHosts: string[];       // ALLOWED_HOSTS; comma-separated; default none
  quietAfterSeconds: number;    // QUIET_AFTER_SECONDS; keep it well above the server's keepalive
  streamsPollSeconds: number;   // STREAMS_POLL_SECONDS; counted from the end of the previous pass
}

export const DEFAULTS = {
  port: 8787,
  quietAfterSeconds: 120,
  streamsPollSeconds: 2,
} as const;

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
  };
}
