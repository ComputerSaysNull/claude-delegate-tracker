// @vitest-environment jsdom
// Moving through the list at the desk without the mouse: j/k move, Enter opens, Esc closes,
// / searches, ? lists the keys. Nothing steals keys typed into a field.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ListResponse } from "../../src/server/poller.ts";
import type { ListRow } from "../../src/server/streams.ts";

function row(name: string, title: string): ListRow {
  return {
    name, state: "ok", why: null, age: null, kind: "claude-code", model: null, effort: null, title,
    startedAt: null, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null,
  };
}

const LIST: ListResponse = {
  rows: [row("s1", "First delegation"), row("s2", "Second delegation"), row("s3", "Third delegation")],
  capped: false, total: 3, unstamped: 0, folderReadable: true, badLines: 0, schemaFailures: 0,
};

vi.mock("../../src/web/useLiveList.ts", () => ({
  useLiveList: () => ({
    list: LIST, cluster: null, connected: true,
    health: { checkedAt: null, banners: [], transcriptFolder: { configured: true, readable: true } },
  }),
}));
vi.mock("../../src/web/useClusterHistory.ts", () => ({ useClusterHistory: () => null }));
vi.mock("../../src/web/StreamPage.tsx", () => ({
  StreamPage: ({ name }: { name: string }) => <div data-testid="detail">detail of {name}</div>,
}));

const { default: App } = await import("../../src/web/App.tsx");

const press = (key: string, target: Element | Document = document.body, extra: object = {}) =>
  fireEvent.keyDown(target, { key, ...extra });
const link = (name: string) => screen.getByRole("link", { name });

describe("desktop keyboard", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));
  afterEach(cleanup);

  it("j moves down the list and k moves up", () => {
    render(<App />);
    press("j");
    expect(document.activeElement).toBe(link("First delegation"));
    press("j");
    expect(document.activeElement).toBe(link("Second delegation"));
    press("k");
    expect(document.activeElement).toBe(link("First delegation"));
  });

  it("stops at either end", () => {
    render(<App />);
    press("j");
    press("k");
    expect(document.activeElement).toBe(link("First delegation"));
    for (let i = 0; i < 4; i++) press("j");
    expect(document.activeElement).toBe(link("Third delegation"));
  });

  it("Enter opens the delegation the focus is on", () => {
    render(<App />);
    press("j");
    press("j");
    fireEvent.click(document.activeElement!); // what the browser does on Enter over a link
    expect(screen.getByTestId("detail").textContent).toContain("detail of s2");
  });

  it("Esc closes the open delegation", () => {
    render(<App />);
    fireEvent.click(link("Second delegation"));
    press("Escape");
    expect(screen.queryByTestId("detail")).toBeNull();
  });

  it("/ jumps to the search box", () => {
    render(<App />);
    press("/");
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("? lists the keys, and Esc closes the list", () => {
    render(<App />);
    press("?");
    const help = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(help.textContent).toMatch(/j/);
    expect(help.textContent).toMatch(/Esc/);
    press("Escape");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("nothing steals keys typed into the search box", () => {
    render(<App />);
    const search = screen.getByRole("searchbox");
    search.focus();
    press("j", search);
    press("/", search);
    press("?", search);
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });

  it("leaves a key with Ctrl, Alt or Cmd to the browser", () => {
    render(<App />);
    press("j", document.body, { ctrlKey: true });
    press("j", document.body, { metaKey: true });
    expect(document.activeElement).toBe(document.body);
  });
});
