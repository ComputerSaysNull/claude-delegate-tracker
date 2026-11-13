// @vitest-environment jsdom
// An image the delegation was given or read shows on request: opening its tool row, or
// clicking its file chip, fetches it; nothing is fetched before. It is the copy the server kept
// when the stream lists one, else the file as it is on disk now, and a failure says why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  return { name: "read_file", ok: true, outcome: "ran", status: null, args: [["path", "/w/views/side.png"]], message: null, result: "1 image", exitCode: null, time: null, imageRef: null, kept: 0, ...overrides };
}

function file(overrides: Partial<FileView> = {}): FileView {
  return { path: "/w/views/front.png", size: "120 B", skipped: null, lines: null, images: 1, imageRef: null, kept: 0, ...overrides };
}

function view(overrides: Partial<StreamView> = {}): StreamView {
  return { name: NAME, seq: 1, row: row(), task: "Look at the views", files: [], waiting: null, turns: [], messages: [], summary: null, ...overrides };
}

// Two small response factories: each call makes a fresh Response, since a body can be read once.
const png = () => new Response(new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }), { status: 200 });
const gone = () => new Response(JSON.stringify({ error: "missing" }), { status: 404 });

const ROUTE = `/api/streams/${encodeURIComponent(NAME)}/image/`;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(() => Promise.resolve(png()));
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

describe("a kept copy of an image from a tool call", () => {
  it("kept 1: fetches <ref>k0 and shows it as it was sent, not as it is on disk", async () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0", kept: 1 })])] })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    await screen.findByText(/as it was sent to the model/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "t1c0k0"]);
    expect(fetchMock).toHaveBeenCalledWith(ROUTE + "t1c0k0", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("blob:image-1");
    expect(screen.queryByText(/on disk now/)).toBeNull();
    const full = screen.getByRole("link", { name: "Open full size" });
    expect(full.getAttribute("href")).toBe(ROUTE + "t1c0k0");
  });

  it("kept 2: fetches both kept copies in the order sent and shows both", async () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0", kept: 2 })])] })} />);
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(2));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "t1c0k0", ROUTE + "t1c0k1"]);
    const links = screen.getAllByRole("link", { name: "Open full size" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([ROUTE + "t1c0k0", ROUTE + "t1c0k1"]);
    expect(screen.getAllByText(/as it was sent to the model/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/on disk now/)).toBeNull();
  });

  it("kept 1, the copy gone: falls back to the file on disk and says so", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url === ROUTE + "t1c0k0" ? gone() : png()));
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0", kept: 1 })])] })} />);
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    await screen.findByText(/as it is on disk now/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "t1c0k0", ROUTE + "t1c0"]);
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("blob:image-1");
    expect(screen.queryByText(/Could not load the image/)).toBeNull();
    const full = screen.getByRole("link", { name: "Open full size" });
    expect(full.getAttribute("href")).toBe(ROUTE + "t1c0");
  });

  it("kept 0: fetches the file on disk as before", async () => {
    render(<StreamViewBody view={view({ turns: [turn([call({ imageRef: "t1c0", kept: 0 })])] })} />);
    fireEvent.click(screen.getByRole("button", { name: "read_file" }));
    const img = await screen.findByRole("img", { name: /side\.png/ });
    expect(img.getAttribute("src")).toBe("blob:image-1");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "t1c0"]);
    expect(screen.getByText(/as it is on disk now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open full size" }).getAttribute("href")).toBe(ROUTE + "t1c0");
  });
});

describe("a kept copy of an image from a prefetched file", () => {
  it("kept 1: fetches <ref>k0 when the chip opens and shows it as it was sent", async () => {
    render(<StreamViewBody view={view({ files: [file({ imageRef: "f0", kept: 1 })] })} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /front\.png/ }));
    await screen.findByText(/as it was sent to the model/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "f0k0"]);
    expect(fetchMock).toHaveBeenCalledWith(ROUTE + "f0k0", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("blob:image-1");
    expect(screen.queryByText(/on disk now/)).toBeNull();
    const full = screen.getByRole("link", { name: "Open full size" });
    expect(full.getAttribute("href")).toBe(ROUTE + "f0k0");
  });

  it("kept 2: fetches both kept copies in the order sent and shows both", async () => {
    render(<StreamViewBody view={view({ files: [file({ imageRef: "f0", kept: 2 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /front\.png/ }));
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(2));
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "f0k0", ROUTE + "f0k1"]);
    const links = screen.getAllByRole("link", { name: "Open full size" });
    expect(links.map((a) => a.getAttribute("href"))).toEqual([ROUTE + "f0k0", ROUTE + "f0k1"]);
    expect(screen.getAllByText(/as it was sent to the model/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/on disk now/)).toBeNull();
  });

  it("kept 1, the copy gone: falls back to the file on disk and says so", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(url === ROUTE + "f0k0" ? gone() : png()));
    render(<StreamViewBody view={view({ files: [file({ imageRef: "f0", kept: 1 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /front\.png/ }));
    await screen.findByText(/as it is on disk now/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "f0k0", ROUTE + "f0"]);
    const imgs = document.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("blob:image-1");
    expect(screen.queryByText(/Could not load the image/)).toBeNull();
    const full = screen.getByRole("link", { name: "Open full size" });
    expect(full.getAttribute("href")).toBe(ROUTE + "f0");
  });

  it("kept 0: fetches the file on disk as before", async () => {
    render(<StreamViewBody view={view({ files: [file({ imageRef: "f0", kept: 0 })] })} />);
    fireEvent.click(screen.getByRole("button", { name: /front\.png/ }));
    const img = await screen.findByRole("img", { name: /front\.png/ });
    expect(img.getAttribute("src")).toBe("blob:image-1");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([ROUTE + "f0"]);
    expect(screen.getByText(/as it is on disk now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open full size" }).getAttribute("href")).toBe(ROUTE + "f0");
  });
});
