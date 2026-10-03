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

  it("returns 404 for non-api paths when staticRoot is null", async () => {
    const res = await makeApp().request("/", goodHost);
    expect(res.status).toBe(404);
  });
});
