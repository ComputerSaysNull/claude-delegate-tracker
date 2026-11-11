// @vitest-environment jsdom
// An image the delegation was given or read shows on request: opening its tool row, or
// clicking its file chip, fetches it; nothing is fetched before. It is the file as it is on
// disk now, and a failure says why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StreamViewBody } from "../../src/web/StreamPage.tsx";
import type { CallView, FileView, StreamView, TurnView } from "../../src/server/view.ts";
import type { ListRow } from "../../src/server/streams.ts";

const NAME = "20261001T120000.000-a b.jsonl";

function row(): ListRow {
  return {
    name: NAME, state: "live", why: null, age: null, kind: "read_file", model: "flash", effort: null,
    title: "Look at the views", startedAt: null, elapsed: null, turns: null, unknownFormat: null,
    left: null, queueOf: null, messaged: false, asked: false, workspace: null, mcpTask: null,
  };
}

function turn(calls: CallView[]): TurnView {
  return {
    n: 1, heading: "turn 1", model: null, askedFor: null, budget: null, calls, reply: null, closed: true, heartbeat: null, partial: null, thinking: null, reasonedFor: null, retries: [],
    toolTime: null, attempts: null, repeated: null, thinkingRepeated: null, evicted: null, tokensIn: null, tokensOut: null, tokS: null,
    clock: null, at: null, asks: [],
  };
}

function call(overrides: Partial<CallView> = {}): CallView {
  return { name: "read_file", ok: true, outcome: "ran", status: null, args: [["path", "/w/views/side.png"]], message: null, result: "1 image", exitCode: null, time: null, imageRef: null, ...overrides };
}

function file(overrides: Partial<FileView> = {}): FileView {
  return { path: "/w/views/front.png", size: "120 B", skipped: null, lines: null, images: 1, imageRef: null, ...overrides };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: NAME, seq: 1, row: row(), task: "Look at the views", files: [], waiting: null, turns: [], messages: [], summary: null, ...overrides };
}

const ROUTE = `/api/streams/${encodeURIComponent(NAME)}/image/`;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:image-1"), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an image from a tool call", () => {
  it("is fetched only when the row opens, and shown as the file on disk now", async () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0" })])] })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    const img = await screen.findByRole("img", { name: /side\.png/ });
    expect(img.getAttribute("src")).toBe("blob:image-1");
    expect(fetchMock).toHaveBeenCalledWith(ROUTE + "t1c0", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/as it is on disk now/)).toBeTruthy();
    const full = screen.getByRole("link", { name: "Open full size" });
    expect(full.getAttribute("href")).toBe(ROUTE + "t1c0");
    expect(full.getAttribute("target")).toBe("_blank");
    expect(full.getAttribute("rel")).toMatch(/\bnoopener\b/);
  });

  it("stops the download and lets the image go when the row folds", async () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0" })])] })} />);
    const toggle = screen.getByRole("button", { name: "read_file" });
    fireEvent.click(toggle);
    await screen.findByRole("img", { name: /side\.png/ });
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(toggle);
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image-1");
  });

  it("fetches nothing for a call without an image", () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ result: "40 lines" })])] })} />);
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
  });

  it("says why an image could not be loaded", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "images are off" }), { status: 404 }));
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0" })])] })} />);
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    expect(await screen.findByText("Could not load the image: images are off.")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("an image from a prefetched file", () => {
  it("is fetched only when its chip is clicked", async () => {
    render(<StreamViewBody view={view({ files: [file({ imageRef: "f0" })] })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /front\.png/ }));
    const img = await screen.findByRole("img", { name: /front\.png/ });
    expect(img.getAttribute("src")).toBe("blob:image-1");
    expect(fetchMock).toHaveBeenCalledWith(ROUTE + "f0", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("leaves a chip without an image as a plain chip", () => {
    render(<StreamViewBody view={view({ files: [file({ path: "/w/notes.md", images: null })] })} />);
    expect(screen.queryByRole("button", { name: /notes\.md/ })).toBeNull();
  });
});
