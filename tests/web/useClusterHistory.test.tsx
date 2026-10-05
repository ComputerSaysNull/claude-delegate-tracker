// @vitest-environment jsdom
// The page's figures over time: the server's history once, then each live update added.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useClusterHistory } from "../../src/web/useClusterHistory.ts";
import type { ClusterHistory } from "../../src/server/history.ts";
import type { ModelFigures } from "../../src/server/metrics.ts";
import type { Cluster } from "../../src/web/useLiveList.ts";

const LIMITS = { loadWarn: 50, loadHot: 80, tempWarn: 70, tempHot: 85 };
const T0 = Date.parse("2026-10-04T10:00:00.000Z");

function model(atMs: number, running: number | null): ModelFigures {
  return {
    status: "ok", running, waiting: 0, kvCachePercent: 1.5, decodeTokensPerSecond: 40,
    decodeWindowSeconds: 10, prefixHitPercent: 90, preemptions: null, readAt: new Date(atMs).toISOString(),
  };
}

const SERVER: ClusterHistory = {
  windowSeconds: 60,
  model: { at: [T0], values: { running: [1], waiting: [0], kvCachePercent: [1.5], decodeTokensPerSecond: [40] } },
  nodes: [],
};

describe("useClusterHistory", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("waits for the server's history, then adds each live update to it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SERVER), { status: 200 })));
    const { result, rerender } = renderHook(({ c }: { c: Cluster | null }) => useClusterHistory(c), {
      initialProps: { c: null as Cluster | null },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ c: { model: model(T0 + 10_000, 2), nodes: [], limits: LIMITS } });
    expect(result.current?.model.at).toEqual([T0, T0 + 10_000]);
    expect(result.current?.model.values.running).toEqual([1, 2]);
  });

  it("drops updates that arrive before the server's history, whose window is not known yet", async () => {
    let answer: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { answer = r; })));
    const { result, rerender } = renderHook(({ c }: { c: Cluster | null }) => useClusterHistory(c), {
      initialProps: { c: null as Cluster | null },
    });
    rerender({ c: { model: model(T0 + 5_000, 7), nodes: [], limits: LIMITS } });
    expect(result.current).toBeNull();
    answer(new Response(JSON.stringify(SERVER), { status: 200 }));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.model.values.running).toEqual([1]);
  });

  it("trims to the server's window and keeps a missing figure as a gap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(SERVER), { status: 200 })));
    const { result, rerender } = renderHook(({ c }: { c: Cluster | null }) => useClusterHistory(c), {
      initialProps: { c: null as Cluster | null },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ c: { model: model(T0 + 90_000, null), nodes: [], limits: LIMITS } }); // 90 s later, window 60 s
    expect(result.current?.model.at).toEqual([T0 + 90_000]);
    expect(result.current?.model.values.running).toEqual([null]);
  });
});
