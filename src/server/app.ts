// A Hono app that serves the built page and a health endpoint, gated by a host allow-list.
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ListResponse } from "./poller.ts";
import type { Settings } from "./settings.ts";
import type { StreamView, ViewPatch } from "./view.ts";

export interface AppDeps {
  settings: Settings;
  staticRoot: string | null;
  isReadableDir: (dir: string) => boolean;
  now: () => Date;
  streams: () => ListResponse;
  subscribe: (listener: (list: ListResponse) => void) => () => void;
  // Both return null for a name the backend did not list itself.
  view: (name: string) => StreamView | null;
  follow: (name: string, listener: (patch: ViewPatch) => void) => (() => void) | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const PING_MS = 15_000;

function hostAllowed(host: string, allowedHosts: string[]): boolean {
  let h = host;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end === -1) return false;
    h = h.slice(1, end);
  } else {
    const colon = h.lastIndexOf(":");
    if (colon !== -1) h = h.slice(0, colon);
  }
  const lower = h.toLowerCase();
  return LOCAL_HOSTS.has(lower) || allowedHosts.some((a) => a.toLowerCase() === lower);
}

export function createApp(deps: AppDeps): Hono {
  const { settings, staticRoot, isReadableDir, now, streams, subscribe, view, follow } = deps;
  const app = new Hono();

  // Reject hosts that are neither local nor allow-listed (stops DNS rebinding).
  app.use(async (c, next) => {
    const host = c.req.header("host");
    if (!host || !hostAllowed(host, settings.allowedHosts)) {
      return c.text("Host not allowed", 403);
    }
    await next();
  });

  // Only GET and HEAD are served.
  app.use(async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("Method Not Allowed", 405, { Allow: "GET, HEAD" });
    }
    await next();
  });

  app.get("/api/health", (c) => {
    const configured = settings.transcriptDir !== null;
    const readable = settings.transcriptDir !== null && isReadableDir(settings.transcriptDir);
    return c.json({
      checkedAt: now().toISOString(),
      transcriptFolder: { configured, readable },
    });
  });

  // The list rows, already derived by the poller; the page only lays them out.
  app.get("/api/streams", (c) => c.json(streams()));

  // One stream's whole view; the name is only ever looked up, never joined onto a path.
  app.get("/api/streams/:name", (c) => {
    const found = view(c.req.param("name"));
    return found === null ? c.json({ error: "not found" }, 404) : c.json(found);
  });

  // Stream the list to the page so it updates without a reload; with ?stream=<name>,
  // also that stream's patches.
  app.get("/api/updates", (c) => {
    const name = c.req.query("stream");
    const patches: ViewPatch[] = [];
    let wake: (() => void) | null = null;
    let unfollow: (() => void) | null = null;
    if (name !== undefined) {
      unfollow = follow(name, (patch) => {
        patches.push(patch);
        wake?.();
      });
      if (unfollow === null) return c.json({ error: "not found" }, 404);
    }
    return streamSSE(c, async (stream) => {
      stream.writeSSE({ event: "list", data: JSON.stringify(streams()) });
      const unsubscribe = subscribe((list) => {
        stream.writeSSE({ event: "list", data: JSON.stringify(list) });
      });
      // Patches may arrive before the stream opens; send them in order.
      const flush = (): void => {
        for (const patch of patches.splice(0)) stream.writeSSE({ event: "stream", data: JSON.stringify(patch) });
      };
      wake = flush;
      flush();

      let timer: ReturnType<typeof setInterval> | null = null;
      const disconnected = new Promise<void>((resolve) => {
        stream.onAbort(() => {
          unsubscribe();
          unfollow?.();
          if (timer !== null) clearInterval(timer);
          resolve();
        });
      });
      timer = setInterval(() => stream.write(": ping\n\n"), PING_MS);

      await disconnected;
    });
  });

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  if (staticRoot) {
    app.use("*", serveStatic({ root: staticRoot }));
    // Serve the built page for any path that is not a file.
    app.get("*", (c) => c.html(readFileSync(join(staticRoot, "index.html"), "utf8")));
  } else {
    app.all("*", (c) => c.text("Not Found", 404));
  }

  return app;
}
