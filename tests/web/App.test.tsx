// @vitest-environment jsdom
// The page's frame: the cluster figures across the top, the list on the left and the open
// delegation on the right on a wide screen, one of the two on a phone. Opening a delegation
// never reloads the page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";
import { localTime } from "../../src/web/time.ts";

const CHECKED_AT = "2026-10-04T12:00:00.000Z";

function row(name: string, title: string): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "claude-code", model: null, effort: null,
    title, startedAt: null, elapsed: null, turns: null, unknownFormat: null,
  };
}

const LIST: ListResponse = {
  rows: [row("s1", "First delegation"), row("s2", "Second delegation")],
  capped: false, total: 2, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0,
};

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: LIST,
    cluster: null,
    connected: true,
    health: { checkedAt: CHECKED_AT, banners: [], transcriptFolder: { configured: true, readable: true } },
  }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({ useClusterHistory: () => null }));
// The detail pane fetches its own data; here it only has to say which delegation it shows.
vi.mock("../../src/web/StreamPage.tsx", () => ({
  StreamPage: ({ name, onClose }: { name: string; onClose: () => void }) => (
    <div data-testid="detail">
      detail of {name}
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}));

const { default: App } = await import("../../src/web/App.tsx");

const listPane = () => screen.getByRole("navigation", { name: "Delegations" });
const detailPane = () => screen.getByRole("main");

describe("App", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  afterEach(cleanup);

  it("shows the health check's time in Plex Mono with tabular digits", () => {
    render(<App />);
    const time = screen.getByText(localTime(CHECKED_AT));
    expect(time.className).toMatch(/\bfont-mono\b/);
    expect(time.className).toMatch(/\btabular-nums\b/);
  });

  it("puts the cluster figures in a band across the top, before the list and the detail", () => {
    render(<App />);
    const band = screen.getByRole("region", { name: "Cluster" });
    expect(band.compareDocumentPosition(listPane()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Model server" }).closest("[aria-label='Cluster']")).toBe(band);
  });

  it("opens a delegation in the right-hand pane without a page load", () => {
    render(<App />);
    const link = screen.getByRole("link", { name: "Second delegation" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(screen.getByTestId("detail").textContent).toContain("detail of s2");
    expect(link.closest("li")!.getAttribute("aria-current")).toBe("true");
  });

  it("leaves a click with a modifier key to the browser, so a new tab still works", () => {
    render(<App />);
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "First delegation" }), { ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("asks for a choice in the right-hand pane while nothing is open", () => {
    render(<App />);
    expect(detailPane().textContent).toMatch(/Choose a delegation/);
  });

  it("lays out list and detail side by side from the lg breakpoint, the list capped in width", () => {
    render(<App />);
    expect(listPane().parentElement!.className).toMatch(/\blg:flex-row\b/);
    expect(listPane().className).toMatch(/\blg:max-w-/);
  });

  it("on a phone shows the list until one opens, then only the delegation", () => {
    render(<App />);
    expect(listPane().className).not.toMatch(/(^|\s)hidden\b/);
    expect(detailPane().className).toMatch(/(^|\s)hidden\b/);
    expect(detailPane().className).toMatch(/\blg:flex\b/);
    fireEvent.click(screen.getByRole("link", { name: "First delegation" }));
    expect(listPane().className).toMatch(/(^|\s)hidden\b/);
    expect(listPane().className).toMatch(/\blg:flex\b/);
    expect(detailPane().className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("closing the delegation brings the list back", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "First delegation" }));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(screen.queryByTestId("detail")).toBeNull();
    expect(listPane().className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("still opens the delegation named by an old /s/<name> address", () => {
    window.history.replaceState(null, "", "/s/s1");
    render(<App />);
    expect(screen.getByTestId("detail").textContent).toContain("detail of s1");
  });

  it("uses the screen's width rather than a narrow column", () => {
    const { container } = render(<App />);
    expect(container.innerHTML).not.toMatch(/\bmax-w-xl\b/);
  });
});
