import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.ts";
import type { AppDeps } from "../../src/server/app.ts";
import type { ListResponse } from "../../src/server/poller.ts";
import type { Settings } from "../../src/server/settings.ts";

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    port: 1, transcriptDir: "C:\\t", allowedHosts: ["tracker.example"],
    quietAfterSeconds: 1, streamsPollSeconds: 1, ...overrides,
  };
}

const LIST: ListResponse = {
  rows: [], capped: false, total: 0, unstamped: 0, folderReadable: true, badLines: 0,
};

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    settings: makeSettings(),
    staticRoot: null,
    isReadableDir: () => true,
    now: () => new Date("2026-10-03T12:00:00Z"),
    streams: () => LIST,
    subscribe: () => () => {},
    ...overrides,
  });
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

  it("reports health without leaking the folder path", async () => {
    const res = await makeApp().request("/api/health", goodHost);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      checkedAt: "2026-10-03T12:00:00.000Z",
      transcriptFolder: { configured: true, readable: true },
    });
    expect(body).not.toContain("C:\\t");
  });

  it("reports readable false when the folder is unreadable", async () => {
    const res = await makeApp({ isReadableDir: () => false }).request("/api/health", goodHost);
    const body = (await res.json()) as { transcriptFolder: { readable: boolean } };
    expect(body.transcriptFolder.readable).toBe(false);
  });

  it("reports not configured without calling isReadableDir", async () => {
    const isReadableDir = vi.fn(() => true);
    const res = await makeApp({ settings: makeSettings({ transcriptDir: null }), isReadableDir }).request(
      "/api/health",
      goodHost
    );
    const body = (await res.json()) as { transcriptFolder: { configured: boolean; readable: boolean } };
    expect(body.transcriptFolder).toEqual({ configured: false, readable: false });
    expect(isReadableDir).not.toHaveBeenCalled();
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
