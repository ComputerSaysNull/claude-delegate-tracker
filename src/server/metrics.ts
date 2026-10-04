// The model server's figures: the Prometheus text parser, the name allowlist and the
// derived rates. Rules: docs/ARCHITECTURE.md "The model server".

export const METRIC_NAMES = [
  "vllm:num_requests_running",
  "vllm:num_requests_waiting",
  "vllm:kv_cache_usage_perc",
  "vllm:generation_tokens_total",
  "vllm:prefix_cache_hits_total",
  "vllm:prefix_cache_queries_total",
  "vllm:num_preemptions_total",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

// One value per allowlisted name that appeared exactly once with a finite value.
// Label values are never kept.
export type Sample = Partial<Record<MetricName, number>>;

export interface Reading {
  atMs: number;
  sample: Sample;
}

export type ModelStatus = "ok" | "unreachable" | "not available" | "not configured";

export interface ModelFigures {
  status: ModelStatus;
  running: number | null;
  waiting: number | null;
  kvCachePercent: number | null;       // kv_cache_usage_perc × 100, one decimal
  decodeTokensPerSecond: number | null; // Δ generation_tokens_total ÷ seconds between readings, one decimal
  decodeWindowSeconds: number | null;  // the seconds that rate was measured over, whole
  prefixHitPercent: number | null;     // hits ÷ queries × 100 since the engine started, one decimal; null when queries is 0
  preemptions: number | null;          // the counter, only when above 0
  readAt: string | null;               // ISO time of the newest successful reading, kept while unreachable
}

const ALLOWED = new Set<string>(METRIC_NAMES);

function isMetricName(name: string): name is MetricName {
  return ALLOWED.has(name);
}

// A sample line is `name value` or `name{labels} value`, optionally followed by a
// timestamp. Labels may hold spaces, commas and escaped quotes inside quoted values,
// so the closing `}` is found by scanning quoted strings, not by splitting.
interface ParsedLine {
  name: string;
  value: string;
}

function parseSampleLine(line: string): ParsedLine | null {
  const n = line.length;
  let i = 0;
  while (i < n && line[i] !== "{" && line[i] !== " " && line[i] !== "\t") i++;
  const name = line.slice(0, i);
  if (name === "") return null;
  if (line[i] === "{") {
    const close = skipLabels(line, i);
    if (close === -1) return null;
    i = close + 1;
  }
  while (i < n && (line[i] === " " || line[i] === "\t")) i++;
  const start = i;
  while (i < n && line[i] !== " " && line[i] !== "\t") i++;
  const value = line.slice(start, i);
  if (value === "") return null;
  return { name, value };
}

// Returns the index of the `}` closing the label set, or -1 if it never closes.
function skipLabels(line: string, start: number): number {
  let inQuote = false;
  for (let i = start; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inQuote = false;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === "}") {
      return i;
    }
  }
  return -1;
}

// Parse Prometheus text exposition: `name{labels} value [timestamp]` lines, `#` comments.
// A name that appears more than once (more than one engine) is left out: these are one
// engine's figures.
export function parseMetrics(text: string): Sample {
  const seen = new Map<MetricName, number>();
  const values = new Map<MetricName, number>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const parsed = parseSampleLine(line);
    if (parsed === null || !isMetricName(parsed.name)) continue;
    seen.set(parsed.name, (seen.get(parsed.name) ?? 0) + 1);
    const num = Number(parsed.value);
    if (Number.isFinite(num) && seen.get(parsed.name) === 1) values.set(parsed.name, num);
  }
  const sample: Sample = {};
  for (const metric of METRIC_NAMES) {
    if (seen.get(metric) !== 1) continue;
    const value = values.get(metric);
    if (value !== undefined) sample[metric] = value;
  }
  return sample;
}

// Figures from the previous and current successful readings. `cur` null means no reading yet.
// A counter that went down (the engine restarted) gives no rate for that window; so does
// a first reading.
export function figuresFrom(status: ModelStatus, prev: Reading | null, cur: Reading | null): ModelFigures {
  if (cur === null) {
    return {
      status, running: null, waiting: null, kvCachePercent: null, decodeTokensPerSecond: null,
      decodeWindowSeconds: null, prefixHitPercent: null, preemptions: null, readAt: null,
    };
  }
  const readAt = new Date(cur.atMs).toISOString();
  if (status !== "ok") {
    return {
      status, running: null, waiting: null, kvCachePercent: null, decodeTokensPerSecond: null,
      decodeWindowSeconds: null, prefixHitPercent: null, preemptions: null, readAt,
    };
  }

  const s = cur.sample;
  const kv = s["vllm:kv_cache_usage_perc"];
  const hits = s["vllm:prefix_cache_hits_total"];
  const queries = s["vllm:prefix_cache_queries_total"];
  const preempt = s["vllm:num_preemptions_total"];
  const genCur = s["vllm:generation_tokens_total"];

  let decodeTokensPerSecond: number | null = null;
  let decodeWindowSeconds: number | null = null;
  if (prev !== null && genCur !== undefined) {
    const genPrev = prev.sample["vllm:generation_tokens_total"];
    if (genPrev !== undefined && cur.atMs > prev.atMs) {
      const deltaTokens = genCur - genPrev;
      if (deltaTokens >= 0) {
        const deltaSeconds = (cur.atMs - prev.atMs) / 1000;
        decodeTokensPerSecond = Math.round((deltaTokens / deltaSeconds) * 10) / 10;
        decodeWindowSeconds = Math.round(deltaSeconds);
      }
    }
  }

  return {
    status,
    running: s["vllm:num_requests_running"] ?? null,
    waiting: s["vllm:num_requests_waiting"] ?? null,
    kvCachePercent: kv === undefined ? null : Math.round(kv * 1000) / 10,
    decodeTokensPerSecond,
    decodeWindowSeconds,
    prefixHitPercent: hits !== undefined && queries !== undefined && queries > 0
      ? Math.round((hits / queries) * 1000) / 10
      : null,
    preemptions: preempt !== undefined && preempt > 0 ? preempt : null,
    readAt,
  };
}

export interface MetricsDeps {
  url: string | null;                  // METRICS_URL; null → "not configured"
  token: string | null;                // the bearer token, when one is configured
  fetch: typeof fetch;
  now: () => Date;
  timeoutMs: number;
}

// Scrapes `<url>/metrics` on an interval counted from the end of the previous scrape.
export class MetricsPoller {
  private readonly deps: MetricsDeps;
  private readonly listeners = new Set<(figures: ModelFigures) => void>();
  private prev: Reading | null = null;
  private last: Reading | null = null;
  private current: ModelFigures;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(deps: MetricsDeps) {
    this.deps = deps;
    this.current = figuresFrom(deps.url === null ? "not configured" : "unreachable", null, null);
  }

  // One scrape: 200 → a new reading; 404 → "not available"; anything else → "unreachable".
  async scrape(): Promise<void> {
    const { url, token, fetch: doFetch, now, timeoutMs } = this.deps;
    if (url === null) return;
    const target = `${url.replace(/\/+$/, "")}/metrics`;
    const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };
    let status: ModelStatus;
    try {
      const res = await doFetch(target, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 200) {
        const reading: Reading = { atMs: now().getTime(), sample: parseMetrics(await res.text()) };
        this.prev = this.last;
        this.last = reading;
        status = "ok";
      } else if (res.status === 404) {
        status = "not available";
      } else {
        status = "unreachable";
      }
    } catch {
      status = "unreachable";
    }
    this.apply(status);
  }

  figures(): ModelFigures {
    return this.current;
  }

  onChange(listener: (figures: ModelFigures) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(intervalSeconds: number): void {
    this.stop();
    if (this.deps.url === null) return;
    this.running = true;
    const tick = async (): Promise<void> => {
      try {
        await this.scrape();
      } catch (e) {
        console.error(e);
      }
      if (this.running) this.timer = setTimeout(() => void tick(), intervalSeconds * 1000);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private apply(status: ModelStatus): void {
    const next = figuresFrom(status, this.prev, this.last);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}
