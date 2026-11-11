// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bottomInView, bottomInViewOnceObserved, installIntersectionObserver, observerCounts } from "./intersection.ts";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import { localTime } from "../../src/web/time.ts";
import { STATE_LABEL } from "../../src/web/states.tsx";
import { NO_FILTER } from "../../src/web/filter.ts";
import type { HistoryPage, ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

const STATES: ListRow["state"][] = ["live", "queued", "quiet", "ok", "failed", "cut off"];

function row(overrides: Partial<ListRow> = {}): ListRow {
  return {
    name: "stream-1",
    state: "live",
    why: null,
    age: null,
    kind: "claude-code",
    model: null,
    effort: null,
    title: "Refactor the auth module",
    startedAt: null,
    elapsed: null,
    turns: null,
    unknownFormat: null,
    left: null,
    queueOf: null,
    workspace: null, mcpTask: null, messaged: false, asked: false,
    ...overrides,
  };
}

function list(rows: ListRow[], overrides: Partial<ListResponse> = {}): ListResponse {
  return {
    rows,
    capped: false,
    total: rows.length,
    unstamped: 0,
    folderReadable: true,
    badLines: 0,
    schemaFailures: 0,
    choices: { kinds: [], models: [], repos: [] },
    ...overrides,
  };
}

function page(overrides: Partial<HistoryPage> = {}): HistoryPage {
  return { rows: [], nextBefore: null, ...overrides };
}

describe("DelegationList", () => {
  beforeEach(() => {
    installIntersectionObserver();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("links the title and truncates it on the link itself, so a long title cannot widen a phone screen", () => {
    render(<DelegationList list={list([row({ title: "A title long enough to need cutting on a phone" })])} />);
    const link = screen.getByRole("link", { name: "A title long enough to need cutting on a phone" });
    expect(link.getAttribute("href")).toBe("/s/stream-1");
    expect(link.className).toMatch(/\bmin-w-0\b/);
    expect(link.className).toMatch(/\btruncate\b/);
  });

  it("opens a delegation from a click anywhere on its card, which shows the hand cursor", () => {
    const onOpen = vi.fn();
    render(<DelegationList list={list([row({ name: "s1.jsonl", title: "Card title", turns: "3" })])} onOpen={onOpen} />);
    const card = screen.getByRole("link", { name: "Card title" }).closest("li")!;
    expect(card.className).toMatch(/\bcursor-pointer\b/);
    fireEvent.click(card.querySelector("p")!);
    expect(onOpen).toHaveBeenCalledWith("s1.jsonl");
  });

  it("leaves a modified click on the card to the browser, and opens once from the title", () => {
    const onOpen = vi.fn();
    render(<DelegationList list={list([row({ name: "s1.jsonl", title: "Card title", turns: "3" })])} onOpen={onOpen} />);
    const link = screen.getByRole("link", { name: "Card title" });
    fireEvent.click(link.closest("li")!.querySelector("p")!, { ctrlKey: true });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("gives each card its state's icon, named for a screen reader", () => {
    render(<DelegationList list={list([row({ state: "failed" })])} />);
    const icon = screen.getByRole("img", { name: "Failed" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
  });

  it("tints a running card more strongly than a finished one", () => {
    const { container } = render(<DelegationList list={list([row({ state: "live" }), row({ name: "s2", state: "ok" })])} />);
    const [running, finished] = [...container.querySelectorAll("li")];
    expect(running.className).toMatch(/bg-state-live\/12/);
    expect(finished.className).toMatch(/bg-state-ok\/8/);
  });

  it("shows the waiting line for a null list", () => {
    render(<DelegationList list={null} />);
    expect(screen.getByText("Waiting for the first list…")).toBeTruthy();
  });

  it("shows a capped note with a locale-safe total", () => {
    const total = 1212;
    render(<DelegationList list={list([row({ name: "a" }), row({ name: "b" })], { capped: true, total })} />);
    expect(screen.getByText(`Showing the newest 2 of ${total.toLocaleString()}`)).toBeTruthy();
  });

  it("no longer shows the folder-unreadable note (that fact lives in the health banners)", () => {
    render(<DelegationList list={list([], { folderReadable: false })} />);
    expect(screen.queryByText("The transcript folder can't be read; showing the last known list.")).toBeNull();
  });

  it("shows the empty message for no rows", () => {
    render(<DelegationList list={list([])} />);
    expect(screen.getByText("No delegations yet.")).toBeTruthy();
  });

  it("renders a state icon for every state", () => {
    for (const state of STATES) {
      render(<DelegationList list={list([row({ state })])} />);
      expect(screen.getByRole("img", { name: STATE_LABEL[state] })).toBeTruthy();
    }
  });

  it("omits null meta pieces and never leaves a dangling separator", () => {
    render(<DelegationList list={list([row({ kind: "one-shot" })])} />);
    // `one-shot` also appears as a kind-filter option, so scope to the meta paragraph.
    const meta = screen.getByText("one-shot", { selector: "p" });
    expect(meta.textContent).toBe("one-shot");
    expect(screen.queryByText("null")).toBeNull();
    expect(screen.queryByText("·")).toBeNull();
  });

  it("shows the start time in local time", () => {
    const startedAt = new Date("2024-01-15T13:45:00Z").toISOString();
    render(<DelegationList list={list([row({ startedAt })])} />);
    expect(screen.getByText(localTime(startedAt))).toBeTruthy();
  });

  it("shows a dash when startedAt is null", () => {
    render(<DelegationList list={list([row({ startedAt: null })])} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows quiet-for when the row is quiet", () => {
    render(<DelegationList list={list([row({ state: "quiet", age: "5m" })])} />);
    expect(screen.getByText(/quiet for 5m/)).toBeTruthy();
  });

  it("shows the why for a failed row", () => {
    render(<DelegationList list={list([row({ state: "failed", why: "rate limited" })])} />);
    expect(screen.getByText("rate limited")).toBeTruthy();
  });

  it("shows the unknown-format note", () => {
    render(<DelegationList list={list([row({ unknownFormat: "2.0" })])} />);
    expect(screen.getByText("format 2.0: shown as best it can be")).toBeTruthy();
  });

  it("shows no list-end marker and fetches nothing when the list is not capped", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "live" })])} />);
    expect(screen.queryByTestId("list-end")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the next page from the last live row's name and renders the returned rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "An older delegation" })], nextBefore: "older-2" })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    expect(await screen.findByText("An older delegation")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/streams?before=last%20live");
  });

  it("uses the previous page's nextBefore for the following request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "First older" })], nextBefore: "older-2" })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-3", title: "Second older" })], nextBefore: "older-4" })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    await screen.findByText("First older");
    await bottomInViewOnceObserved();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Second older");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/streams?before=last%20live");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/streams?before=older-2");
  });

  it("shows 'No older delegations' and no button when nextBefore is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "Last older" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    expect(await screen.findByText("No older delegations")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("shows an amber note and keeps the Try again button when the fetch fails with a non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    expect(await screen.findByText("Could not load older delegations.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("does not render an older row whose name is already shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "dup", title: "Already shown" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "dup", title: "Already shown" })], { capped: true, total: 21 })} />);
    bottomInView();
    await screen.findByText("Already shown");
    expect(screen.getAllByText("Already shown")).toHaveLength(1);
  });

  it("narrows the rows when typing in the search input", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", title: "Refactor the auth module" }),
          row({ name: "b", title: "Fix the login screen" }),
        ])}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Search titles" });
    fireEvent.change(search, { target: { value: "auth" } });
    expect(screen.getByText("Refactor the auth module")).toBeTruthy();
    expect(screen.queryByText("Fix the login screen")).toBeNull();
  });

  it("shows only the selected state from the states menu", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", state: "live", title: "Live task" }),
          row({ name: "b", state: "ok", title: "Ok task" }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const okBox = screen.getByRole("checkbox", { name: STATE_LABEL.ok });
    fireEvent.click(okBox);
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeTruthy();
    expect(screen.getByText("Ok task")).toBeTruthy();
    expect(screen.queryByText("Live task")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: STATE_LABEL.ok }));
    expect(screen.getByText("Live task")).toBeTruthy();
    expect(screen.getByText("Ok task")).toBeTruthy();
  });

  it("narrows by kind", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", kind: "claude-code", title: "Code task" }),
          row({ name: "b", kind: "one-shot", title: "One shot task" }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const kind = screen.getByRole("combobox", { name: "Kind" });
    fireEvent.change(kind, { target: { value: "one-shot" } });
    expect(screen.getByText("One shot task")).toBeTruthy();
    expect(screen.queryByText("Code task")).toBeNull();
  });

  it("narrows by model", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", model: "claude-sonnet-4", title: "Sonnet task" }),
          row({ name: "b", model: "claude-opus-4", title: "Opus task" }),
        ])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const model = screen.getByRole("combobox", { name: "Model" });
    fireEvent.change(model, { target: { value: "claude-opus-4" } });
    expect(screen.getByText("Opus task")).toBeTruthy();
    expect(screen.queryByText("Sonnet task")).toBeNull();
  });

  it("shows the N of M loaded line and Clear restores all rows", () => {
    render(
      <DelegationList
        list={list([
          row({ name: "a", title: "Alpha" }),
          row({ name: "b", title: "Beta" }),
          row({ name: "c", title: "Gamma" }),
        ])}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "Search titles" });
    fireEvent.change(search, { target: { value: "alpha" } });
    expect(screen.getByText("Showing 1 of 3 loaded")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
  });

  it("shows the no-match message when nothing matches", () => {
    render(<DelegationList list={list([row({ name: "a", title: "Alpha" })])} />);
    const search = screen.getByRole("searchbox", { name: "Search titles" });
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No loaded delegation matches.")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("carries the current filter on the Older fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "old-rare", model: "rare", title: "Older rare" })], nextBefore: "more-1" })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-2", model: "rare", title: "Second older" })], nextBefore: null })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: null, model: "rare", repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    await screen.findByText("Older rare");
    await bottomInViewOnceObserved();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText("Second older");
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.searchParams.get("before")).toBe("more-1");
    expect(url.searchParams.get("model")).toBe("rare");
  });

  it("loads the first filtered older page by itself when a filter is set and the list is capped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "old-rare", model: "rare", title: "Older rare" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: null, model: "rare", repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    expect(await screen.findByText("Older rare")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("before")).toBe("last live");
    expect(url.searchParams.get("model")).toBe("rare");
  });

  it("drops the previous filter's older rows and loads the first page for the new filter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "old-rare", model: "rare", kind: "delegate", title: "Older rare" })], nextBefore: null })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "old-other", model: "other", kind: "delegate", title: "Older other" })], nextBefore: null })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: null, model: "rare", repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    await screen.findByText("Older rare");
    rerender(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: "delegate", model: null, repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    expect(await screen.findByText("Older other")).toBeTruthy();
    expect(screen.queryByText("Older rare")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.searchParams.get("before")).toBe("last live");
    expect(url.searchParams.get("kind")).toBe("delegate");
  });

  it("ignores an older page that resolves after the filter has changed", async () => {
    let resolveRare!: (r: Response) => void;
    const rare = new Promise<Response>((resolve) => {
      resolveRare = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(rare)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "old-other", model: "other", kind: "delegate", title: "Older other" })], nextBefore: null })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: null, model: "rare", repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    rerender(
      <DelegationList
        list={list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 })}
        filter={{ text: "", states: [], kind: "delegate", model: null, repo: null, messaged: false, from: null, to: null, caller: null }}
        onFilterChange={() => {}}
      />,
    );
    expect(await screen.findByText("Older other")).toBeTruthy();
    await act(async () => {
      resolveRare(
        new Response(JSON.stringify(page({ rows: [row({ name: "old-rare", model: "rare", kind: "delegate", title: "Older rare" })], nextBefore: null })), { status: 200 }),
      );
    });
    expect(screen.queryByText("Older rare")).toBeNull();
  });

  it("fetches the unfiltered page when the filter is cleared while its page is still loading", async () => {
    const never = new Promise<Response>(() => {});
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(never)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "An older delegation" })], nextBefore: null })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const capped = list([row({ name: "last live", model: "rare", title: "Live rare" })], { capped: true, total: 21 });
    const { rerender } = render(
      <DelegationList list={capped} filter={{ text: "", states: [], kind: null, model: "rare", repo: null, messaged: false, from: null, to: null, caller: null }} onFilterChange={() => {}} />,
    );
    expect((await screen.findByRole("status")).textContent).toBe("Loading…");
    rerender(<DelegationList list={capped} filter={NO_FILTER} onFilterChange={() => {}} />);
    bottomInView();
    expect(await screen.findByText("An older delegation")).toBeTruthy();
    const url = new URL(fetchMock.mock.calls[1][0], "http://localhost");
    expect(url.searchParams.has("model")).toBe(false);
  });

  it("fetches nothing by itself when no filter is set", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DelegationList
        list={list([row({ name: "last live", title: "Live task" })], { capped: true, total: 21 })}
        filter={NO_FILTER}
        onFilterChange={() => {}}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once per report, and a second report while a page is still loading fetches nothing", async () => {
    let resolvePage!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePage = resolve;
    });
    const fetchMock = vi.fn().mockReturnValueOnce(pending);
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    bottomInView();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePage(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "Older page" })], nextBefore: null })), { status: 200 }),
      );
    });
    expect(await screen.findByText("Older page")).toBeTruthy();
  });

  it("shows 'No older delegations' after the last page and fetches nothing on a further report", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "last-old", title: "Last older" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    await screen.findByText("No older delegations");
    expect(screen.getByText("Last older")).toBeTruthy();
    bottomInView();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the failure message and Try again refetches the page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "Retried older" })], nextBefore: null })), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    bottomInView();
    await screen.findByText("Could not load older delegations.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Retried older");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("has no Show older button when the list is capped", () => {
    render(<DelegationList list={list([row({ name: "a" })], { capped: true, total: 21 })} />);
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
    expect(screen.getByTestId("list-end")).toBeTruthy();
  });

  it("watches the end with a fresh observer after each page, the old one disconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "First older" })], nextBefore: "older-1" })), { status: 200 }),
      ),
    );
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    expect(observerCounts()).toEqual({ made: 1, live: 1 });
    bottomInView();
    expect(await screen.findByText("First older")).toBeTruthy();
    // The fresh observer is made in an effect, which can run after findByText returns.
    await waitFor(() => expect(observerCounts().made).toBeGreaterThan(1));
    expect(observerCounts().live).toBe(1);
  });

  it("loads nothing on delegations:more when the list is not capped", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: false, total: 1 })} />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("delegations:more"));
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the next page when the delegations:more event is dispatched on window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "More older" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("delegations:more"));
    });
    expect(await screen.findByText("More older")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a card whose row leaves list.rows, showing its last live version", () => {
    const { rerender } = render(
      <DelegationList
        list={list([
          row({ name: "run", title: "Still running", state: "live" }),
          row({ name: "other", title: "Other task", state: "ok" }),
        ])}
      />,
    );
    expect(screen.getByText("Still running")).toBeTruthy();
    rerender(<DelegationList list={list([row({ name: "other", title: "Other task", state: "ok" })])} />);
    expect(screen.getByText("Still running")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Running" })).toBeTruthy();
  });

  it("draws an older-page row that is also in list.rows once, as the live row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "run", title: "Same task", state: "live" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <DelegationList list={list([row({ name: "other", title: "Other task", state: "failed" })], { capped: true, total: 21 })} />,
    );
    bottomInView();
    expect(await screen.findByText("Same task")).toBeTruthy();
    rerender(
      <DelegationList
        list={list(
          [
            row({ name: "run", title: "Same task", state: "ok" }),
            row({ name: "other", title: "Other task", state: "failed" }),
          ],
          { capped: true, total: 21 },
        )}
      />,
    );
    expect(screen.getAllByText("Same task")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Running" })).toBeNull();
  });

  it("shows a row's last live version, not a stale older-page snapshot, once it leaves list.rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "run", title: "Same task", state: "live" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <DelegationList list={list([row({ name: "other", title: "Other task", state: "failed" })], { capped: true, total: 21 })} />,
    );
    bottomInView();
    expect(await screen.findByText("Same task")).toBeTruthy();
    rerender(
      <DelegationList
        list={list(
          [
            row({ name: "run", title: "Same task", state: "ok" }),
            row({ name: "other", title: "Other task", state: "failed" }),
          ],
          { capped: true, total: 21 },
        )}
      />,
    );
    rerender(<DelegationList list={list([row({ name: "other", title: "Other task", state: "failed" })], { capped: true, total: 21 })} />);
    expect(screen.getAllByText("Same task")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Done" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Running" })).toBeNull();
  });
});
