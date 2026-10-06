// @vitest-environment jsdom
// The phone layout, below Tailwind's lg breakpoint. jsdom applies no CSS, so the behaviour is
// carried by class names: a bottom section bar, the cluster strip as a link to /cluster, and the
// list's own header with a Search toggle. The list, cluster and health payloads come from the
// same fixtures the desktop tests use.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

function row(name: string, title: string): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "claude-code", model: null, effort: null,
    title, startedAt: null, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null, workspace: null,
  };
}

const LIST: ListResponse = {
  rows: [row("s1", "First delegation"), row("s2", "Second delegation")],
  capped: false, total: 2, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0,
};

const CLUSTER_FULL = {
  model: {
    status: "ok", running: 2, waiting: 0, kvCachePercent: 7.4, decodeTokensPerSecond: 41.2,
    decodeWindowSeconds: 10, prefixHitPercent: 91.8, preemptions: null, readAt: null,
  },
  nodes: [
    { name: "node-a", status: "ok", cpuPercent: 12, cpuWindowSeconds: 5, cpuTempC: 52, gpuPercent: 86, gpuTempC: 74, readAt: null },
    { name: "node-b", status: "ok", cpuPercent: 9, cpuWindowSeconds: 5, cpuTempC: 49, gpuPercent: 64, gpuTempC: 66, readAt: null },
  ],
  limits: { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 },
};

const CLUSTER_EMPTY = {
  model: {
    status: "not configured", running: null, waiting: null, kvCachePercent: null,
    decodeTokensPerSecond: null, decodeWindowSeconds: null, prefixHitPercent: null,
    preemptions: null, readAt: null,
  },
  nodes: [],
  limits: { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 },
};

const HEALTH_OK = { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: true } };
const HEALTH_UNREADABLE = { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: false } };

// The live feed, mutable so a test can swap the cluster or health before a render.
const live: {
  list: typeof LIST;
  cluster: typeof CLUSTER_FULL | typeof CLUSTER_EMPTY;
  health: typeof HEALTH_OK;
  connected: boolean;
} = { list: LIST, cluster: CLUSTER_FULL, health: HEALTH_OK, connected: true };

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({ list: live.list, cluster: live.cluster, health: live.health, connected: live.connected }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({ useClusterHistory: () => null }));
vi.mock("../../src/web/Sparkline.tsx", () => ({
  Sparkline: () => <div role="img" aria-label="sparkline" />,
  windowLabel: (s: number) => `last ${Math.round(s / 60)} minutes`,
}));
// The detail pane fetches its own data; here it only has to say which delegation it shows.
vi.mock("../../src/web/StreamPage.tsx", () => ({
  StreamPage: ({ name }: { name: string }) => <div data-testid="detail">detail of {name}</div>,
}));

const { default: App } = await import("../../src/web/App.tsx");

const listNav = () => screen.getByRole("navigation", { name: "Delegations" });
const clusterSection = () => screen.getByRole("region", { name: "Cluster" });
// The phone list header: the nearest "lg:hidden" ancestor of the Search button. Start from the
// button's parent so a "lg:hidden" class on the button itself (a phone-only control) is skipped.
const phoneHeader = () =>
  screen.getByRole("button", { name: "Search" }).parentElement!.closest<HTMLElement>('[class*="lg:hidden"]')!;

describe("the phone layout", () => {
  beforeEach(() => {
    live.cluster = CLUSTER_FULL;
    live.health = HEALTH_OK;
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("puts Delegations and Cluster links in a bottom section bar", () => {
    render(<App />);
    const bar = screen.getByRole("navigation", { name: "Sections" });
    expect(bar.className).toMatch(/\blg:hidden\b/);
    const delegations = screen.getByRole("link", { name: "Delegations" });
    expect(delegations.getAttribute("href")).toBe("/");
    const cluster = screen.getByRole("link", { name: "Cluster" });
    expect(cluster.getAttribute("href")).toBe("/cluster");
    expect(delegations.getAttribute("aria-current")).toBe("page");
    expect(cluster.getAttribute("aria-current")).toBeNull();
    fireEvent.click(cluster);
    expect(window.location.pathname).toBe("/cluster");
    expect(cluster.getAttribute("aria-current")).toBe("page");
    expect(delegations.getAttribute("aria-current")).toBeNull();
  });

  it("shows the list on / and the cluster band on /cluster", () => {
    render(<App />);
    expect(listNav().className).not.toMatch(/(^|\s)hidden\b/);
    expect(clusterSection().className).toMatch(/(^|\s)hidden\b/);
    expect(clusterSection().className).toMatch(/\blg:flex\b/);

    act(() => {
      window.history.replaceState(null, "", "/cluster");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(listNav().className).toMatch(/(^|\s)hidden\b/);
    expect(listNav().className).toMatch(/\blg:flex\b/);
    expect(clusterSection().className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("going Back from /cluster shows the list again", () => {
    window.history.replaceState(null, "", "/cluster");
    render(<App />);
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(listNav().className).not.toMatch(/(^|\s)hidden\b/);
    expect(clusterSection().className).toMatch(/(^|\s)hidden\b/);
  });

  it("makes the cluster strip a link to /cluster", () => {
    render(<App />);
    const strip = screen.getByRole("link", { name: /tok\/s|running|KV/ });
    expect(strip.getAttribute("href")).toBe("/cluster");
  });

  it("renders no strip link when the cluster has no figures", () => {
    live.cluster = CLUSTER_EMPTY;
    render(<App />);
    // The strip is the link itself, so its absence means there is no empty strip element either.
    expect(screen.queryByRole("link", { name: /tok\/s|running|KV/ })).toBeNull();
    // Nor an empty strip: the only link to /cluster left is the bottom bar's.
    const toCluster = [...document.querySelectorAll('a[href="/cluster"]')].filter(
      (a) => a.closest('nav[aria-label="Sections"]') === null,
    );
    expect(toCluster).toHaveLength(0);
  });

  it("hides the page header on a phone", () => {
    render(<App />);
    const header = screen.getByRole("heading", { name: "Delegation tracker" }).closest("header")!;
    expect(header.className).toMatch(/(^|\s)hidden\b/);
    expect(header.className).toMatch(/\blg:flex\b/);
  });

  it("hides the section bar while a delegation is open", () => {
    window.history.replaceState(null, "", "/s/s1");
    render(<App />);
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
  });

  it("shows a phone list header with a Search toggle for the search box", () => {
    render(<App />);
    const search = screen.getByRole("button", { name: "Search" });
    expect(search.getAttribute("aria-expanded")).toBe("false");
    const header = phoneHeader();
    expect(header.className).toMatch(/\blg:hidden\b/);
    expect(within(header).getAllByRole("heading", { name: "Delegations" }).length).toBeGreaterThan(0);

    const searchbox = screen.getByRole("searchbox", { name: "Search titles" });
    const collapsible = searchbox.closest<HTMLElement>('[class*="lg:flex"]')!;
    expect(collapsible.className).toMatch(/(^|\s)hidden\b/);
    expect(collapsible.className).toMatch(/\blg:flex\b/);

    fireEvent.click(search);
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(collapsible.className).not.toMatch(/(^|\s)hidden\b/);
  });

  it("shows the health pill in the phone header only when something is wrong", () => {
    const { rerender } = render(<App />);
    expect(within(phoneHeader()).queryByText("Health ok")).toBeNull();

    live.health = HEALTH_UNREADABLE;
    rerender(<App />);
    expect(within(phoneHeader()).getByText("Folder not readable")).toBeTruthy();
  });

  // The phone header is too narrow for the pill's words beside "Delegations": the icon shows,
  // the words stay for a screen reader and a hover.
  it("draws the phone's health pill as an icon, its words kept for a screen reader", () => {
    live.health = HEALTH_UNREADABLE;
    render(<App />);
    const words = within(phoneHeader()).getByText("Folder not readable");
    expect(words.className.split(/\s+/)).toContain("sr-only");
    expect(words.closest("[role=status]")!.getAttribute("title")).toBe("Folder not readable");
  });

  it("titles the phone's cluster screen Cluster", () => {
    window.history.replaceState(null, "", "/cluster");
    render(<App />);
    const heading = within(clusterSection()).getByRole("heading", { name: "Cluster" });
    expect(heading.className.split(/\s+/)).toContain("lg:hidden");
  });
});
