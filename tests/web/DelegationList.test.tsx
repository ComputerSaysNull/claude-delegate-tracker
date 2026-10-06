// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DelegationList } from "../../src/web/DelegationList.tsx";
import { localTime } from "../../src/web/time.ts";
import { STATE_LABEL } from "../../src/web/states.tsx";
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
    workspace: null,
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
    ...overrides,
  };
}

function page(overrides: Partial<HistoryPage> = {}): HistoryPage {
  return { rows: [], nextBefore: null, ...overrides };
}

describe("DelegationList", () => {
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

  it("shows no Show older button when the list is not capped", () => {
    render(<DelegationList list={list([row({ name: "live" })])} />);
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("requests the next page from the last live row's name and renders the returned rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "An older delegation" })], nextBefore: "older-2" })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    await screen.findByText("First older");
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    await screen.findByText("Second older");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/streams?before=last%20live");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/streams?before=older-2");
  });

  it("shows the oldest note and no button when nextBefore is null", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "older-1", title: "Last older" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(await screen.findByText("That is the oldest.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("shows an amber note and keeps the button when the fetch fails with a non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "last live" })], { capped: true, total: 21 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
    expect(await screen.findByText("Could not load older delegations.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show older" })).toBeTruthy();
  });

  it("does not render an older row whose name is already shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(page({ rows: [row({ name: "dup", title: "Already shown" })], nextBefore: null })), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DelegationList list={list([row({ name: "dup", title: "Already shown" })], { capped: true, total: 21 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));
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
});
