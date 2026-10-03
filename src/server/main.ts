// Starts the tracker: settings from the environment (and .env, if present), then the app,
// listening on loopback only. The overlay VPN's serve is the only way in from elsewhere.
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { Poller } from "./poller.ts";
import { loadSettings, SettingsError, type Settings } from "./settings.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const envFile = path.join(root, ".env");
// Values already in the environment win over .env.
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

let settings: Settings;
try {
  settings = loadSettings(process.env);
} catch (e) {
  if (!(e instanceof SettingsError)) throw e;
  console.error(e.message);
  process.exit(1);
}

function isReadableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

const poller = new Poller({
  dir: settings.transcriptDir,
  quietAfterSeconds: settings.quietAfterSeconds,
  now: () => new Date(),
});
poller.start(settings.streamsPollSeconds, settings.followPollSeconds);

const staticRoot = path.join(root, "dist", "web");
const app = createApp({
  settings,
  staticRoot: fs.existsSync(path.join(staticRoot, "index.html")) ? staticRoot : null,
  isReadableDir,
  now: () => new Date(),
  streams: () => poller.list(),
  subscribe: (listener) => poller.onChange(listener),
  view: (name) => poller.view(name),
  follow: (name, listener) => poller.follow(name, listener),
});

serve({ fetch: app.fetch, port: settings.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`tracker listening on http://localhost:${info.port} (loopback only)`);
});
