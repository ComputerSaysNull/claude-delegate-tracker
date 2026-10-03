// A Hono app that serves the built page and a health endpoint, gated by a host allow-list.
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "./settings.ts";

export interface AppDeps {
  settings: Settings;
  staticRoot: string | null;
  isReadableDir: (dir: string) => boolean;
  now: () => Date;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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
  const { settings, staticRoot, isReadableDir, now } = deps;
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
