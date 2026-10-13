// @vitest-environment jsdom
// The live list hook keeps the newest decode event the backend streams on /api/updates.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveList } from "../../src/web/useLiveList.ts";
import type { DecodeNow } from "../../src/server/metrics.ts";

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static made: FakeEventSource[] = [];
  private handlers = new Map<string, Set<Listener>>();
  closed = false;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.made.push(this);
  }
  addEventListener(type: string, listener: Listener): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.handlers.get(type)?.delete(listener);
  }
  fire(type: string, data: string): void {
    for (const listener of this.handlers.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  close(): void {
    this.closed = true;
  }
}

describe("useLiveList", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the newest decode event, and has none before one arrives", () => {
    FakeEventSource.made = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    const { result } = renderHook(() => useLiveList());
    expect(result.current.decode).toBeNull();
    const source = FakeEventSource.made[0];
    expect(source).toBeDefined();
    const first: DecodeNow = { tokensPerSecond: 40.0, windowSeconds: 1 };
    act(() => source.fire("decode", JSON.stringify(first)));
    expect(result.current.decode).toEqual(first);
    const second: DecodeNow = { tokensPerSecond: 61.4, windowSeconds: 1 };
    act(() => source.fire("decode", JSON.stringify(second)));
    expect(result.current.decode).toEqual(second);
  });
});
