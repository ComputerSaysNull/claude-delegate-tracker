// @vitest-environment jsdom
// The page's frame: a time that stands on its own is in Plex Mono, with tabular digits.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { localTime } from "../../src/web/time.ts";

const CHECKED_AT = "2026-10-04T12:00:00.000Z";

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: null,
    cluster: null,
    connected: true,
    health: { checkedAt: CHECKED_AT, banners: [], transcriptFolder: { configured: true, readable: true } },
  }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({ useClusterHistory: () => null }));

const { default: App } = await import("../../src/web/App.tsx");

describe("App", () => {
  afterEach(cleanup);

  it("shows the health check's time in Plex Mono with tabular digits", () => {
    render(<App />);
    const time = screen.getByText(localTime(CHECKED_AT));
    expect(time.className).toMatch(/\bfont-mono\b/);
    expect(time.className).toMatch(/\btabular-nums\b/);
  });
});
