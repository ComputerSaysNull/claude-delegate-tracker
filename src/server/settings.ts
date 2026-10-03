// This module is the only place a default lives. Docs and tests never restate them.
export interface Settings {
  port: number;                 // TRACKER_PORT
  transcriptDir: string | null; // TRANSCRIPT_DIR; no default: null when unset or blank
  allowedHosts: string[];       // ALLOWED_HOSTS; comma-separated; default none
}

export const DEFAULTS = { port: 8787 } as const;

export class SettingsError extends Error {}

export function loadSettings(env: Record<string, string | undefined>): Settings {
  const portRaw = env.TRACKER_PORT?.trim() ?? "";
  let port: number = DEFAULTS.port;
  if (portRaw !== "") {
    port = /^[0-9]+$/.test(portRaw) ? Number(portRaw) : NaN;
    if (!(port >= 1 && port <= 65535)) {
      throw new SettingsError(
        `TRACKER_PORT must be a whole number from 1 to 65535, not "${env.TRACKER_PORT}".`);
    }
  }

  const transcriptRaw = env.TRANSCRIPT_DIR?.trim() ?? "";
  const transcriptDir = transcriptRaw === "" ? null : transcriptRaw;

  const allowedHosts = (env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");

  return { port, transcriptDir, allowedHosts };
}
