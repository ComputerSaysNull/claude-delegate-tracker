// @vitest-environment jsdom
// A page the browser keeps in its back/forward cache must not keep its live connections.
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeEventSource {
  static made: FakeEventSource[] = [];
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.made.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

async function load() {
  vi.resetModules();
  FakeEventSource.made = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return import("../../src/web/live.ts");
}

describe("live connections", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("closes every open connection when the page is hidden", async () => {
    const { openLive } = await load();
    openLive("/api/updates");
    openLive("/api/updates?stream=a.jsonl");
    window.dispatchEvent(new Event("pagehide"));
    expect(FakeEventSource.made.map((s) => s.closed)).toEqual([true, true]);
  });

  it("does not track a connection that was closed already", async () => {
    const { openLive, closeLive } = await load();
    const source = openLive("/api/updates");
    closeLive(source);
    expect(FakeEventSource.made[0].closed).toBe(true);
  });

  it("reloads a page that comes back from the back/forward cache, and only then", async () => {
    const { page } = await load();
    const reload = vi.fn();
    page.reload = reload;
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(reload).not.toHaveBeenCalled();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
