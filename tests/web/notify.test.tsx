// @vitest-environment jsdom
// A desktop notification when a delegation ends, once the viewer has allowed them; runs
// that had already ended when the page opened never notify.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ListRow } from "../../src/server/streams.ts";
import { NotifyButton, useNotifications } from "../../src/web/notify.tsx";

function row(name: string, state: ListRow["state"], overrides: Partial<ListRow> = {}): ListRow {
  return {
    name, state, why: null, age: null, kind: "?", model: null, effort: null, title: `Delegation ${name}`,
    startedAt: null, elapsed: null, turns: null, unknownFormat: null, left: null, queueOf: null, ...overrides,
  };
}

interface Shown {
  title: string;
  options?: NotificationOptions;
  onclick: (() => void) | null;
}

const shown: Shown[] = [];
let permission: NotificationPermission = "granted";
const requestPermission = vi.fn(async () => {
  permission = "granted";
  return permission;
});

class FakeNotification {
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    shown.push(this as unknown as Shown);
    Object.assign(this, { title, options });
  }
  static get permission() {
    return permission;
  }
  static requestPermission = requestPermission;
}

beforeEach(() => {
  shown.length = 0;
  permission = "granted";
  requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const follow = (initial: ListRow[], onOpen = vi.fn()) =>
  renderHook(({ rows }) => useNotifications(rows, onOpen), { initialProps: { rows: initial } });

describe("useNotifications", () => {
  it("notifies when a running delegation finishes", () => {
    const { rerender } = follow([row("a", "live")]);
    rerender({ rows: [row("a", "ok")] });
    expect(shown.map((n) => n.title)).toEqual(["Finished: Delegation a"]);
  });

  it("says how it ended, with the reason", () => {
    const { rerender } = follow([row("a", "live"), row("b", "asking"), row("c", "queued")]);
    rerender({ rows: [row("a", "failed", { why: "backend unreachable" }), row("b", "stopped"), row("c", "timed out")] });
    expect(shown.map((n) => n.title)).toEqual(["Failed: Delegation a", "Stopped: Delegation b", "Timed out: Delegation c"]);
    expect(shown[0].options?.body).toBe("backend unreachable");
  });

  it("notifies once per delegation, however often the list updates", () => {
    const { rerender } = follow([row("a", "live")]);
    rerender({ rows: [row("a", "ok")] });
    rerender({ rows: [row("a", "ok")] });
    expect(shown).toHaveLength(1);
  });

  it("never notifies for runs that had already ended when the page opened", () => {
    const { rerender } = follow([row("old", "failed"), row("done", "ok")]);
    rerender({ rows: [row("old", "failed"), row("done", "ok")] });
    expect(shown).toHaveLength(0);
  });

  it("notifies for a delegation that starts and ends while the page is open", () => {
    const { rerender } = follow([]);
    rerender({ rows: [row("n", "live")] });
    rerender({ rows: [row("n", "ok")] });
    expect(shown.map((n) => n.title)).toEqual(["Finished: Delegation n"]);
  });

  it("stays silent until the viewer has allowed notifications", () => {
    permission = "default";
    const { rerender } = follow([row("a", "live")]);
    rerender({ rows: [row("a", "ok")] });
    expect(shown).toHaveLength(0);
  });

  it("opens the delegation when the notification is clicked", () => {
    const onOpen = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const { rerender } = follow([row("a", "live")], onOpen);
    rerender({ rows: [row("a", "ok")] });
    shown[0].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledWith("a");
  });
});

describe("NotifyButton", () => {
  it("offers to turn notifications on while the browser has not been asked", async () => {
    permission = "default";
    render(<NotifyButton />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Notify me/ }));
    });
    expect(requestPermission).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Notify me/ })).toBeNull();
  });

  it("says when notifications are blocked", () => {
    permission = "denied";
    render(<NotifyButton />);
    expect(screen.getByText(/blocked/)).toBeTruthy();
  });

  it("shows nothing once allowed", () => {
    const { container } = render(<NotifyButton />);
    expect(container.textContent).toBe("");
  });

  it("shows nothing where the browser cannot notify, as over plain HTTP", () => {
    permission = "default";
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const { container } = render(<NotifyButton />);
    expect(container.textContent).toBe("");
  });
});
