/**
 * Latency analysis.
 *
 * Log files carry timing information in two very different shapes:
 *
 * 1. HTTP formats that log a response time (`$request_time`, `[123ms]`).
 * 2. Application messages that state how long something took (`took 1.2s`,
 *    `duration=340ms`, `elapsed time: 2.5s`, `query took 812 ms`).
 *
 * Most formats only ever produce shape 2, and most existing analysis stops at
 * "this line was slow". This module turns both shapes into real numbers:
 * percentiles, a per-operation breakdown and budget overruns, which is what
 * makes a latency question ("is p95 healthy?", "which operation is the
 * problem?") answerable from a log file alone.
 */

import type { LatencyStats, LatencyOperation } from "./types";

/** Anything slower than this is reported as over budget (the common SLO). */
export const LATENCY_BUDGET_MS = 1_000;
/** Anything slower than this is an outlier worth its own finding. */
export const LATENCY_SEVERE_MS = 5_000;

const UNIT_MS: Record<string, number> = {
  ns: 0.000001,
  us: 0.001,
  µs: 0.001,
  "μs": 0.001,
  ms: 1,
  msec: 1,
  msecs: 1,
  millis: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/**
 * Cue words that make a number a duration. Requiring a cue keeps ordinary
 * numbers (ids, counts, line numbers, queue depths) out of the statistics.
 */
const CUE = String.raw`(took|elapsed|latency|duration|dur\b|delay|waited\s+for|waiting\s+for|blocked\s+for|completed|finished|processed|handled|responded|resolved|query\s+time|query\s+took|execution\s+time|execution\s+took|response\s*time|response\s+took|round\s*trips?\s*in|cost|cost_ms|ttfb|rt\b)`;

const PATTERNS: RegExp[] = [
  // `took 1.2s`, `duration: 340ms`, `response_time=0.98`
  new RegExp(
    String.raw`\b${CUE}\b[^0-9]{0,18}?(\d+(?:[.,]\d+)?)\s*(ns|us|µs|μs|ms|msec|msecs|millis|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hour|hours)\b`,
    "i",
  ),
  // `[123ms]`, `(1.5 s)` — the shape used by most application access logs
  /[[(]\s*(\d+(?:[.,]\d+)?)\s*(ns|us|µs|μs|ms|msec|msecs|millis|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes)\s*[\])]/i,
  // `took=812ms`, `spent: 40ms`
  /\b(spent|spent_time|took_time|time_taken|timings?|process_time|processing_time|total_time)\b[^0-9]{0,12}?(\d+(?:[.,]\d+)?)\s*(ns|us|µs|μs|ms|msec|msecs|millis|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes)\b/i,
];

const OPERATION_NAME = /["'`]([A-Za-z][\w .:/-]{2,48})["'`]/;
const NAMED_KEY =
  /\b(?:operation|op|name|job|method|handler|action|query|sql|step|route|endpoint|command)\s*[=:]\s*["'`]?([\w.:/-]{2,48})/i;

/**
 * Compact a fragment into an operation name.
 *
 * This deliberately uses a cheap digit mask instead of the engine's full
 * `normalizeMessage`: it runs on every timed line of a possibly million-line
 * file, and the 20-plus replacements there are not worth their cost here.
 */
function compactName(value: string): string {
  return value
    .replace(/\b\d+(?:[.,]\d+)?\b/g, "n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

/** Cue patterns are few, so they are compiled once instead of per line. */
const cueCache = new Map<string, RegExp>();

function cuePattern(cue: string): RegExp {
  let pattern = cueCache.get(cue);
  if (!pattern) {
    pattern = new RegExp(`\\b${cue}\\b`, "i");
    cueCache.set(cue, pattern);
  }
  return pattern;
}

export interface DurationHit {
  /** Duration in milliseconds. */
  ms: number;
  /** Best-effort name of the operation the duration belongs to. */
  name: string;
}

/** Convert a value plus its unit into milliseconds. */
export function toMs(value: number, unit: string): number {
  const factor = UNIT_MS[unit.toLowerCase()];
  return factor === undefined ? NaN : value * factor;
}

/** Cheap gate so the full patterns only run on lines that can possibly match. */
export function looksTimed(message: string): boolean {
  return /\d(?:\.\d+)?\s*(?:ns|us|µs|μs|ms|msec|millisecond|milliseconds|sec|seconds?|s|min|minutes?|m)\b/i.test(
    message,
  );
}

/**
 * Pull the first duration out of a log message together with a name for the
 * operation it describes. Returns `undefined` when the message has no timing.
 */
export function extractDuration(message: string): DurationHit | undefined {
  if (!looksTimed(message)) return undefined;

  for (const pattern of PATTERNS) {
    const match = pattern.exec(message);
    if (!match) continue;
    const groups = match.slice(1);
    // Two patterns carry the cue group before the value; the rest are plain.
    const [valueRaw, unitRaw, cueRaw] =
      groups.length >= 3 ? groups.slice(-2).concat(groups[0]) : groups;
    const ms = toMs(Number(valueRaw.replace(",", ".")), unitRaw);
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const name = operationName(message, cueRaw);
    return { ms, name };
  }
  return undefined;
}

/** Name the operation: an explicit label, the method+path, else the prefix. */
function operationName(message: string, cue: string | undefined): string {
  const quoted = OPERATION_NAME.exec(message);
  if (quoted) return quoted[1].trim();

  // `GET /api/orders/12 -> 200 (12ms)` is the most common shape by far.
  const methodPath = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i.exec(message);
  if (methodPath) {
    return compactName(`${methodPath[1]} ${methodPath[2].split("?")[0]}`);
  }

  // Cut the message at the cue word so the prefix names the operation.
  const cut = cue ? cuePattern(cue).exec(message) : undefined;
  const prefix = (cut ? message.slice(0, cut.index) : message)
    .replace(/[[(][^\])]*[\])]/g, " ")
    .trim();

  // Drop a leading logger name: `c.foo.SqlRepository - SELECT ...`.
  const withoutLogger = /^[\w.$]{4,}\s+[-–—|]\s+(.+)$/.exec(prefix);
  if (withoutLogger) return compactName(withoutLogger[1]);

  const normalized = compactName(prefix).replace(/^[\s\-:>]+|[\s\-:,]+$/g, "");
  if (normalized) return normalized;

  // No usable prefix (the cue leads the line): fall back to a named field.
  const named = NAMED_KEY.exec(message);
  if (named) return named[1].trim();

  // Last resort: the first few meaningful words of the message.
  const words = message
    .replace(/[[(][^\])]*[\])]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !/^(in|after|within|to|for|the|was|is)$/i.test(word))
    .slice(0, 3)
    .join(" ");
  return compactName(words) || "operation";
}

/* ------------------------------------------------------------- statistics */

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1))),
  );
  return sorted[position];
}

interface OpAccumulator {
  name: string;
  count: number;
  total: number;
  max: number;
  overBudget: number;
  values: number[];
  example?: string;
}

/**
 * Bounded streaming collector for durations.
 *
 * The file can hold millions of lines, so only a capped reservoir of values is
 * kept per operation (plus exact counters for count/total/max). Percentiles are
 * therefore computed over a sample, while the counts and the maximum stay
 * exact.
 */
export class LatencyCollector {
  private readonly cap: number;
  private readonly opCap: number;
  private readonly opSampleCap: number;
  private overall: number[] = [];
  private httpValues: number[] = [];
  private httpWithTiming = 0;
  private httpTotal = 0;
  private count = 0;
  private total = 0;
  private max = 0;
  private overBudget = 0;
  private severe = 0;
  private linesSeen = 0;
  private readonly ops = new Map<string, OpAccumulator>();

  constructor(options: { cap?: number; opCap?: number; opSampleCap?: number } = {}) {
    this.cap = options.cap ?? 20_000;
    this.opCap = options.opCap ?? 200;
    this.opSampleCap = options.opSampleCap ?? 2_000;
  }

  /** Call for every parsed line; the cheap gate happens inside. */
  addMessage(message: string): void {
    this.linesSeen++;
    const hit = extractDuration(message);
    if (hit) this.add(hit);
  }

  add(hit: DurationHit): void {
    this.count++;
    this.total += hit.ms;
    this.max = Math.max(this.max, hit.ms);
    if (hit.ms > LATENCY_BUDGET_MS) this.overBudget++;
    if (hit.ms > LATENCY_SEVERE_MS) this.severe++;

    if (this.overall.length < this.cap) this.overall.push(hit.ms);

    const key = hit.name;
    let op = this.ops.get(key);
    if (!op) {
      if (this.ops.size >= this.opCap) {
        // Reservoir-style eviction: drop the least sampled operation so a long
        // tail of one-off names cannot crowd out the useful ones.
        const victim = [...this.ops.entries()].sort(
          (a, b) => a[1].count - b[1].count,
        )[0];
        if (victim) this.ops.delete(victim[0]);
      }
      op = { name: key, count: 0, total: 0, max: 0, overBudget: 0, values: [] };
      this.ops.set(key, op);
    }
    op.count++;
    op.total += hit.ms;
    op.max = Math.max(op.max, hit.ms);
    if (hit.ms > LATENCY_BUDGET_MS) op.overBudget++;
    if (op.values.length < this.opSampleCap) op.values.push(hit.ms);
  }

  /** Feed HTTP response times so they show up in the percentiles too. */
  addHttp(
    path: string | undefined,
    durationMs: number | undefined,
    hasStatus: boolean,
    message?: string,
  ): void {
    this.linesSeen++;
    if (hasStatus) this.httpTotal++;
    if (durationMs === undefined || !Number.isFinite(durationMs)) return;
    this.httpWithTiming++;
    this.count++;
    this.total += durationMs;
    this.max = Math.max(this.max, durationMs);
    if (durationMs > LATENCY_BUDGET_MS) this.overBudget++;
    if (durationMs > LATENCY_SEVERE_MS) this.severe++;
    if (this.overall.length < this.cap) this.overall.push(durationMs);
    if (this.httpValues.length < this.cap) this.httpValues.push(durationMs);

    // Without a path (a JSON line that only carries `durationMs`), the
    // operation is named from the message so it still groups usefully.
    const name = path ?? (message ? operationName(message, undefined) : "operation");
    let op = this.ops.get(name);
    if (!op) {
      if (this.ops.size >= this.opCap) return;
      op = { name, count: 0, total: 0, max: 0, overBudget: 0, values: [] };
      this.ops.set(name, op);
    }
    op.count++;
    op.total += durationMs;
    op.max = Math.max(op.max, durationMs);
    if (durationMs > LATENCY_BUDGET_MS) op.overBudget++;
    if (op.values.length < this.opSampleCap) op.values.push(durationMs);
  }

  /** True when at least one duration was found anywhere in the file. */
  get hasSamples(): boolean {
    return this.count > 0;
  }

  build(): LatencyStats | undefined {
    if (this.count === 0) return undefined;

    const sorted = [...this.overall].sort((a, b) => a - b);
    const operations: LatencyOperation[] = [...this.ops.values()]
      .map((op) => {
        const values = [...op.values].sort((a, b) => a - b);
        return {
          name: op.name,
          samples: op.count,
          avg: op.total / op.count,
          p50: percentile(values, 0.5),
          p90: percentile(values, 0.9),
          p95: percentile(values, 0.95),
          p99: percentile(values, 0.99),
          max: op.max,
          overBudget: op.overBudget,
        };
      })
      .sort((a, b) => b.p95 - a.p95 || b.samples - a.samples)
      .slice(0, 20);

    const httpSorted = [...this.httpValues].sort((a, b) => a - b);

    return {
      samples: this.count,
      avg: this.total / this.count,
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      max: this.max,
      overBudget: this.overBudget,
      severe: this.severe,
      overBudgetRate: this.overBudget / this.count,
      operations,
      /** Parsed lines that carried no duration at all. */
      linesWithoutTiming: Math.max(0, this.linesSeen - this.count),
      http: {
        samples: this.httpWithTiming,
        // A line can carry a duration without a status, so the request count is
        // never lower than the number of timed request lines.
        requests: Math.max(this.httpTotal, this.httpWithTiming),
        coverage:
          this.httpTotal > 0
            ? Math.min(1, this.httpWithTiming / this.httpTotal)
            : this.httpWithTiming > 0
              ? 1
              : 0,
        p50: percentile(httpSorted, 0.5),
        p95: percentile(httpSorted, 0.95),
        p99: percentile(httpSorted, 0.99),
        max: httpSorted.length > 0 ? httpSorted[httpSorted.length - 1] : 0,
      },
    };
  }
}

/** Latency findings derived from the collected statistics. */
export function latencyFindings(
  stats: LatencyStats | undefined,
  http?: { slowest?: { path: string; durationMs: number } },
): {
  id: string;
  severity: "warning" | "info";
  title: string;
  detail: string;
  recommendation: string;
}[] {
  if (!stats || stats.samples === 0) return [];
  const out: ReturnType<typeof latencyFindings> = [];

  const fmt = (value: number) =>
    value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;

  if (stats.p95 > LATENCY_BUDGET_MS) {
    out.push({
      id: "latency-p95",
      severity: "warning",
      title: "Tail latency above the 1s budget",
      detail: `p50 is ${fmt(stats.p50)} but p95 reaches ${fmt(stats.p95)} and p99 ${fmt(
        stats.p99,
      )} across ${stats.samples.toLocaleString()} timings — a long tail, not a uniformly slow service.`,
      recommendation:
        "Look at the slowest operations below and at the max values; long tails are usually a small set of slow queries, lock waits or cold caches rather than uniform slowness.",
    });
  }

  if (stats.p95 > 0 && stats.max > stats.p95 * 4 && stats.max > LATENCY_BUDGET_MS) {
    out.push({
      id: "latency-outlier",
      severity: "warning",
      title: "Latency outliers far above the p95",
      detail: `The slowest timing (${fmt(stats.max)}) is more than 4x the p95 (${fmt(
        stats.p95,
      )}). ${stats.severe.toLocaleString()} samples exceeded ${fmt(LATENCY_SEVERE_MS)}.`,
      recommendation:
        "Grep the log for the outlier timings and check whether they share a retry, a cold start, a GC pause or a single slow dependency.",
    });
  }

  const worst = stats.operations.filter((op) => op.samples >= 3).slice(0, 3);
  for (const op of worst) {
    if (op.p95 < LATENCY_BUDGET_MS) continue;
    out.push({
      id: `latency-op-${op.name}`,
      severity: op.p95 > LATENCY_SEVERE_MS ? "warning" : "info",
      title: `Slow operation: ${op.name}`,
      detail: `${op.samples.toLocaleString()} timings, median ${fmt(op.p50)}, p95 ${fmt(
        op.p95,
      )}, max ${fmt(op.max)}${op.overBudget > 0 ? `, ${op.overBudget} over budget` : ""}.`,
      recommendation:
        "Add tracing around this operation, check its query plan or dependency call, and give it an explicit timeout budget.",
    });
  }

  if (
    stats.http &&
    stats.http.requests > 0 &&
    stats.http.coverage < 0.5 &&
    stats.http.requests >= 5
  ) {
    out.push({
      id: "latency-coverage",
      severity: "info",
      title: "Most HTTP requests carry no response time",
      detail: `Only ${stats.http.samples} of ${stats.http.requests.toLocaleString()} HTTP lines include a duration, so endpoint latency could not be measured for the rest.`,
      recommendation:
        "Enable the response-time field of your access log format ($request_time, %D, duration_ms) — without it, endpoint latency is invisible.",
    });
  }

  if (http && http.slowest && http.slowest.durationMs > LATENCY_BUDGET_MS) {
    out.push({
      id: "latency-slowest-endpoint",
      severity: "warning",
      title: `Slowest endpoint: ${http.slowest.path}`,
      detail: `${fmt(http.slowest.durationMs)} for a single request to ${http.slowest.path}.`,
      recommendation:
        "Reproduce that request and profile it; a single very slow request is often an unindexed query or a lock wait rather than general load.",
    });
  }

  return out.slice(0, 6);
}