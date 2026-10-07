// @vitest-environment jsdom
// The History tab: on a wide screen a Delegation / History switch at the top of the main
// column, on a phone a third link in the bottom bar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: null,
    connected: true,
    health: { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: true } },
    cluster: null,
  }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({ useClusterHistory: () => null }));
// The page itself is tested on its own; here only where it appears.
vi.mock("../../src/web/HistoryPage.tsx", () => ({ HistoryPage: () => <section aria-label="History" /> }));

const { default: App } = await import("../../src/web/App.tsx");

describe("the History tab", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  afterEach(cleanup);

  const main = () => screen.getByRole("main");

  it("switches the main column between the delegation and History, and the address with it", () => {
    render(<App />);
    const delegation = within(main()).getByRole("link", { name: "Delegation" });
    const history = within(main()).getByRole("link", { name: "History" });
    expect(delegation.getAttribute("aria-current")).toBe("page");
    expect(within(main()).queryByRole("region", { name: "History" })).toBeNull();

    fireEvent.click(history);
    expect(window.location.pathname).toBe("/history");
    expect(history.getAttribute("aria-current")).toBe("page");
    expect(delegation.getAttribute("aria-current")).toBeNull();
    expect(within(main()).getByRole("region", { name: "History" })).toBeTruthy();

    fireEvent.click(delegation);
    expect(window.location.pathname).toBe("/");
    expect(within(main()).queryByRole("region", { name: "History" })).toBeNull();
  });

  it("keeps the switch to a wide screen", () => {
    render(<App />);
    const bar = within(main()).getByRole("link", { name: "Delegation" }).parentElement!.parentElement!;
    expect(bar.className).toMatch(/(^|\s)hidden\b/);
    expect(bar.className).toMatch(/\blg:flex\b/);
  });

  it("opens History from a third link in the phone's bottom bar, and shows the main column there", () => {
    render(<App />);
    const bar = screen.getByRole("navigation", { name: "Sections" });
    expect(bar.className).toMatch(/\bgrid-cols-3\b/);
    const link = within(bar).getByRole("link", { name: "History" });
    expect(link.getAttribute("href")).toBe("/history");
    expect(main().className).toMatch(/(^|\s)hidden\b/);
    fireEvent.click(link);
    expect(window.location.pathname).toBe("/history");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(main().className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("opens History straight from its address", () => {
    window.history.replaceState(null, "", "/history");
    render(<App />);
    expect(within(main()).getByRole("region", { name: "History" })).toBeTruthy();
  });
});
