// One test per rule in docs/ARCHITECTURE.md "The model server".
import { describe, expect, it } from "vitest";
import {
  figuresFrom,
  parseMetrics,
  MetricsPoller,
  type MetricsDeps,
  type Reading,
  type Sample,
} from "../../src/server/metrics.ts";

const T0 = 1_700_000_000_000;
const reading = (atMs: number, sample: Sample): Reading => ({ atMs, sample });

describe("parseMetrics", () => {
  it("keeps each of the seven allowlisted names with their values", () => {
    const result = parseMetrics(
      [
        '# HELP vllm:num_requests_running Requests currently running.',
        'vllm:num_requests_running{engine="0"} 1',
        'vllm:num_requests_waiting{engine="0"} 2',
        'vllm:kv_cache_usage_perc{engine="0"} 0.5',
        'vllm:generation_tokens_total{engine="0"} 100',
        'vllm:prefix_cache_hits_total{engine="0"} 10',
        'vllm:prefix_cache_queries_total{engine="0"} 20',
        'vllm:num_preemptions_total{engine="0"} 3',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(1);
    expect(result["vllm:num_requests_waiting"]).toBe(2);
    expect(result["vllm:kv_cache_usage_perc"]).toBe(0.5);
    expect(result["vllm:generation_tokens_total"]).toBe(100);
    expect(result["vllm:prefix_cache_hits_total"]).toBe(10);
    expect(result["vllm:prefix_cache_queries_total"]).toBe(20);
    expect(result["vllm:num_preemptions_total"]).toBe(3);
  });

  it("ignores any other name, including look-alikes", () => {
    const result = parseMetrics(
      [
        'vllm:num_requests_running{engine="0"} 1',
        'vllm:num_requests_running_by_reason{engine="0",reason="length"} 5',
        'vllm:generation_tokens_created{engine="0"} 7',
        'vllm:some_other_metric{engine="0"} 9',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(1);
    const all = result as Record<string, number | undefined>;
    expect(all["vllm:num_requests_running_by_reason"]).toBeUndefined();
    expect(all["vllm:generation_tokens_created"]).toBeUndefined();
    expect(all["vllm:some_other_metric"]).toBeUndefined();
  });

  it("skips # comment lines and blank lines", () => {
    const result = parseMetrics(
      [
        '# HELP vllm:num_requests_running Requests currently running.',
        '',
        '# TYPE vllm:num_requests_running gauge',
        'vllm:num_requests_running{engine="0"} 4',
        '',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(4);
  });

  it("reads a line with labels, without labels, and with a trailing timestamp", () => {
    const result = parseMetrics(
      [
        'vllm:num_requests_running{engine="0"} 1',
        'vllm:num_requests_waiting 2',
        'vllm:kv_cache_usage_perc{engine="0"} 0.5 1700000000000',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(1);
    expect(result["vllm:num_requests_waiting"]).toBe(2);
    expect(result["vllm:kv_cache_usage_perc"]).toBe(0.5);
  });

  it("parses a label value containing a space, a comma, a } and an escaped quote", () => {
    const result = parseMetrics('vllm:num_requests_running{engine="0",note="a b,c}d\\"e"} 6');
    expect(result["vllm:num_requests_running"]).toBe(6);
  });

  it("leaves out NaN, +Inf and -Inf", () => {
    const result = parseMetrics(
      [
        'vllm:num_requests_running{engine="0"} NaN',
        'vllm:num_requests_waiting{engine="0"} +Inf',
        'vllm:kv_cache_usage_perc{engine="0"} -Inf',
        'vllm:generation_tokens_total{engine="0"} 42',
      ].join("\n"),
    );
    const all = result as Record<string, number | undefined>;
    expect(all["vllm:num_requests_running"]).toBeUndefined();
    expect(all["vllm:num_requests_waiting"]).toBeUndefined();
    expect(all["vllm:kv_cache_usage_perc"]).toBeUndefined();
    expect(result["vllm:generation_tokens_total"]).toBe(42);
  });

  it("leaves out a name that appears twice (two engines)", () => {
    const result = parseMetrics(
      [
        'vllm:num_requests_running{engine="0"} 1',
        'vllm:num_requests_running{engine="1"} 2',
        'vllm:num_requests_waiting{engine="0"} 3',
      ].join("\n"),
    );
    const all = result as Record<string, number | undefined>;
    expect(all["vllm:num_requests_running"]).toBeUndefined();
    expect(result["vllm:num_requests_waiting"]).toBe(3);
  });

  it("never puts a label value in the result", () => {
    const result = parseMetrics(
      [
        'vllm:num_requests_running{engine="0",model_name="mysecretmodel"} 1',
        'vllm:num_requests_waiting{engine="1"} 2',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(1);
    const json = JSON.stringify(result);
    expect(json).not.toContain("mysecretmodel");
    expect(json).not.toContain("model_name");
    expect(json).not.toContain("engine");
  });
});

describe("figuresFrom", () => {
  it("returns all null when cur is null", () => {
    const f = figuresFrom("ok", null, null);
    expect(f.status).toBe("ok");
    expect(f.running).toBeNull();
    expect(f.waiting).toBeNull();
    expect(f.kvCachePercent).toBeNull();
    expect(f.decodeTokensPerSecond).toBeNull();
    expect(f.decodeWindowSeconds).toBeNull();
    expect(f.prefixHitPercent).toBeNull();
    expect(f.preemptions).toBeNull();
    expect(f.readAt).toBeNull();
  });

  it("copies the gauges as they are", () => {
    const f = figuresFrom("ok", null, reading(T0, { "vllm:num_requests_running": 3, "vllm:num_requests_waiting": 5 }));
    expect(f.running).toBe(3);
    expect(f.waiting).toBe(5);
  });

  it("turns kv_cache_usage_perc 0.0743 into 7.4", () => {
    const f = figuresFrom("ok", null, reading(T0, { "vllm:kv_cache_usage_perc": 0.0743 }));
    expect(f.kvCachePercent).toBe(7.4);
  });

  it("prefix hit rate is hits ÷ queries (92 of 100 → 92)", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:prefix_cache_hits_total": 92,
      "vllm:prefix_cache_queries_total": 100,
    }));
    expect(f.prefixHitPercent).toBe(92);
  });

  it("prefix hit rate is null when queries is 0", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:prefix_cache_hits_total": 5,
      "vllm:prefix_cache_queries_total": 0,
      "vllm:num_requests_running": 1,
    }));
    expect(f.prefixHitPercent).toBeNull();
    expect(f.running).toBe(1);
  });

  it("prefix hit rate is null when either counter is missing", () => {
    const missingQueries = figuresFrom("ok", null, reading(T0, {
      "vllm:prefix_cache_hits_total": 5,
      "vllm:num_requests_running": 1,
    }));
    expect(missingQueries.prefixHitPercent).toBeNull();
    expect(missingQueries.running).toBe(1);
    const missingHits = figuresFrom("ok", null, reading(T0, {
      "vllm:prefix_cache_queries_total": 100,
      "vllm:num_requests_waiting": 2,
    }));
    expect(missingHits.prefixHitPercent).toBeNull();
    expect(missingHits.waiting).toBe(2);
  });

  it("preemptions is null at 0 and the count above 0", () => {
    const zero = figuresFrom("ok", null, reading(T0, { "vllm:num_preemptions_total": 0 }));
    expect(zero.preemptions).toBeNull();
    const three = figuresFrom("ok", null, reading(T0, { "vllm:num_preemptions_total": 3 }));
    expect(three.preemptions).toBe(3);
  });

  it("a measured 0 for running stays 0 while a missing waiting is null", () => {
    const f = figuresFrom("ok", null, reading(T0, { "vllm:num_requests_running": 0 }));
    expect(f.running).toBe(0);
    expect(f.waiting).toBeNull();
  });

  it("decode rate from two readings 10 s apart with 800 more tokens is 80 tok/s over 10 s", () => {
    const prev = reading(T0, { "vllm:generation_tokens_total": 1000 });
    const cur = reading(T0 + 10_000, { "vllm:generation_tokens_total": 1800 });
    const f = figuresFrom("ok", prev, cur);
    expect(f.decodeTokensPerSecond).toBe(80);
    expect(f.decodeWindowSeconds).toBe(10);
  });

  it("a first reading gives no rate", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:generation_tokens_total": 1000,
      "vllm:num_requests_running": 2,
    }));
    expect(f.decodeTokensPerSecond).toBeNull();
    expect(f.decodeWindowSeconds).toBeNull();
    expect(f.running).toBe(2);
  });

  it("a counter that went down gives no rate and no window", () => {
    const prev = reading(T0, { "vllm:generation_tokens_total": 1000, "vllm:num_requests_running": 1 });
    const cur = reading(T0 + 10_000, { "vllm:generation_tokens_total": 800, "vllm:num_requests_running": 2 });
    const f = figuresFrom("ok", prev, cur);
    expect(f.decodeTokensPerSecond).toBeNull();
    expect(f.decodeWindowSeconds).toBeNull();
    expect(f.running).toBe(2);
  });

  it("readAt is the ISO time of the newest reading", () => {
    const f = figuresFrom("ok", null, reading(T0, { "vllm:num_requests_running": 1 }));
    expect(f.readAt).toBe(new Date(T0).toISOString());
  });

  it("unreachable gives all null figures but keeps readAt from the last good reading", () => {
    const f = figuresFrom("unreachable", reading(T0 - 10_000, { "vllm:num_requests_running": 1 }), reading(T0, { "vllm:num_requests_running": 1 }));
    expect(f.running).toBeNull();
    expect(f.waiting).toBeNull();
    expect(f.kvCachePercent).toBeNull();
    expect(f.decodeTokensPerSecond).toBeNull();
    expect(f.decodeWindowSeconds).toBeNull();
    expect(f.prefixHitPercent).toBeNull();
    expect(f.preemptions).toBeNull();
    expect(f.readAt).toBe(new Date(T0).toISOString());
  });
});

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers;
  if (h === undefined) return null;
  if (typeof Headers !== "undefined" && h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    const found = h.find(([k]) => String(k).toLowerCase() === name.toLowerCase());
    return found ? String(found[1]) : null;
  }
  return (h as Record<string, string>)[name] ?? null;
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makePoller(over: Partial<MetricsDeps> = {}) {
  const calls: FetchCall[] = [];
  let body = "";
  let status = 200;
  let failure: Error | null = null;
  let t = T0;
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    if (failure !== null) return Promise.reject(failure);
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof globalThis.fetch;
  const now = (): Date => new Date(t);
  const poller = new MetricsPoller({
    url: "http://metrics.example",
    token: null,
    fetch: fakeFetch,
    now,
    timeoutMs: 5000,
    ...over,
  });
  return {
    poller,
    calls,
    body(v: string): void { body = v; },
    status(v: number): void { status = v; },
    fail(e: Error): void { failure = e; },
    advance(ms: number): void { t += ms; },
  };
}

describe("MetricsPoller", () => {
  it("with url null reports not configured and never fetches", () => {
    const p = makePoller({ url: null });
    p.poller.start(30);
    expect(p.poller.figures().status).toBe("not configured");
    expect(p.calls.length).toBe(0);
  });

  it("a 200 gives status ok with the figures", async () => {
    const p = makePoller();
    p.body('vllm:num_requests_running{engine="0"} 3');
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    expect(p.poller.figures().running).toBe(3);
  });

  it("a second 200 later gives a decode rate", async () => {
    const p = makePoller();
    p.body('vllm:generation_tokens_total{engine="0"} 1000');
    await p.poller.scrape();
    p.advance(10_000);
    p.body('vllm:generation_tokens_total{engine="0"} 1800');
    await p.poller.scrape();
    expect(p.poller.figures().decodeTokensPerSecond).toBe(80);
    expect(p.poller.figures().decodeWindowSeconds).toBe(10);
  });

  it("a 404 gives not available", async () => {
    const p = makePoller();
    p.status(404);
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("not available");
  });

  it("a thrown fetch error gives unreachable and keeps the last readAt", async () => {
    const p = makePoller();
    p.body('vllm:num_requests_running{engine="0"} 2');
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    const good = p.poller.figures().readAt;
    expect(good).not.toBeNull();
    p.fail(new Error("boom"));
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("unreachable");
    expect(p.poller.figures().readAt).toBe(good);
    expect(p.poller.figures().running).toBeNull();
  });

  it("sends Bearer <token> when a token is set and no Authorization header when it is not", async () => {
    const withToken = makePoller({ token: "s3cret" });
    withToken.body('vllm:num_requests_running{engine="0"} 1');
    await withToken.poller.scrape();
    expect(withToken.calls.length).toBe(1);
    expect(headerOf(withToken.calls[0].init, "Authorization")).toBe("Bearer s3cret");

    const withoutToken = makePoller({ token: null });
    withoutToken.body('vllm:num_requests_running{engine="0"} 1');
    await withoutToken.poller.scrape();
    expect(withoutToken.calls.length).toBe(1);
    expect(headerOf(withoutToken.calls[0].init, "Authorization")).toBeNull();
  });

  it("requests <url>/metrics with no double slash when the url ends in /", async () => {
    const p = makePoller({ url: "http://metrics.example/" });
    p.body('vllm:num_requests_running{engine="0"} 1');
    await p.poller.scrape();
    expect(p.calls.length).toBe(1);
    expect(p.calls[0].url).toBe("http://metrics.example/metrics");
  });

  it("onChange fires on a change and not on an identical second scrape", async () => {
    const p = makePoller();
    p.body('vllm:num_requests_running{engine="0"} 2');
    let fired = 0;
    p.poller.onChange(() => { fired += 1; });
    await p.poller.scrape();
    expect(fired).toBe(1);
    await p.poller.scrape();
    expect(fired).toBe(1);
    p.advance(10_000);
    p.body('vllm:num_requests_running{engine="0"} 3');
    await p.poller.scrape();
    expect(fired).toBe(2);
  });
});
