// One test per rule in docs/ARCHITECTURE.md "The model server".
import { describe, expect, it } from "vitest";
import {
  figuresFrom,
  parseMetrics,
  MetricsPoller,
  prefillRate,
  METRIC_NAMES,
  type MetricsDeps,
  type Reading,
  type Sample,
  type DecodeNow,
} from "../../src/server/metrics.ts";

const T0 = 1_700_000_000_000;
const reading = (atMs: number, sample: Sample): Reading => ({ atMs, sample });

describe("parseMetrics", () => {
  it("keeps each of the twelve allowlisted names with their values", () => {
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
        'vllm:spec_decode_num_draft_tokens_total{engine="0"} 5000',
        'vllm:spec_decode_num_accepted_tokens_total{engine="0"} 4000',
        'vllm:request_prefill_time_seconds_sum{engine="0"} 100',
        'vllm:request_prefill_time_seconds_count{engine="0"} 10',
        'vllm:request_prefill_kv_computed_tokens_sum{engine="0"} 1000',
      ].join("\n"),
    );
    expect(result["vllm:num_requests_running"]).toBe(1);
    expect(result["vllm:num_requests_waiting"]).toBe(2);
    expect(result["vllm:kv_cache_usage_perc"]).toBe(0.5);
    expect(result["vllm:generation_tokens_total"]).toBe(100);
    expect(result["vllm:prefix_cache_hits_total"]).toBe(10);
    expect(result["vllm:prefix_cache_queries_total"]).toBe(20);
    expect(result["vllm:num_preemptions_total"]).toBe(3);
    expect(result["vllm:spec_decode_num_draft_tokens_total"]).toBe(5000);
    expect(result["vllm:spec_decode_num_accepted_tokens_total"]).toBe(4000);
    expect(result["vllm:request_prefill_time_seconds_sum"]).toBe(100);
    expect(result["vllm:request_prefill_time_seconds_count"]).toBe(10);
    expect(result["vllm:request_prefill_kv_computed_tokens_sum"]).toBe(1000);
  });

  it("parses the MTP and prefill histogram names from a labelled exposition with exponent values", () => {
    const result = parseMetrics(
      [
        'vllm:spec_decode_num_draft_tokens_total{engine="0",model_name="m"} 6.3804e+06',
        'vllm:spec_decode_num_accepted_tokens_total{engine="0",model_name="m"} 3.1e+06',
        'vllm:request_prefill_time_seconds_sum{engine="0",model_name="m"} 2.135e+02',
        'vllm:request_prefill_time_seconds_count{engine="0",model_name="m"} 1.1e+01',
        'vllm:request_prefill_kv_computed_tokens_sum{engine="0",model_name="m"} 3.2027e+04',
      ].join("\n"),
    );
    expect(result["vllm:spec_decode_num_draft_tokens_total"]).toBe(6_380_400);
    expect(result["vllm:spec_decode_num_accepted_tokens_total"]).toBe(3_100_000);
    expect(result["vllm:request_prefill_time_seconds_sum"]).toBe(213.5);
    expect(result["vllm:request_prefill_time_seconds_count"]).toBe(11);
    expect(result["vllm:request_prefill_kv_computed_tokens_sum"]).toBe(32027);
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

describe("METRIC_NAMES", () => {
  it("contains the three prefill histogram names and not the two prompt names", () => {
    expect(METRIC_NAMES).toContain("vllm:request_prefill_time_seconds_sum");
    expect(METRIC_NAMES).toContain("vllm:request_prefill_time_seconds_count");
    expect(METRIC_NAMES).toContain("vllm:request_prefill_kv_computed_tokens_sum");
    expect(METRIC_NAMES).not.toContain("vllm:prompt_tokens_total");
    expect(METRIC_NAMES).not.toContain("vllm:prompt_tokens_cached_total");
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
    expect(f.mtpAcceptancePercent).toBeNull();
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
    expect(f.prefillTokensPerSecond).toBeNull();
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

  it("MTP acceptance is the window ratio, not the lifetime ratio", () => {
    const prev = reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 1000,
      "vllm:spec_decode_num_draft_tokens_total": 4000,
    });
    const cur = reading(T0 + 10_000, {
      "vllm:spec_decode_num_accepted_tokens_total": 1900,
      "vllm:spec_decode_num_draft_tokens_total": 5000,
    });
    const f = figuresFrom("ok", prev, cur);
    expect(f.mtpAcceptancePercent).toBe(90.0);
  });

  it("MTP acceptance is null on a first reading", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 1900,
      "vllm:spec_decode_num_draft_tokens_total": 5000,
    }));
    expect(f.mtpAcceptancePercent).toBeNull();
  });

  it("MTP acceptance is null when either counter is missing in either reading", () => {
    const missingDraftPrev = figuresFrom(
      "ok",
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1000 }),
      reading(T0 + 10_000, { "vllm:spec_decode_num_accepted_tokens_total": 1900, "vllm:spec_decode_num_draft_tokens_total": 5000 }),
    );
    expect(missingDraftPrev.mtpAcceptancePercent).toBeNull();
    const missingDraftCur = figuresFrom(
      "ok",
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1000, "vllm:spec_decode_num_draft_tokens_total": 4000 }),
      reading(T0 + 10_000, { "vllm:spec_decode_num_accepted_tokens_total": 1900 }),
    );
    expect(missingDraftCur.mtpAcceptancePercent).toBeNull();
  });

  it("MTP acceptance is null when no drafts were made in the window", () => {
    const prev = reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 1000,
      "vllm:spec_decode_num_draft_tokens_total": 4000,
    });
    const cur = reading(T0 + 10_000, {
      "vllm:spec_decode_num_accepted_tokens_total": 1000,
      "vllm:spec_decode_num_draft_tokens_total": 4000,
    });
    expect(figuresFrom("ok", prev, cur).mtpAcceptancePercent).toBeNull();
  });

  it("MTP acceptance is null when a counter went down", () => {
    const acceptedDown = figuresFrom(
      "ok",
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1000, "vllm:spec_decode_num_draft_tokens_total": 4000 }),
      reading(T0 + 10_000, { "vllm:spec_decode_num_accepted_tokens_total": 900, "vllm:spec_decode_num_draft_tokens_total": 5000 }),
    );
    expect(acceptedDown.mtpAcceptancePercent).toBeNull();
    const draftDown = figuresFrom(
      "ok",
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1000, "vllm:spec_decode_num_draft_tokens_total": 4000 }),
      reading(T0 + 10_000, { "vllm:spec_decode_num_accepted_tokens_total": 1900, "vllm:spec_decode_num_draft_tokens_total": 3000 }),
    );
    expect(draftDown.mtpAcceptancePercent).toBeNull();
  });

  it("MTP acceptance is null when time did not advance", () => {
    const f = figuresFrom(
      "ok",
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1000, "vllm:spec_decode_num_draft_tokens_total": 4000 }),
      reading(T0, { "vllm:spec_decode_num_accepted_tokens_total": 1900, "vllm:spec_decode_num_draft_tokens_total": 5000 }),
    );
    expect(f.mtpAcceptancePercent).toBeNull();
  });

  it("prefill speed is the histogram rate", () => {
    const prev = reading(T0, {
      "vllm:request_prefill_time_seconds_count": 10,
      "vllm:request_prefill_time_seconds_sum": 100,
      "vllm:request_prefill_kv_computed_tokens_sum": 1000,
    });
    const cur = reading(T0 + 10_000, {
      "vllm:request_prefill_time_seconds_count": 11,
      "vllm:request_prefill_time_seconds_sum": 121.35,
      "vllm:request_prefill_kv_computed_tokens_sum": 32027,
    });
    expect(figuresFrom("ok", prev, cur).prefillTokensPerSecond).toBe(1453.3);
  });

  it("prefill speed is null when no prompt finished", () => {
    const prev = reading(T0, {
      "vllm:request_prefill_time_seconds_count": 10,
      "vllm:request_prefill_time_seconds_sum": 100,
      "vllm:request_prefill_kv_computed_tokens_sum": 1000,
    });
    const cur = reading(T0 + 10_000, {
      "vllm:request_prefill_time_seconds_count": 10,
      "vllm:request_prefill_time_seconds_sum": 100,
      "vllm:request_prefill_kv_computed_tokens_sum": 1000,
    });
    expect(figuresFrom("ok", prev, cur).prefillTokensPerSecond).toBeNull();
  });

  it("MTP acceptance and prefill speed are null when the status is not ok", () => {
    const f = figuresFrom(
      "unreachable",
      reading(T0, {
        "vllm:spec_decode_num_accepted_tokens_total": 1000,
        "vllm:request_prefill_time_seconds_count": 10,
        "vllm:request_prefill_time_seconds_sum": 100,
        "vllm:request_prefill_kv_computed_tokens_sum": 1000,
      }),
      reading(T0 + 10_000, {
        "vllm:spec_decode_num_accepted_tokens_total": 1900,
        "vllm:request_prefill_time_seconds_count": 11,
        "vllm:request_prefill_time_seconds_sum": 121.35,
        "vllm:request_prefill_kv_computed_tokens_sum": 32027,
      }),
    );
    expect(f.mtpAcceptancePercent).toBeNull();
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
    expect(f.prefillTokensPerSecond).toBeNull();
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
    expect(f.mtpAcceptancePercent).toBeNull();
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
    expect(f.keptEvicted).toBeNull();
    expect(f.prefillTokensPerSecond).toBeNull();
    expect(f.readAt).toBe(new Date(T0).toISOString());
  });
});

describe("prefillRate", () => {
  const time = "vllm:request_prefill_time_seconds_sum";
  const count = "vllm:request_prefill_time_seconds_count";
  const kv = "vllm:request_prefill_kv_computed_tokens_sum";
  const prev = reading(T0, { [time]: 100, [count]: 10, [kv]: 1000 });
  const cur = reading(T0 + 10_000, { [time]: 121.35, [count]: 11, [kv]: 32027 });

  it("is Δkv ÷ Δtime, one decimal", () => {
    expect(prefillRate(prev, cur)).toEqual({ tokensPerSecond: 1453.3, reset: false });
  });

  it("ignores the prompt token counters, which are no longer read", () => {
    const moved = reading(T0 + 10_000, {
      [time]: 100,
      [count]: 10,
      [kv]: 1000,
      "vllm:prompt_tokens_total": 3000,
      "vllm:prompt_tokens_cached_total": 1800,
    } as Sample);
    expect(prefillRate(prev, moved)).toEqual({ tokensPerSecond: null, reset: false });
  });

  it("a Δcount of 0 is null, not 0", () => {
    const same = reading(T0 + 10_000, { [time]: 121.35, [count]: 10, [kv]: 32027 });
    expect(prefillRate(prev, same)).toEqual({ tokensPerSecond: null, reset: false });
  });

  it("a count that went down is null and resets", () => {
    const down = reading(T0 + 10_000, { [time]: 121.35, [count]: 9, [kv]: 32027 });
    expect(prefillRate(prev, down)).toEqual({ tokensPerSecond: null, reset: true });
  });

  it("a kv sum that went down with the count up is null and resets", () => {
    const down = reading(T0 + 10_000, { [time]: 121.35, [count]: 11, [kv]: 900 });
    expect(prefillRate(prev, down)).toEqual({ tokensPerSecond: null, reset: true });
  });

  it("is null and reset false when the time sum is missing from cur", () => {
    expect(prefillRate(prev, reading(T0 + 10_000, { [count]: 11, [kv]: 32027 })))
      .toEqual({ tokensPerSecond: null, reset: false });
  });

  it("is null and reset false when the count is missing from cur", () => {
    expect(prefillRate(prev, reading(T0 + 10_000, { [time]: 121.35, [kv]: 32027 })))
      .toEqual({ tokensPerSecond: null, reset: false });
  });

  it("is null and reset false when the kv sum is missing from cur", () => {
    expect(prefillRate(prev, reading(T0 + 10_000, { [time]: 121.35, [count]: 11 })))
      .toEqual({ tokensPerSecond: null, reset: false });
  });

  it("is null and reset false when prev is null", () => {
    expect(prefillRate(null, cur)).toEqual({ tokensPerSecond: null, reset: false });
  });

  it("is null when Δtime is 0", () => {
    expect(prefillRate(prev, reading(T0 + 10_000, { [time]: 100, [count]: 11, [kv]: 32027 })))
      .toEqual({ tokensPerSecond: null, reset: false });
  });
});

describe("MTP acceptance since start", () => {
  it("uses the totals from the latest reading, not the window", () => {
    const prev = reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 50,
      "vllm:spec_decode_num_draft_tokens_total": 100,
    });
    const cur = reading(T0 + 10_000, {
      "vllm:spec_decode_num_accepted_tokens_total": 250,
      "vllm:spec_decode_num_draft_tokens_total": 300,
    });
    const f = figuresFrom("ok", prev, cur);
    expect(f.mtpAcceptancePercent).toBe(100.0);
    expect(f.mtpAcceptanceSinceStartPercent).toBe(83.3);
  });

  it("is present on a first reading", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 100,
      "vllm:spec_decode_num_draft_tokens_total": 400,
    }));
    expect(f.mtpAcceptanceSinceStartPercent).toBe(25);
  });

  it("is null when the draft total is 0, not 0", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 100,
      "vllm:spec_decode_num_draft_tokens_total": 0,
    }));
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
  });

  it("is null when the accepted counter is missing from the latest reading", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:spec_decode_num_draft_tokens_total": 400,
    }));
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
  });

  it("is null when the draft counter is missing from the latest reading", () => {
    const f = figuresFrom("ok", null, reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 100,
    }));
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
  });

  it("is null when the status is not ok", () => {
    const f = figuresFrom("unreachable", null, reading(T0, {
      "vllm:spec_decode_num_accepted_tokens_total": 100,
      "vllm:spec_decode_num_draft_tokens_total": 400,
    }));
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
  });

  it("is null when there is no reading", () => {
    const f = figuresFrom("ok", null, null);
    expect(f.mtpAcceptanceSinceStartPercent).toBeNull();
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

function bodyFor(gen: number, count: number, time: number, kv: number): string {
  return [
    `vllm:generation_tokens_total{engine="0"} ${gen}`,
    `vllm:request_prefill_time_seconds_count{engine="0"} ${count}`,
    `vllm:request_prefill_time_seconds_sum{engine="0"} ${time}`,
    `vllm:request_prefill_kv_computed_tokens_sum{engine="0"} ${kv}`,
  ].join("\n");
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

  it("tick sends a decode rate every refresh second and a full figure change only every interval", async () => {
    const p = makePoller();
    const decode: DecodeNow[] = [];
    let onChangeFires = 0;
    p.poller.onDecode((d) => decode.push(d));
    p.poller.onChange(() => { onChangeFires += 1; });
    // Configure interval 10, refresh 1; start()'s immediate tick is tick 0.
    p.body('vllm:generation_tokens_total{engine="0"} 1000');
    p.poller.start(10, 1);
    p.poller.stop(); // keep interval/refresh and tick 0, but no auto-refresh timers
    await new Promise((r) => setTimeout(r, 0)); // let tick 0 finish before the clock moves
    for (let i = 1; i < 25; i++) {
      p.advance(1000);
      p.body(`vllm:generation_tokens_total{engine="0"} ${1000 + 40 * i}`);
      await p.poller.tick();
    }
    // The first tick has no previous fast reading, so it is nulls; every later tick carries
    // the rate over that 1 s pair.
    expect(decode).toHaveLength(25);
    expect(decode[0]).toEqual({ tokensPerSecond: null, windowSeconds: null, prefillTokensPerSecond: null });
    for (const d of decode.slice(1)) {
      expect(d).toEqual({ tokensPerSecond: 40.0, windowSeconds: 1, prefillTokensPerSecond: null });
    }
    // A full reading is taken only when intervalSeconds (10) have passed since the last one.
    expect(onChangeFires).toBe(3);
    expect(p.poller.figures().decodeTokensPerSecond).toBe(40.0);
    expect(p.poller.figures().decodeWindowSeconds).toBe(10);
  });

  it("a failed fetch sends nulls to onDecode", async () => {
    const p = makePoller();
    p.body('vllm:generation_tokens_total{engine="0"} 1000');
    const decode: DecodeNow[] = [];
    p.poller.onDecode((d) => decode.push(d));
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0));
    // A second good reading first, so the last decode is a number before the failure.
    p.advance(1000);
    p.body('vllm:generation_tokens_total{engine="0"} 1040');
    await p.poller.tick();
    expect(decode.at(-1)).toEqual({ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: null });
    const before = decode.length;
    p.advance(1000);
    p.fail(new Error("boom"));
    await p.poller.tick();
    expect(decode.length).toBe(before + 1);
    expect(decode.at(-1)).toEqual({ tokensPerSecond: null, windowSeconds: null, prefillTokensPerSecond: null });
  });

  it("a counter that went down sends nulls to onDecode", async () => {
    const p = makePoller();
    p.body('vllm:generation_tokens_total{engine="0"} 1000');
    const decode: DecodeNow[] = [];
    p.poller.onDecode((d) => decode.push(d));
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0));
    p.advance(1000);
    p.body('vllm:generation_tokens_total{engine="0"} 800');
    await p.poller.tick();
    expect(decode.at(-1)).toEqual({ tokensPerSecond: null, windowSeconds: null, prefillTokensPerSecond: null });
  });

  it("a fast tick that is not due does not change figures", async () => {
    const p = makePoller();
    p.body('vllm:generation_tokens_total{engine="0"} 1000');
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0)); // tick 0 is a full reading
    const before = p.poller.figures();
    p.advance(1000);
    p.body('vllm:generation_tokens_total{engine="0"} 1040');
    await p.poller.tick();
    expect(p.poller.figures()).toEqual(before);
  });

  it("a prompt finishing between ticks carries its prefill rate on that tick and holds it", async () => {
    const p = makePoller();
    const decode: DecodeNow[] = [];
    p.poller.onDecode((d) => decode.push(d));
    p.body(bodyFor(1000, 10, 100, 1000));
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0)); // tick 0: no finished prompt yet
    expect(decode.at(-1)).toEqual({ tokensPerSecond: null, windowSeconds: null, prefillTokensPerSecond: null });
    p.advance(1000);
    p.body(bodyFor(1040, 11, 102, 4000));
    await p.poller.tick();
    expect(decode.at(-1)).toEqual({ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: 1500 });
    // The next tick, unchanged, repeats the held rate before any full reading is due.
    p.advance(1000);
    p.body(bodyFor(1080, 11, 102, 4000));
    await p.poller.tick();
    expect(decode.at(-1)).toEqual({ tokensPerSecond: 40, windowSeconds: 1, prefillTokensPerSecond: 1500 });
  });

  it("a count going down clears the held prefill rate and it stays null", async () => {
    const p = makePoller();
    const decode: DecodeNow[] = [];
    p.poller.onDecode((d) => decode.push(d));
    p.body(bodyFor(1000, 10, 100, 1000));
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0));
    p.advance(1000);
    p.body(bodyFor(1040, 11, 102, 4000));
    await p.poller.tick();
    expect(decode.at(-1)!.prefillTokensPerSecond).toBe(1500);
    p.advance(1000);
    p.body(bodyFor(1080, 9, 121.35, 32027));
    await p.poller.tick();
    expect(decode.at(-1)!.prefillTokensPerSecond).toBeNull();
    // The tick after, unchanged, still carries null.
    p.advance(1000);
    p.body(bodyFor(1120, 9, 121.35, 32027));
    await p.poller.tick();
    expect(decode.at(-1)!.prefillTokensPerSecond).toBeNull();
  });

  it("a failed fetch carries a null prefill rate even when one was held", async () => {
    const p = makePoller();
    const decode: DecodeNow[] = [];
    p.poller.onDecode((d) => decode.push(d));
    p.body(bodyFor(1000, 10, 100, 1000));
    p.poller.start(10, 1);
    p.poller.stop();
    await new Promise((r) => setTimeout(r, 0));
    p.advance(1000);
    p.body(bodyFor(1040, 11, 102, 4000));
    await p.poller.tick();
    expect(decode.at(-1)!.prefillTokensPerSecond).toBe(1500);
    p.advance(1000);
    p.fail(new Error("boom"));
    await p.poller.tick();
    expect(decode.at(-1)).toEqual({ tokensPerSecond: null, windowSeconds: null, prefillTokensPerSecond: null });
  });
});

// The TensorFold engine publishes `tensorfold:*` names (measured 2026-11-08). Its figures are
// read into the same sample keys as vLLM's, so every rule above applies to both engines.
// `over` replaces a name's lines; an empty array drops that name from the scrape.
function tensorfold(over: Record<string, string | string[]> = {}): string {
  const lines: Record<string, string | string[]> = {
    "tensorfold:num_requests_running": "2",
    "tensorfold:num_requests_waiting": "1",
    "tensorfold:requests_running": "2",
    "tensorfold:requests_waiting": "1",
    // One line per running request, each the fill of that request's own window, not the pool.
    "tensorfold:kv_cache_usage_perc": [
      '{stream="0"} 0.382196',
      '{stream="1"} 0.203507',
      '{stream="2"} 0.038329',
      '{stream="3"} 0.078279',
    ],
    "tensorfold:kv_cache_usage_ratio": '{pool="0"} 0.045',
    "tensorfold:generation_tokens_total": "408352",
    "tensorfold:generation_tokens_running": "126",
    "tensorfold:prefix_cache_hits_total": "3504128",
    "tensorfold:prefix_cache_queries_total": "6600625",
    "tensorfold:preemptions_total": "4",
    "tensorfold:spec_decode_num_draft_tokens_total": "337562",
    "tensorfold:spec_decode_num_accepted_tokens_total": "244815",
    "tensorfold:mtp_drafted_total": "337562",
    "tensorfold:mtp_accepted_total": "244815",
    "tensorfold:prompt_tokens_total": "6600625",
    "tensorfold:prompt_tokens_cached_total": "3461120",
    "tensorfold:prompt_cache_evicted": "133",
    "tensorfold:request_prefill_time_seconds_sum": "1846.589514",
    "tensorfold:request_prefill_time_seconds_count": "957",
    "tensorfold:pair_busy_ms": "0",
    // The KV pool, per part: 2 parts of 1050624 rows each. Every part's rows add up to
    // 1050624 (176128 free + 714752 live + 0 twin + 0 hold + 159744 kept, and likewise
    // for part 1), which is what makes these the pool's own figures.
    "tensorfold:kv_shard_parts": "2",
    "tensorfold:kv_shard_part_rows": "1050624",
    "tensorfold:kv_shard_part_free_rows": ['{part="0"} 176128', '{part="1"} 212992'],
    "tensorfold:kv_shard_part_live_rows": ['{part="0"} 714752', '{part="1"} 512000'],
    "tensorfold:kv_shard_part_twin_rows": ['{part="0"} 0', '{part="1"} 0'],
    "tensorfold:kv_shard_part_hold_rows": ['{part="0"} 0', '{part="1"} 0'],
    "tensorfold:kv_shard_part_kept_rows": ['{part="0"} 159744', '{part="1"} 325632'],
    ...over,
  };
  return [
    "# HELP tensorfold:generation_tokens_total Output tokens of finished requests.",
    "# TYPE tensorfold:generation_tokens_total counter",
    ...Object.entries(lines).flatMap(([name, rest]) =>
      Array.isArray(rest) ? rest.map((r) => `${name}${r}`) : [`${name} ${rest}`],
    ),
  ].join("\n");
}

describe("TensorFold", () => {
  it("reads every figure from tensorfold names into the vLLM sample keys", () => {
    const s = parseMetrics(tensorfold());
    expect(s["vllm:num_requests_running"]).toBe(2);
    expect(s["vllm:num_requests_waiting"]).toBe(1);
    // The pool's booked share: (714752 + 512000) ÷ (2 × 1050624).
    expect(s["vllm:kv_cache_usage_perc"]).toBeCloseTo(0.5838, 3);
    expect(s["vllm:prefix_cache_hits_total"]).toBe(3504128);
    expect(s["vllm:prefix_cache_queries_total"]).toBe(6600625);
    expect(s["vllm:num_preemptions_total"]).toBe(4);
    expect(s["vllm:spec_decode_num_draft_tokens_total"]).toBe(337562);
    expect(s["vllm:spec_decode_num_accepted_tokens_total"]).toBe(244815);
    expect(s["vllm:request_prefill_time_seconds_sum"]).toBe(1846.589514);
    expect(s["vllm:request_prefill_time_seconds_count"]).toBe(957);
  });

  it("KV-cache use is the pool's booked share, and the kept share is its kept prompts", () => {
    const s = parseMetrics(tensorfold());
    // (714752 + 512000) ÷ (2 × 1050624) = 0.5838…
    expect(s["vllm:kv_cache_usage_perc"]).toBeCloseTo(0.5838, 3);
    // (159744 + 325632) ÷ (2 × 1050624) = 0.2310…
    expect(s["kv_kept_ratio"]).toBeCloseTo(0.231, 3);
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.kvCachePercent).toBe(58.4);
    expect(f.kvKeptPercent).toBe(23.1);
    // Each per-stream line is one request's own window fill, so it is not the pool.
    expect(s["vllm:kv_cache_usage_perc"]).not.toBe(0.382196);
  });

  it("a part's live rows missing leaves both KV figures absent, not a partial sum", () => {
    const s = parseMetrics(tensorfold({
      "tensorfold:kv_shard_part_live_rows": ['{part="0"} 714752'],
    }));
    expect(s["vllm:kv_cache_usage_perc"]).toBeUndefined();
    expect(s["kv_kept_ratio"]).toBeUndefined();
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.kvCachePercent).toBeNull();
    expect(f.kvKeptPercent).toBeNull();
  });

  it("no kv_shard_part_rows, or a part_rows of 0, gives no KV figures", () => {
    const missing = parseMetrics(tensorfold({ "tensorfold:kv_shard_part_rows": [] }));
    expect(missing["vllm:kv_cache_usage_perc"]).toBeUndefined();
    expect(missing["kv_kept_ratio"]).toBeUndefined();
    const withoutRows = figuresFrom("ok", null, reading(T0, missing));
    expect(withoutRows.kvCachePercent).toBeNull();
    expect(withoutRows.kvKeptPercent).toBeNull();
    const zero = parseMetrics(tensorfold({ "tensorfold:kv_shard_part_rows": "0" }));
    expect(zero["vllm:kv_cache_usage_perc"]).toBeUndefined();
    expect(zero["kv_kept_ratio"]).toBeUndefined();
    const zeroRows = figuresFrom("ok", null, reading(T0, zero));
    expect(zeroRows.kvCachePercent).toBeNull();
    expect(zeroRows.kvKeptPercent).toBeNull();
  });

  it("no kv_shard lines at all gives no KV figures, rather than the per-stream maximum", () => {
    const s = parseMetrics(tensorfold({
      "tensorfold:kv_shard_parts": [],
      "tensorfold:kv_shard_part_rows": [],
      "tensorfold:kv_shard_part_free_rows": [],
      "tensorfold:kv_shard_part_live_rows": [],
      "tensorfold:kv_shard_part_twin_rows": [],
      "tensorfold:kv_shard_part_hold_rows": [],
      "tensorfold:kv_shard_part_kept_rows": [],
    }));
    expect(s["vllm:kv_cache_usage_perc"]).toBeUndefined();
    expect(s["kv_kept_ratio"]).toBeUndefined();
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.kvCachePercent).toBeNull();
    expect(f.kvKeptPercent).toBeNull();
    expect(f.running).toBe(2); // the rest of the scrape still reads
  });

  it("a part's hold rows and twin rows count toward the booked share", () => {
    const base = figuresFrom("ok", null, reading(T0, parseMetrics(tensorfold())));
    const held = figuresFrom("ok", null, reading(T0, parseMetrics(tensorfold({
      "tensorfold:kv_shard_part_hold_rows": ['{part="0"} 10506', '{part="1"} 0'],
    }))));
    // 10506 ÷ 2101248 is 0.5 points of the pool.
    expect(held.kvCachePercent).toBe(58.9);
    expect(held.kvCachePercent! - base.kvCachePercent!).toBeCloseTo(0.5, 5);
    const twinned = figuresFrom("ok", null, reading(T0, parseMetrics(tensorfold({
      "tensorfold:kv_shard_part_twin_rows": ['{part="0"} 0', '{part="1"} 10506'],
    }))));
    expect(twinned.kvCachePercent).toBe(58.9);
  });

  it("a vLLM scrape gives no kept share", () => {
    const s = parseMetrics('vllm:kv_cache_usage_perc{engine="0"} 0.5');
    expect(s["vllm:kv_cache_usage_perc"]).toBe(0.5);
    expect(s["kv_kept_ratio"]).toBeUndefined();
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.kvCachePercent).toBe(50);
    expect(f.kvKeptPercent).toBeNull();
  });

  it("generated tokens are the finished total plus the running gauge", () => {
    expect(parseMetrics(tensorfold())["vllm:generation_tokens_total"]).toBe(408352 + 126);
  });

  it("decode speed moves while a request generates, though the finished total stays flat", () => {
    const prev = reading(T0, parseMetrics(tensorfold({ "tensorfold:generation_tokens_running": "25" })));
    const cur = reading(T0 + 1000, parseMetrics(tensorfold({ "tensorfold:generation_tokens_running": "126" })));
    expect(figuresFrom("ok", prev, cur).decodeTokensPerSecond).toBe(101);
  });

  it("decode speed carries on across a request finishing: the gauge drops as the total jumps", () => {
    const prev = reading(T0, parseMetrics(tensorfold({ "tensorfold:generation_tokens_running": "1452" })));
    const cur = reading(T0 + 1000, parseMetrics(tensorfold({
      "tensorfold:generation_tokens_total": String(408352 + 1462),
      "tensorfold:generation_tokens_running": "0",
    })));
    expect(figuresFrom("ok", prev, cur).decodeTokensPerSecond).toBe(10);
  });

  it("no generated tokens without both the total and the gauge", () => {
    const body = tensorfold().split("\n").filter((l) => !l.startsWith("tensorfold:generation_tokens_running")).join("\n");
    expect(parseMetrics(body)["vllm:generation_tokens_total"]).toBeUndefined();
  });

  it("computed prefill tokens are prompt tokens minus cached ones", () => {
    expect(parseMetrics(tensorfold())["vllm:request_prefill_kv_computed_tokens_sum"]).toBe(6600625 - 3461120);
  });

  it("prefill speed of a finished request is its computed tokens over its prefill seconds", () => {
    // Measured: a request with 45514 prompt tokens, 43008 of them cached, prefilled in 1.55098 s.
    const prev = reading(T0, parseMetrics(tensorfold()));
    const cur = reading(T0 + 1000, parseMetrics(tensorfold({
      "tensorfold:prompt_tokens_total": String(6600625 + 45514),
      "tensorfold:prompt_tokens_cached_total": String(3461120 + 43008),
      "tensorfold:request_prefill_time_seconds_sum": String(1846.589514 + 1.55098),
      "tensorfold:request_prefill_time_seconds_count": "958",
    })));
    expect(prefillRate(prev, cur).tokensPerSecond).toBe(1615.8);
  });

  it("a fully cached prompt is a measured 0 tok/s, and no finished prompt is —", () => {
    const prev = reading(T0, parseMetrics(tensorfold()));
    const cached = reading(T0 + 1000, parseMetrics(tensorfold({
      "tensorfold:prompt_tokens_total": String(6600625 + 2048),
      "tensorfold:prompt_tokens_cached_total": String(3461120 + 2048),
      "tensorfold:request_prefill_time_seconds_sum": String(1846.589514 + 0.1),
      "tensorfold:request_prefill_time_seconds_count": "958",
    })));
    expect(prefillRate(prev, cached).tokensPerSecond).toBe(0);
    const idle = reading(T0 + 1000, parseMetrics(tensorfold()));
    expect(prefillRate(prev, idle).tokensPerSecond).toBeNull();
  });

  it("a duplicated tensorfold counter is left out, as for vLLM", () => {
    const body = tensorfold() + '\ntensorfold:num_requests_waiting{x="1"} 9';
    expect(parseMetrics(body)["vllm:num_requests_waiting"]).toBeUndefined();
  });

  it("a scrape carrying both engines' names gives no figures", () => {
    const body = tensorfold() + '\nvllm:num_requests_running{engine="0"} 1';
    expect(parseMetrics(body)).toEqual({});
  });

  it("the vLLM names still read as before when no tensorfold name is present", () => {
    const s = parseMetrics('vllm:generation_tokens_total{engine="0"} 42\nvllm:kv_cache_usage_perc{engine="0"} 0.5');
    expect(s["vllm:generation_tokens_total"]).toBe(42);
    expect(s["vllm:kv_cache_usage_perc"]).toBe(0.5);
  });

  it("a vLLM KV gauge on two lines is still left out (two engines), not maxed", () => {
    const s = parseMetrics('vllm:kv_cache_usage_perc{engine="0"} 0.5\nvllm:kv_cache_usage_perc{engine="1"} 0.7');
    expect(s["vllm:kv_cache_usage_perc"]).toBeUndefined();
  });

  // The kept prompt states the engine had to evict for room, under a tracker-own key.
  it("the evicted count is the engine's prompt_cache_evicted counter", () => {
    const s = parseMetrics(tensorfold());
    expect(s["kept_evicted_total"]).toBe(133);
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.keptEvicted).toBe(133);
    // The rest of the scrape still reads.
    expect(f.kvKeptPercent).toBe(23.1);
  });

  it("a measured 0 evictions is 0, not absent", () => {
    const s = parseMetrics(tensorfold({ "tensorfold:prompt_cache_evicted": "0" }));
    expect(s["kept_evicted_total"]).toBe(0);
    expect(figuresFrom("ok", null, reading(T0, s)).keptEvicted).toBe(0);
  });

  it("no evicted counter gives no evicted figure", () => {
    const s = parseMetrics(tensorfold({ "tensorfold:prompt_cache_evicted": [] }));
    expect(s["kept_evicted_total"]).toBeUndefined();
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.keptEvicted).toBeNull();
    expect(f.kvKeptPercent).toBe(23.1);
  });

  it("an evicted counter on two lines is left out", () => {
    const body = tensorfold() + "\ntensorfold:prompt_cache_evicted 140";
    const s = parseMetrics(body);
    expect(s["kept_evicted_total"]).toBeUndefined();
    expect(figuresFrom("ok", null, reading(T0, s)).keptEvicted).toBeNull();
  });

  it("a vLLM scrape gives no evicted figure", () => {
    const s = parseMetrics('vllm:kv_cache_usage_perc{engine="0"} 0.5');
    expect(s["kept_evicted_total"]).toBeUndefined();
    const f = figuresFrom("ok", null, reading(T0, s));
    expect(f.keptEvicted).toBeNull();
    expect(f.kvCachePercent).toBe(50);
  });

  it("no evicted figure when the status is not ok", () => {
    const s = parseMetrics(tensorfold());
    expect(s["kept_evicted_total"]).toBe(133);
    const f = figuresFrom("unreachable", null, reading(T0, s));
    expect(f.keptEvicted).toBeNull();
    expect(f.readAt).toBe(new Date(T0).toISOString());
  });
});

describe("a 200 with no figures the tracker reads", () => {
  it("gives the status no known figures, not ok", async () => {
    const p = makePoller();
    p.body("someengine:requests_running 3\nsomeengine:tokens_total 100");
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("no known figures");
    expect(p.poller.figures().running).toBeNull();
  });

  it("keeps readAt from the last reading that had figures", async () => {
    const p = makePoller();
    p.body('vllm:num_requests_running{engine="0"} 3');
    await p.poller.scrape();
    const readAt = p.poller.figures().readAt;
    p.advance(10_000);
    p.body("someengine:requests_running 3");
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("no known figures");
    expect(p.poller.figures().readAt).toBe(readAt);
  });

  it("a tensorfold scrape is ok", async () => {
    const p = makePoller();
    p.body(tensorfold());
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    expect(p.poller.figures().running).toBe(2);
    // The shard pool's booked share, not the fullest stream's 0.382196.
    expect(p.poller.figures().kvCachePercent).toBe(58.4);
    expect(p.poller.figures().kvKeptPercent).toBe(23.1);
  });
});

// The MTP draft counters move only when a request finishes, so a window in which none did
// carries no drafts and no window ratio. The poller holds the last ratio, as it holds the last
// prefill speed, and clears it when the engine restarts.
describe("MTP acceptance held across windows without drafts", () => {
  function mtpBody(gen: number, draft: number, accepted: number): string {
    return [
      `vllm:generation_tokens_total{engine="0"} ${gen}`,
      `vllm:spec_decode_num_draft_tokens_total{engine="0"} ${draft}`,
      `vllm:spec_decode_num_accepted_tokens_total{engine="0"} ${accepted}`,
    ].join("\n");
  }

  // Two readings that finish a request: 70 accepted of 100 drafted.
  async function twoReadingsWithDrafts(p: ReturnType<typeof makePoller>): Promise<void> {
    p.body(mtpBody(1000, 1000, 700));
    await p.poller.scrape();
    p.advance(10_000);
    p.body(mtpBody(1400, 1100, 770));
    await p.poller.scrape();
  }

  it("holds the last ratio through a window in which no request finished", async () => {
    const p = makePoller();
    await twoReadingsWithDrafts(p);
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
    // The draft counters stay flat while a request runs; only generation tokens move.
    p.advance(10_000);
    p.body(mtpBody(1800, 1100, 770));
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
  });

  it("clears the held ratio when a counter went down (engine restart)", async () => {
    const p = makePoller();
    await twoReadingsWithDrafts(p);
    p.advance(10_000);
    p.body(mtpBody(1800, 1100, 770));
    await p.poller.scrape();
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
    p.advance(10_000);
    p.body(mtpBody(2000, 50, 40));
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    expect(p.poller.figures().mtpAcceptancePercent).toBeNull();
    // Nothing is held any more: a later window without drafts stays null.
    p.advance(10_000);
    p.body(mtpBody(2400, 50, 40));
    await p.poller.scrape();
    expect(p.poller.figures().mtpAcceptancePercent).toBeNull();
  });

  it("a first reading has nothing held", async () => {
    const p = makePoller();
    p.body(mtpBody(1000, 1000, 700));
    await p.poller.scrape();
    expect(p.poller.figures().mtpAcceptancePercent).toBeNull();
    // The counters were read: the since-start figure is there.
    expect(p.poller.figures().mtpAcceptanceSinceStartPercent).toBe(70);
  });

  it("a new window with drafts replaces the held ratio", async () => {
    const p = makePoller();
    await twoReadingsWithDrafts(p);
    p.advance(10_000);
    p.body(mtpBody(1800, 1100, 770));
    await p.poller.scrape();
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
    // Another request finishes: 100 accepted of 200 drafted is 50%.
    p.advance(10_000);
    p.body(mtpBody(2200, 1300, 870));
    await p.poller.scrape();
    expect(p.poller.figures().mtpAcceptancePercent).toBe(50);
  });

  it("keeps the held ratio across an unreachable scrape", async () => {
    const p = makePoller();
    await twoReadingsWithDrafts(p);
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
    p.advance(10_000);
    p.status(500);
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("unreachable");
    expect(p.poller.figures().mtpAcceptancePercent).toBeNull();
    p.advance(10_000);
    p.status(200);
    p.body(mtpBody(2200, 1100, 770));
    await p.poller.scrape();
    expect(p.poller.figures().status).toBe("ok");
    expect(p.poller.figures().mtpAcceptancePercent).toBe(70);
  });
});
