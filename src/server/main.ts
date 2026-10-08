// Starts the tracker: settings from the environment (and .env, if present), then the app,
// listening on loopback only. The overlay VPN's serve is the only way in from elsewhere.
import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { buildHealth, makeSchemaCheck, type Health } from "./health.ts";
import { ClusterHistoryStore } from "./history.ts";
import { MetricsPoller } from "./metrics.ts";
import { NodesPoller, sshRunner } from "./nodes.ts";
import { Poller } from "./poller.ts";
import { RunStore } from "./runs.ts";
import { DEFAULTS, loadSettings, SettingsError, type Settings } from "./settings.ts";

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

const poller = new Poller({
  dir: settings.transcriptDir,
  quietAfterSeconds: settings.quietAfterSeconds,
  now: () => new Date(),
  schemaCheck: makeSchemaCheck(path.join(root, "contract", "transcript.schema.json")),
});
poller.start(settings.streamsPollSeconds, settings.followPollSeconds);

// The token stays in its own environment variable; settings hold only that variable's name.
const tokenRaw = settings.metricsTokenEnv === null ? "" : (process.env[settings.metricsTokenEnv] ?? "").trim();
const metrics = new MetricsPoller({
  url: settings.metricsUrl,
  token: tokenRaw === "" ? null : tokenRaw,
  fetch,
  now: () => new Date(),
  timeoutMs: DEFAULTS.metricsTimeoutMs,
});
metrics.start(settings.metricsPollSeconds);

// Node figures need the node list, the dedicated key and the pinned host keys; without
// all three nothing connects.
const runner = settings.nodes.length > 0 && settings.nodeKey !== null && settings.nodeKnownHosts !== null
  ? sshRunner({ keyPath: settings.nodeKey, knownHostsPath: settings.nodeKnownHosts, timeoutMs: DEFAULTS.nodeTimeoutMs })
  : null;
const nodes = new NodesPoller({ targets: runner === null ? [] : settings.nodes, runner, now: () => new Date() });
nodes.start(settings.nodesPollSeconds);

// The figures over time, kept in memory; a point per reading, a gap while a source is down.
const figureHistory = new ClusterHistoryStore(settings.historyWindowSeconds);
metrics.onChange((model) => figureHistory.pushModel(Date.now(), model));
nodes.onChange((figures) => figureHistory.pushNodes(Date.now(), figures));

// The health report, rebuilt whenever one of its sources changes; sent only when it differs.
const healthNow = (): Health => buildHealth({
  folderConfigured: settings.transcriptDir !== null,
  list: poller.list(),
  retryInSeconds: poller.status().retryInSeconds,
  clockSkewSeconds: poller.status().clockSkewSeconds,
  readIntervalSeconds: settings.streamsPollSeconds,
  model: metrics.figures(),
  nodes: nodes.figures(),
}, new Date());
const healthListeners = new Set<(health: Health) => void>();
let lastHealth = "";
const healthChanged = (): void => {
  const health = healthNow();
  const key = JSON.stringify({ ...health, checkedAt: null });
  if (key === lastHealth) return;
  lastHealth = key;
  for (const listener of healthListeners) listener(health);
};
poller.onChange(healthChanged);
poller.onStatus(healthChanged);
metrics.onChange(healthChanged);
nodes.onChange(healthChanged);

// The finished runs kept on disk, checked against the streams at start and on a scan interval.
const runs = new RunStore(
  settings.dataDir === null ? null : path.join(settings.dataDir, "runs.json"),
  settings.transcriptDir,
  () => new Date(),
);
runs.load();
// The server listens before the first full check, so the page is up even if the folder is slow.
setTimeout(() => runs.checkAll(), 0);
setInterval(() => runs.scan(), settings.runsScanSeconds * 1000);

const staticRoot = path.join(root, "dist", "web");
const app = createApp({
  settings,
  staticRoot: fs.existsSync(path.join(staticRoot, "index.html")) ? staticRoot : null,
  health: healthNow,
  subscribeHealth: (listener) => {
    healthListeners.add(listener);
    return () => healthListeners.delete(listener);
  },
  streams: () => poller.list(),
  subscribe: (listener) => poller.onChange(listener),
  view: (name) => poller.view(name),
  follow: (name, listener) => poller.follow(name, listener),
  thinking: (name, turn) => poller.thinking(name, turn),
  history: (before) => poller.history(before),
  cluster: () => ({ model: metrics.figures(), nodes: nodes.figures(), limits: settings.limits }),
  clusterHistory: () => figureHistory.snapshot(),
  subscribeCluster: (listener) => {
    const offModel = metrics.onChange((model) => listener({ model, nodes: nodes.figures(), limits: settings.limits }));
    const offNodes = nodes.onChange((figures) => listener({ model: metrics.figures(), nodes: figures, limits: settings.limits }));
    return () => {
      offModel();
      offNodes();
    };
  },
  runs: () => ({ status: runs.status(), runs: runs.records() }),
});

serve({ fetch: app.fetch, port: settings.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`tracker listening on http://localhost:${info.port} (loopback only)`);
});
