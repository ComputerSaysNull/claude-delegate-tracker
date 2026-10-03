import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.ts";
import type { AppDeps, Cluster } from "../../src/server/app.ts";
import type { Health } from "../../src/server/health.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import type { Settings } from "../../src/server/settings.ts";
import type { ListRow } from "../../src/server/streams.ts";
import type { StreamView, ViewPatch } from "../../src/server/view.ts";

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    port: 1, transcriptDir: "C:\\t", allowedHosts: ["tracker.example"],
    quietAfterSeconds: 1, streamsPollSeconds: 1, followPollSeconds: 1,
    metricsUrl: null, metricsTokenEnv: null, metricsPollSeconds: 1,
    nodes: [], nodeKey: null, nodeKnownHosts: null, nodesPollSeconds: 1, ...overrides,
  };
}

const HEALTH: Health = {
  checkedAt: "2026-10-03T12:00:00.000Z",
  transcriptFolder: { configured: true, readable: true },
  clockSkewSeconds: null,
  banners: [],
};

const MODEL: ModelFigures = {
  status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, decodeTokensPerSecond: 80,
  decodeWindowSeconds: 10, prefixHitPercent: 92, preemptions: null, readAt: "2026-10-03T12:00:00.000Z",
};

const LIST: ListResponse = {
  rows: [], capped: false, total: 0, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0,
};

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    settings: makeSettings(),
    staticRoot: null,
    health: () => HEALTH,
    subscribeHealth: () => () => {},
    streams: () => LIST,
    subscribe: () => () => {},
    view: () => null,
    follow: () => null,
    cluster: () => ({ model: MODEL, nodes: [] }),
    subscribeCluster: () => () => {},
    ...overrides,
  });
}

async function readUntil(res: Response, needle: string): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

describe("cluster figures", () => {
  it("serves the figures at /api/cluster", async () => {
    const res = await makeApp().request("/api/cluster", goodHost);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ model: MODEL, nodes: [] });
  });

  it("sends a cluster event on connect", async () => {
    const res = await makeApp().request("/api/updates", goodHost);
    const text = await readUntil(res, "event: cluster");
    expect(text).toContain("event: cluster");
    expect(text).toContain(JSON.stringify({ model: MODEL, nodes: [] }));
  });

  it("sends another cluster event when the figures change, and unsubscribes on disconnect", async () => {
    let listener: ((c: Cluster) => void) | undefined;
    const unsubscribe = vi.fn();
    const app = makeApp({ subscribeCluster: (l) => { listener = l; return unsubscribe; } });
    const res = await app.request("/api/updates", goodHost);
    const changed = { model: { ...MODEL, running: 5 }, nodes: [] };
    listener!(changed);
    const text = await readUntil(res, '"running":5');
    expect(text).toContain(JSON.stringify(changed));
    await new Promise((r) => setTimeout(r, 20));
    expect(unsubscribe).toHaveBeenCalled();
  });
});

function makeRow(name: string): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "delegate",
    model: null, effort: null, title: "", startedAt: null,
    elapsed: null, turns: null, unknownFormat: null,
  };
}

function makeView(name: string): StreamView {
  return {
    name, seq: 1, row: makeRow(name), task: null, files: [],
    waiting: null, turns: [], summary: null,
  };
}

function makePatch(name: string, seq: number): ViewPatch {
  return { name, seq, row: makeRow(name), waiting: null, turns: [], summary: null };
}

const goodHost = { headers: { host: "localhost" } };

describe("app", () => {
  it.each(["localhost", "localhost:8787", "127.0.0.1:8787", "[::1]:8787", "TRACKER.example"])(
    "allows host %s",
    async (host) => {
      const res = await makeApp().request("/api/health", { headers: { host } });
      expect(res.status).toBe(200);
    }
  );

  it.each(["evil.example", "localhost.evil.example", "127.0.0.1.evil.example", ""])(
    "rejects host %s",
    async (host) => {
      const res = await makeApp().request("/api/health", { headers: { host } });
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Host not allowed");
    }
  );

  it("rejects a request with no Host header", async () => {
    const res = await makeApp().request("/api/health");
    expect(res.status).toBe(403);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH"])("rejects method %s", async (method) => {
    const res = await makeApp().request("/api/health", { method, ...goodHost });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves the health report at /api/health", async () => {
    const res = await makeApp().request("/api/health", goodHost);
    expect(await res.json()).toEqual(HEALTH);
  });

  it("sends a health event on connect and again on a change, and unsubscribes on disconnect", async () => {
    let listener: ((h: Health) => void) | undefined;
    const unsubscribe = vi.fn();
    const app = makeApp({ subscribeHealth: (l) => { listener = l; return unsubscribe; } });
    const res = await app.request("/api/updates", goodHost);
    const changed: Health = { ...HEALTH, banners: [{ level: "warning", text: "The model server can't be reached." }] };
    listener!(changed);
    const text = await readUntil(res, "can't be reached");
    expect(text).toContain(`event: health\ndata: ${JSON.stringify(HEALTH)}`);
    expect(text).toContain(`event: health\ndata: ${JSON.stringify(changed)}`);
    await new Promise((r) => setTimeout(r, 20));
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("returns 404 JSON for unknown api paths", async () => {
    const res = await makeApp().request("/api/nope", goodHost);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("never sets access-control-allow-origin", async () => {
    const res = await makeApp().request("/api/health", goodHost);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves the SPA fallback from staticRoot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "app-"));
    try {
      writeFileSync(join(dir, "index.html"), "<h1>page</h1>");
      const app = makeApp({ staticRoot: dir });
      for (const path of ["/", "/some/deep/link"]) {
        const res = await app.request(path, goodHost);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("<h1>page</h1>");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves a real file from staticRoot, and nothing from outside it", async () => {
    const parent = mkdtempSync(join(tmpdir(), "app-"));
    const dir = join(parent, "web");
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "index.html"), "<h1>page</h1>");
      writeFileSync(join(dir, "assets", "a.js"), "export {};");
      writeFileSync(join(parent, "secret.txt"), "SECRET");
      const app = makeApp({ staticRoot: dir });
      const asset = await app.request("/assets/a.js", goodHost);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe("export {};");
      for (const path of ["/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%5c..%5csecret.txt"]) {
        expect(await (await app.request(path, goodHost)).text()).not.toContain("SECRET");
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("serves the poller's list at /api/streams, read fresh on each request", async () => {
    let list = LIST;
    const app = makeApp({ streams: () => list });
    expect(await (await app.request("/api/streams", goodHost)).json()).toEqual(LIST);
    list = { ...LIST, total: 3, capped: true };
    expect(await (await app.request("/api/streams", goodHost)).json()).toEqual(list);
  });

  it("streams the list at /api/updates", async () => {
    const res = await makeApp().request("/api/updates", goodHost);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: list");
    expect(text).toContain(JSON.stringify(LIST));
    await reader.cancel();
  });

  it("delivers a later list through subscribe as another list event", async () => {
    let listener: ((list: ListResponse) => void) | undefined;
    const app = makeApp({
      subscribe: (l) => {
        listener = l;
        return () => {};
      },
    });
    const res = await app.request("/api/updates", goodHost);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const changed = { ...LIST, total: 7 };
    listener!(changed);
    let text = "";
    while (!text.includes('"total":7')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain("event: list");
    expect(text).toContain(JSON.stringify(changed));
    await reader.cancel();
  });

  it("unsubscribes when the client disconnects", async () => {
    const unsubscribe = vi.fn();
    const app = makeApp({ subscribe: () => unsubscribe });
    const res = await app.request("/api/updates", goodHost);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("rejects a foreign host for /api/updates", async () => {
    const res = await makeApp().request("/api/updates", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("returns 404 for non-api paths when staticRoot is null", async () => {
    const res = await makeApp().request("/", goodHost);
    expect(res.status).toBe(404);
  });
});

describe("stream view routes", () => {
  it("returns the deps.view result for a known name", async () => {
    const view = vi.fn((name: string) => makeView(name));
    const app = makeApp({ view });
    const res = await app.request("/api/streams/20261001T120000.000-a.jsonl", goodHost);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(makeView("20261001T120000.000-a.jsonl"));
    expect(view).toHaveBeenCalledWith("20261001T120000.000-a.jsonl");
  });

  it("returns 404 JSON when deps.view returns null", async () => {
    const view = vi.fn(() => null);
    const app = makeApp({ view });
    const res = await app.request("/api/streams/20261001T120000.000-a.jsonl", goodHost);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("never treats a stream name as a path", async () => {
    const view = vi.fn(() => null);
    const app = makeApp({ view });
    const res = await app.request("/api/streams/..%2F..%2Fsecret.jsonl", goodHost);
    // The lookup returns null (a name the backend did not list itself), so nothing is
    // served from the filesystem, whatever decoding the router applied to the name.
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns 404 for an unknown stream in /api/updates", async () => {
    const follow = vi.fn(() => null);
    const app = makeApp({ follow });
    const res = await app.request("/api/updates?stream=missing", goodHost);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("streams a followed stream's patch and unsubscribes on abort", async () => {
    let captured: ((patch: ViewPatch) => void) | undefined;
    const unfollow = vi.fn();
    const name = "20261001T120000.000-a.jsonl";
    const patch = makePatch(name, 2);
    const app = makeApp({
      follow: (n, listener) => {
        expect(n).toBe(name);
        captured = listener;
        return unfollow;
      },
    });
    const res = await app.request(`/api/updates?stream=${name}`, goodHost);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // the initial list event
    expect(captured).toBeDefined();
    captured!(patch);
    let text = "";
    while (!text.includes("event: stream")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain("event: stream");
    expect(text).toContain(JSON.stringify(patch));
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(unfollow).toHaveBeenCalled();
  });

  it("rejects POST to a stream view route with 405", async () => {
    const app = makeApp();
    const res = await app.request("/api/streams/20261001T120000.000-a.jsonl", { method: "POST", ...goodHost });
    expect(res.status).toBe(405);
  });
});
