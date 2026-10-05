/**
 * Automated diagnostics.
 *
 * Every check is a small function over the finished report that answers one
 * question a developer would otherwise ask by hand: "did the process die?",
 * "is the pool exhausted?", "is p95 healthy?", "did a credential leak into the
 * log?". All of them always run, so a clean file produces a list of `pass`
 * rows — the section doubles as an audit trail of what LogLens looked for,
 * which is the difference between "no problems found" and "nothing was
 * checked".
 */

import { LEVEL_SEVERITY } from "./types";
import type {
  CheckGroup,
  CheckStatus,
  DiagnosticCheck,
  IssueGroup,
  LogReport,
} from "./types";

interface CheckOutcome {
  status: CheckStatus;
  detail: string;
  evidence?: string;
}

type CheckRun = (report: LogReport) => CheckOutcome;

/** Everything a check is allowed to look at. */
const ok = (detail: string, evidence?: string): CheckOutcome => ({
  status: "pass",
  detail,
  evidence,
});
const warn = (detail: string, evidence?: string): CheckOutcome => ({
  status: "warn",
  detail,
  evidence,
});
const fail = (detail: string, evidence?: string): CheckOutcome => ({
  status: "fail",
  detail,
  evidence,
});
const unknown = (detail: string): CheckOutcome => ({ status: "unknown", detail });

/** Lower-cased searchable text for one grouped issue. */
function haystack(issue: IssueGroup): string {
  return `${issue.pattern} ${issue.title} ${issue.exceptionType ?? ""} ${
    issue.samples[0]?.raw ?? ""
  }`.toLowerCase();
}

/** Count log lines (not groups) matching a pattern, with one real example. */
function scan(
  report: LogReport,
  pattern: RegExp,
): { lines: number; sample?: string; groups: number } {
  let lines = 0;
  let groups = 0;
  let sample: string | undefined;
  for (const issue of report.issues) {
    if (!pattern.test(haystack(issue))) continue;
    lines += issue.count;
    groups++;
    sample ??= issue.samples[0]?.raw;
  }
  return { lines, sample, groups };
}

const errorsOf = (report: LogReport) => report.levels.error + report.levels.fatal;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function ms(value: number): string {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

/* --------------------------------------------------------------- checkers */

const CHECKS: { id: string; group: CheckGroup; title: string; run: CheckRun }[] = [
  /* ------------------------------------------------------- availability */
  {
    id: "fatal-lines",
    group: "availability",
    title: "Fatal entries",
    run: (report) => {
      if (report.levels.fatal === 0) return ok("No fatal entries were logged.");
      const scanResult = scan(report, /fatal|critical|emerg|alert|panic/i);
      return fail(
        `${report.levels.fatal} fatal lines were logged — the service considers these unrecoverable.`,
        scanResult.sample,
      );
    },
  },
  {
    id: "process-crash",
    group: "availability",
    title: "Process crashes and aborts",
    run: (report) => {
      const hit = scan(
        report,
        /segmentation fault|sigsegv|sigabrt|core dumped|panic:|fatal error|abort\(\)|assertionerror|illegal state|frozen|hung thread/i,
      );
      if (hit.lines === 0) return ok("No crashes, aborts or runtime panics were found.");
      return fail(
        `${hit.lines} lines report a crash, abort or panic across ${hit.groups} group(s) — the process died rather than logged an error.`,
        hit.sample,
      );
    },
  },
  {
    id: "oom",
    group: "availability",
    title: "Memory exhaustion",
    run: (report) => {
      const hit = scan(
        report,
        /out of memory|outofmemory|oomkilled|cannot allocate memory|heap space|java\.lang\.outofmemoryerror|memoryerror|gc overhead limit/i,
      );
      if (hit.lines === 0) return ok("No out-of-memory conditions were logged.");
      return fail(
        `${hit.lines} lines report memory exhaustion.`,
        hit.sample,
      );
    },
  },
  {
    id: "unhandled-errors",
    group: "availability",
    title: "Unhandled errors escaping handlers",
    run: (report) => {
      const hit = scan(
        report,
        /unhandled(promise)?rejection|unhandled exception|uncaught (exception|error)|global exception handler/i,
      );
      if (hit.lines === 0) return ok("Every error reached a handler.");
      return warn(
        `${hit.lines} errors were never handled — they can terminate the process or drop work silently.`,
        hit.sample,
      );
    },
  },
  {
    id: "error-rate",
    group: "availability",
    title: "Overall error rate",
    run: (report) => {
      const rate = report.errorRate;
      if (rate > 0.05)
        return fail(
          `${pct(rate, 2)} of parsed lines are errors — this file describes a service in trouble.`,
        );
      if (rate > 0.01)
        return warn(
          `${pct(rate, 2)} of parsed lines are errors (${errorsOf(report).toLocaleString()} lines).`,
        );
      return ok(`Errors are ${pct(rate, 2)} of the file.`);
    },
  },
  {
    id: "dependency-failure",
    group: "availability",
    title: "Dependency and connectivity failures",
    run: (report) => {
      const hit = scan(
        report,
        /econnrefused|econnreset|connection refused|connection reset|broken pipe|epipe|ehostunreach|enetunreach|etimedout|service unavailable|503|bad gateway|gateway timeout|no healthy upstream|circuit breaker|upstream.*refused/i,
      );
      if (hit.lines === 0) return ok("No refused, reset or unreachable dependencies were found.");
      return warn(
        `${hit.lines} lines report an unreachable or failing dependency across ${hit.groups} group(s).`,
        hit.sample,
      );
    },
  },
  {
    id: "partial-failure",
    group: "availability",
    title: "Degraded or partial failures",
    run: (report) => {
      const hit = scan(
        report,
        /partial failure|degraded|circuit breaker open|failover|fallback|shedding load|stale (read|replica)|read.?only replica/i,
      );
      if (hit.lines === 0) return ok("No degraded-mode or failover markers were logged.");
      return warn(
        `${hit.lines} lines mention degraded mode, fallback or failover — requests were served, but not normally.`,
        hit.sample,
      );
    },
  },
  {
    id: "restart-loop",
    group: "availability",
    title: "Restarts and container churn",
    run: (report) => {
      const hit = scan(
        report,
        /oomkilled|back-off restarting|crashloop|restarting container|liveness probe failed|readiness probe failed|starting container|stopping container|unhealthy|init: starting|instance (re)start/i,
      );
      if (hit.lines === 0) return ok("No restart, probe or container churn markers were found.");
      return warn(
        `${hit.lines} lines mention restarts or probe failures — the instance is being recycled under load.`,
        hit.sample,
      );
    },
  },

  /* ------------------------------------------------------------ resources */
  {
    id: "file-descriptors",
    group: "resources",
    title: "File descriptor exhaustion",
    run: (report) => {
      const hit = scan(
        report,
        /too many open files|emfile|ulimit|file descriptor|too many open|24 open files|32 open files|64 open files/i,
      );
      if (hit.lines === 0) return ok("No file-descriptor limits were hit.");
      return fail(
        `${hit.lines} lines report file-descriptor exhaustion — sockets or files are not being closed.`,
        hit.sample,
      );
    },
  },
  {
    id: "disk-full",
    group: "resources",
    title: "Disk and storage pressure",
    run: (report) => {
      const hit = scan(
        report,
        /no space left|enospc|disk (is )?full|quota exceeded|read-only file system|filesystem.*full|storage.*exhausted|write failed.*space/i,
      );
      if (hit.lines === 0) return ok("No disk or quota exhaustion was logged.");
      return fail(
        `${hit.lines} lines report disk or quota exhaustion — writes are failing or about to.`,
        hit.sample,
      );
    },
  },
  {
    id: "gc-pressure",
    group: "resources",
    title: "Garbage-collection pressure",
    run: (report) => {
      const hit = scan(
        report,
        /gc overhead limit|full gc|young generation|promotion failed|concurrent mode failure|gc pause|pause.*young|allocation failure|major collection|pacMan|heap.{0,20}collected/i,
      );
      if (hit.lines === 0) return ok("No GC pressure or allocation failures were logged.");
      return warn(
        `${hit.lines} lines report GC pressure — the heap is churning rather than doing work.`,
        hit.sample,
      );
    },
  },
  {
    id: "thread-pool",
    group: "resources",
    title: "Thread and worker exhaustion",
    run: (report) => {
      const hit = scan(
        report,
        /unable to create new native thread|out of memory.*thread|thread pool (exhausted|is full|queue is full)|too many threads|max pool size|worker.*exhausted|rejected execution|bounded queue is full|pool.*saturated/i,
      );
      if (hit.lines === 0) return ok("No thread or worker pool saturation was logged.");
      return fail(
        `${hit.lines} lines report a saturated thread or worker pool — work is being rejected.`,
        hit.sample,
      );
    },
  },
  {
    id: "pool-exhaustion",
    group: "resources",
    title: "Connection pool exhaustion",
    run: (report) => {
      const hit = scan(
        report,
        /connection pool (exhausted|full|timeout)|timeout waiting for (a )?connection|pool.*(leak|starvation)|too many connections|maximum call level|get connection timed out/i,
      );
      if (hit.lines === 0) return ok("No connection pool exhaustion was logged.");
      return fail(
        `${hit.lines} lines report connection pool exhaustion.`,
        hit.sample,
      );
    },
  },

  /* ---------------------------------------------------------- concurrency */
  {
    id: "deadlock",
    group: "concurrency",
    title: "Deadlocks and lock waits",
    run: (report) => {
      const hit = scan(
        report,
        /deadlock|livelock|lock wait timeout|waiting for lock|lock timeout|could not obtain lock|database is locked|serialization failure|cannot acquire lock/i,
      );
      if (hit.lines === 0) return ok("No deadlocks or lock waits were found.");
      return fail(
        `${hit.lines} lines report a deadlock or lock wait across ${hit.groups} group(s).`,
        hit.sample,
      );
    },
  },
  {
    id: "race-condition",
    group: "concurrency",
    title: "Race conditions and thread safety",
    run: (report) => {
      const hit = scan(
        report,
        /race condition|concurrent modification|not thread-?safe|thread safety|illegalstateexception|unsynchronized|stale (state|read)|non-?atomic|compare.and.set|lost update/i,
      );
      if (hit.lines === 0) return ok("No race-condition or thread-safety markers were found.");
      return warn(
        `${hit.lines} lines suggest unsynchronised state — these bugs are timing dependent and will not reproduce reliably.`,
        hit.sample,
      );
    },
  },
  {
    id: "lock-contention",
    group: "concurrency",
    title: "Lock contention and queueing",
    run: (report) => {
      const hit = scan(
        report,
        /waiting (up to )?\d+ ?ms for lock|lock held for|contention|blocked for \d+|held by another|queue is full|queue depth|backlog|queued behind|starving|thundering herd/i,
      );
      if (hit.lines === 0) return ok("No lock contention or queueing markers were found.");
      return warn(
        `${hit.lines} lines report contention, backlog or blocked work.`,
        hit.sample,
      );
    },
  },
  {
    id: "duplicate-work",
    group: "concurrency",
    title: "Duplicate or non-idempotent work",
    run: (report) => {
      const hit = scan(
        report,
        /already processed|duplicate (message|job|request|key|payment|order)|idempotency|duplicate id|redeliver|replay(ed)? .*message|two consumers|at-least-once/i,
      );
      if (hit.lines === 0) return ok("No duplicate or replayed work was logged.");
      return warn(
        `${hit.lines} lines indicate duplicated or replayed messages — verify consumers are idempotent.`,
        hit.sample,
      );
    },
  },

  /* -------------------------------------------------------------- latency */
  {
    id: "latency-p95",
    group: "latency",
    title: "p95 latency budget",
    run: (report) => {
      const { latency } = report;
      if (!latency || latency.samples === 0)
        return unknown(
          "No timing data in the file — add durations or a response-time field to enable latency analysis.",
        );
      if (latency.p95 > 1000)
        return warn(
          `p95 is ${ms(latency.p95)} (p50 ${ms(latency.p50)}, p99 ${ms(latency.p99)}, max ${ms(
            latency.max,
          )}) over ${latency.samples.toLocaleString()} timings, above the 1s budget.`,
        );
      return ok(
        `p95 is ${ms(latency.p95)} across ${latency.samples.toLocaleString()} timings (p50 ${ms(latency.p50)}).`,
      );
    },
  },
  {
    id: "latency-outliers",
    group: "latency",
    title: "Latency outliers",
    run: (report) => {
      const { latency } = report;
      if (!latency || latency.samples < 5) return unknown("Not enough timings to judge outliers.");
      if (latency.max > Math.max(1000, latency.p95 * 4))
        return warn(
          `The slowest timing (${ms(latency.max)}) is far above p95 (${ms(latency.p95)}); ${latency.severe.toLocaleString()} samples passed 5s.`,
        );
      return ok(`The slowest timing (${ms(latency.max)}) is in line with p95.`);
    },
  },
  {
    id: "latency-operations",
    group: "latency",
    title: "Slowest operations",
    run: (report) => {
      const { latency } = report;
      if (!latency || latency.operations.length === 0)
        return unknown("No per-operation timings were found.");
      const slow = latency.operations.filter((op) => op.samples >= 2 && op.p95 > 1000);
      const worst = latency.operations[0];
      if (slow.length > 0)
        return warn(
          `${slow.length} operation(s) exceed the 1s p95 budget; worst is "${worst.name}" at p95 ${ms(worst.p95)} (max ${ms(worst.max)}).`,
        );
      return ok(
        `All ${latency.operations.length} timed operations stay under 1s at p95; worst is "${worst.name}" at ${ms(worst.p95)}.`,
      );
    },
  },
  {
    id: "latency-over-budget",
    group: "latency",
    title: "Requests over the latency budget",
    run: (report) => {
      const { latency } = report;
      if (!latency || latency.samples === 0)
        return unknown("No timings available to count budget overruns.");
      if (latency.overBudget === 0) return ok("No timing exceeded 1s.");
      return warn(
        `${latency.overBudget.toLocaleString()} of ${latency.samples.toLocaleString()} timings (${pct(
          latency.overBudgetRate,
        )}) exceeded 1s.`,
      );
    },
  },
  {
    id: "http-latency-coverage",
    group: "latency",
    title: "HTTP response-time coverage",
    run: (report) => {
      const requests = report.http?.total ?? 0;
      const timed = report.latency?.http;
      if (requests < 3) return unknown("Too few HTTP lines to judge timing coverage.");
      const coverage = timed ? timed.coverage : 0;
      if (coverage === 0)
        return warn(
          `None of the ${requests.toLocaleString()} HTTP lines carries a response time, so endpoint latency cannot be measured.`,
        );
      if (coverage < 0.5)
        return warn(
          `Only ${timed!.samples} of ${requests.toLocaleString()} HTTP lines (${pct(
            coverage,
          )}) carry a response time.`,
        );
      return ok(
        `${pct(coverage, 0)} of HTTP lines carry a response time (p95 ${ms(timed!.p95)}).`,
      );
    },
  },
  {
    id: "http-5xx",
    group: "latency",
    title: "Server-side HTTP errors",
    run: (report) => {
      const http = report.http;
      if (!http || http.total < 3) return unknown("Too few HTTP lines to judge the 5xx rate.");
      const server = http.classes.find((entry) => entry.class === "5xx");
      if (!server || server.count === 0) return ok("No request returned a 5xx status.");
      const rate = server.count / http.total;
      if (rate > 0.05)
        return fail(
          `${pct(rate, 2)} of ${http.total.toLocaleString()} requests returned 5xx — the fault is in this service.`,
          http.paths.find((path) => path.errors > 0)?.path,
        );
      return warn(
        `${pct(rate, 2)} of requests returned 5xx (${server.count}).`,
        http.paths.find((path) => path.errors > 0)?.path,
      );
    },
  },
  {
    id: "http-4xx",
    group: "latency",
    title: "Client-side HTTP errors",
    run: (report) => {
      const http = report.http;
      if (!http || http.total < 3) return unknown("Too few HTTP lines to judge the 4xx rate.");
      const client = http.classes.find((entry) => entry.class === "4xx");
      if (!client || client.count === 0) return ok("No request returned a 4xx status.");
      const rate = client.count / http.total;
      if (rate > 0.1)
        return warn(
          `${pct(rate, 2)} of requests returned 4xx — usually a broken client, bad URL or expired credential.`,
          http.paths.find((path) => path.errors > 0)?.path,
        );
      return ok(`4xx responses are ${pct(rate, 2)} of requests.`);
    },
  },

  /* ----------------------------------------------------------- throughput */
  {
    id: "error-burst",
    group: "throughput",
    title: "Error bursts",
    run: (report) => {
      const bursts = report.issues.filter(
        (issue) =>
          issue.firstSeen !== undefined &&
          issue.lastSeen !== undefined &&
          issue.lastSeen - issue.firstSeen < 60_000 &&
          issue.count > 20 &&
          LEVEL_SEVERITY[issue.level] >= LEVEL_SEVERITY.warn,
      );
      if (bursts.length === 0) return ok("No error group fired more than 20 times inside a minute.");
      const worst = bursts[0];
      return warn(
        `${bursts.length} group(s) fired inside a single minute; the largest is "${worst.title}" with ${worst.count} occurrences.`,
        worst.samples[0]?.raw,
      );
    },
  },
  {
    id: "traffic-spike",
    group: "throughput",
    title: "Traffic spikes",
    run: (report) => {
      if (report.timeline.length < 4) return unknown("Not enough timestamped volume to detect a spike.");
      const base = median(report.timeline.map((bucket) => bucket.total));
      const peak = report.timeline.reduce((max, bucket) => Math.max(max, bucket.total), 0);
      if (base <= 0) return unknown("Volume is too low to judge a spike.");
      if (peak > base * 3)
        return warn(
          `Peak volume is ${peak.toLocaleString()} lines per bucket against a median of ${base.toLocaleString()} — a ${(peak / base).toFixed(1)}x spike.`,
        );
      return ok(`Volume stays within ${(peak / base).toFixed(1)}x of its median.`);
    },
  },
  {
    id: "error-spike",
    group: "throughput",
    title: "Error rate over time",
    run: (report) => {
      const buckets = report.timeline.filter((bucket) => bucket.total > 0);
      if (buckets.length < 4) return unknown("Not enough timestamped volume to compare error rates.");
      const base = median(buckets.map((bucket) => bucket.error / bucket.total));
      const peak = buckets.reduce(
        (max, bucket) => Math.max(max, bucket.error / bucket.total),
        0,
      );
      if (base <= 0) {
        return peak > 0.02
          ? warn(`Errors reach ${pct(peak, 2)} of a bucket while the median bucket is error-free.`)
          : ok("Errors stay below 2% in every bucket.");
      }
      if (peak > base * 3 && peak > 0.02)
        return warn(
          `Errors reach ${pct(peak, 2)} of a bucket against a median of ${pct(base, 2)}.`,
        );
      return ok(`Error rate is stable (median ${pct(base, 2)}, peak ${pct(peak, 2)}).`);
    },
  },
  {
    id: "volume-drop",
    group: "throughput",
    title: "Abrupt end of logging",
    run: (report) => {
      const nonEmpty = report.timeline.filter((bucket) => bucket.total > 0);
      if (nonEmpty.length < 6) return unknown("Not enough volume history to detect a drop-off.");
      const base = median(nonEmpty.map((bucket) => bucket.total));
      const tail = nonEmpty.slice(-3);
      const tailAvg = tail.reduce((sum, bucket) => sum + bucket.total, 0) / tail.length;
      if (base > 0 && tailAvg < base * 0.25)
        return warn(
          `Volume falls to ${pct(tailAvg / base)} of its median at the end of the file — the process may have stopped, or logging broke.`,
        );
      return ok("Log volume does not collapse at the end of the file.");
    },
  },
  {
    id: "retry-storm",
    group: "throughput",
    title: "Retry storms",
    run: (report) => {
      const hit = scan(
        report,
        /retrying|retry attempt|attempt \d+ of|backoff|reconnect|redeliver|exponential backoff|retry after|retry limit/i,
      );
      if (hit.lines === 0) return ok("No retries or reconnects were logged.");
      return warn(
        `${hit.lines} lines mention retries or reconnects — retries multiply load during an incident.`,
        hit.sample,
      );
    },
  },
  {
    id: "rate-limiting",
    group: "throughput",
    title: "Rate limiting and throttling",
    run: (report) => {
      const hit = scan(
        report,
        /rate limit|ratelimit|throttl|429|too many requests|quota exceeded|concurrent request limit|slow down/i,
      );
      if (hit.lines === 0) return ok("No rate limiting was triggered.");
      return warn(
        `${hit.lines} lines report throttling or quota rejection across ${hit.groups} group(s).`,
        hit.sample,
      );
    },
  },

  /* ----------------------------------------------------------------- data */
  {
    id: "timestamps",
    group: "data",
    title: "Timestamp coverage",
    run: (report) => {
      if (!report.timeRange)
        return unknown(
          "No timestamps were parsed, so the timeline, bursts and time-based correlation are unavailable.",
        );
      if (report.timeRange.outOfOrder)
        return warn(
          "Timestamps go backwards in the file — lines from several instances are interleaved or clocks are skewed.",
        );
      return ok(`Time range ${ms(report.timeRange.durationMs)} with no backwards jumps.`);
    },
  },
  {
    id: "clock-skew",
    group: "data",
    title: "Clock skew between instances",
    run: (report) => {
      const hit = scan(
        report,
        /clock skew|time.*out of sync|clock jumped|ntp.*offset|system time.*changed|timestamp.*regression/i,
      );
      if (hit.lines === 0) return ok("No clock-skew warnings were logged.");
      return warn(`${hit.lines} lines report clock skew.`, hit.sample);
    },
  },
  {
    id: "malformed-lines",
    group: "data",
    title: "Unparsable lines",
    run: (report) => {
      if (report.parsedLines === 0) return fail("No line in the file could be parsed.");
      const rate = report.unclassifiedLines / report.parsedLines;
      if (rate > 0.2)
        return warn(
          `${pct(rate, 0)} of parsed lines have no level or structure — add structured logging to triage them automatically.`,
        );
      return ok(`${pct(rate, 0)} of lines are unclassified.`);
    },
  },
  {
    id: "json-parse",
    group: "data",
    title: "Malformed payloads",
    run: (report) => {
      const hit = scan(
        report,
        /json(parse|decode|decodeerror)|unexpected token|unexpected end of|parse error|invalid json|cannot deserialize|malformed|bad request body|unmarshal|deserializeerror|invalid utf-?8/i,
      );
      if (hit.lines === 0) return ok("No malformed payloads were logged.");
      return warn(
        `${hit.lines} lines report a payload that could not be parsed or deserialized.`,
        hit.sample,
      );
    },
  },
  {
    id: "corruption",
    group: "data",
    title: "Corruption and truncation",
    run: (report) => {
      const hit = scan(
        report,
        /corrupt|checksum mismatch|integrityerror|unexpected eof|truncated|bad signature|hash mismatch|page corrupt|torn write/i,
      );
      if (hit.lines === 0) return ok("No corruption or truncation was reported.");
      return fail(
        `${hit.lines} lines report corrupted or truncated data — a retry will not fix these.`,
        hit.sample,
      );
    },
  },
  {
    id: "schema-drift",
    group: "data",
    title: "Contract and schema drift",
    run: (report) => {
      const hit = scan(
        report,
        /unknown field|unrecognized field|additional propert|missing required|schema mismatch|contract mismatch|unexpected field|no such column|unknown column|unknown argument|invalid schema/i,
      );
      if (hit.lines === 0) return ok("No schema or contract mismatches were logged.");
      return warn(
        `${hit.lines} lines report a payload the receiver does not understand — usually a producer/consumer version skew.`,
        hit.sample,
      );
    },
  },
  {
    id: "encoding",
    group: "data",
    title: "Encoding and locale problems",
    run: (report) => {
      const hit = scan(
        report,
        /unicode(encode|decode)|codec can't|illegal byte sequence|charmap|invalid character|malformed input|can't encode|encoding error|unknown encoding|mojibake|timezone.*(invalid|ambiguous)|nonexistent time|localtime/i,
      );
      if (hit.lines === 0) return ok("No encoding, locale or time-zone errors were logged.");
      return warn(
        `${hit.lines} lines report encoding or time-zone problems.`,
        hit.sample,
      );
    },
  },

  /* ------------------------------------------------------------- security */
  {
    id: "secret-exposure",
    group: "security",
    title: "Credentials or secrets in the log",
    run: (report) => {
      const hit = scan(
        report,
        /(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[=:]\s*\S{4,}|bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}/i,
      );
      if (hit.lines === 0) return ok("No credential-shaped values were found in the log text.");
      return fail(
        `${hit.lines} lines contain credential-shaped values. Treat the log as secret, rotate the credential and stop logging it.`,
        hit.sample,
      );
    },
  },
  {
    id: "auth-failures",
    group: "security",
    title: "Authentication failures",
    run: (report) => {
      const hit = scan(
        report,
        /unauthorized|forbidden|authentication fail|invalid credentials|invalid token|token expired|jwt|signature has expired|login failed|bad credentials|permission denied|access denied|401|403/i,
      );
      if (hit.lines === 0) return ok("No authentication or authorization failures were logged.");
      return warn(
        `${hit.lines} lines are auth-related across ${hit.groups} group(s) — a steady trickle is token expiry, a spike is an attack.`,
        hit.sample,
      );
    },
  },
  {
    id: "privilege",
    group: "security",
    title: "Privilege and permission errors",
    run: (report) => {
      const hit = scan(
        report,
        /permission denied|eacces|eperm|access is denied|not permitted|requires (root|admin)|operation not permitted/i,
      );
      if (hit.lines === 0) return ok("No permission or privilege errors were logged.");
      return warn(
        `${hit.lines} lines report permission or privilege errors.`,
        hit.sample,
      );
    },
  },
  {
    id: "injection",
    group: "security",
    title: "Injection and traversal attempts",
    run: (report) => {
      const hit = scan(
        report,
        /sql injection|injection attempt|sqlinjection|union select|or 1=1|script injection|xss|path traversal|\.\.\/|etc\/passwd|ssrf|command injection|shell injection|eval\(/i,
      );
      if (hit.lines === 0) return ok("No injection or traversal attempts were logged.");
      return warn(
        `${hit.lines} lines look like injection or traversal attempts — check whether the input was rejected safely.`,
        hit.sample,
      );
    },
  },
  {
    id: "tls",
    group: "security",
    title: "Certificate and TLS validity",
    run: (report) => {
      const hit = scan(
        report,
        /certificate has expired|self signed|unable to verify|hostname mismatch|ssl routines|cert_?verify|trustanchor|certificate_unknown|handshake (failure|alert)|protocol version/i,
      );
      if (hit.lines === 0) return ok("No TLS or certificate problems were logged.");
      return warn(
        `${hit.lines} lines report TLS or certificate problems.`,
        hit.sample,
      );
    },
  },
  {
    id: "dns",
    group: "security",
    title: "Name resolution",
    run: (report) => {
      const hit = scan(
        report,
        /enotfound|eai_again|getaddrinfo|name or service not known|nxdomain|temporary failure in name resolution|dns resolution/i,
      );
      if (hit.lines === 0) return ok("No DNS resolution failures were logged.");
      return warn(`${hit.lines} lines report DNS failures.`, hit.sample);
    },
  },

  /* -------------------------------------------------------- configuration */
  {
    id: "config-missing",
    group: "configuration",
    title: "Missing or invalid configuration",
    run: (report) => {
      const hit = scan(
        report,
        /could not resolve placeholder|environment variable .* (is )?not (defined|set)|no such (config|property)|config(uration)? file .*not found|missing (required )?(config|setting)|key '[^']+' not found|invalid configuration|failed to (load|parse) config/i,
      );
      if (hit.lines === 0) return ok("No missing or invalid configuration was logged.");
      return fail(
        `${hit.lines} lines report missing or invalid configuration — the process is running with defaults it should not use.`,
        hit.sample,
      );
    },
  },
  {
    id: "port-conflict",
    group: "configuration",
    title: "Port binding conflicts",
    run: (report) => {
      const hit = scan(
        report,
        /address already in use|eaddrinuse|bind: permission denied|port .*already (in use|assigned)|cannot assign the requested address/i,
      );
      if (hit.lines === 0) return ok("No port binding conflicts were logged.");
      return fail(`${hit.lines} lines report a port binding conflict.`, hit.sample);
    },
  },
  {
    id: "env-drift",
    group: "configuration",
    title: "Environment drift between instances",
    run: (report) => {
      const hit = scan(
        report,
        /no such file or directory.*\.env|unknown (environment|profile)|feature flag|config(uration)? (mismatch|drift|differs)|version mismatch|missing (env|feature)/i,
      );
      if (hit.lines === 0) return ok("No environment or configuration drift markers were found.");
      return warn(
        `${hit.lines} lines suggest instances are running different configuration or versions.`,
        hit.sample,
      );
    },
  },
  {
    id: "incompatible-runtime",
    group: "configuration",
    title: "Runtime and version incompatibility",
    run: (report) => {
      const hit = scan(
        report,
        /unsupported class file|unsupported major|invalid class file|no matching (version|distribution)|incompatible|requires (java|python|node|openssl)|version mismatch|minimum.*version/i,
      );
      if (hit.lines === 0) return ok("No runtime or version incompatibility was logged.");
      return warn(
        `${hit.lines} lines report a runtime or version incompatibility.`,
        hit.sample,
      );
    },
  },
  {
    id: "deprecations",
    group: "configuration",
    title: "Deprecations",
    run: (report) => {
      const hit = scan(
        report,
        /deprecat|will be removed|no longer supported|end of life|legacy api|renamed to|use .* instead/i,
      );
      if (hit.lines === 0) return ok("No deprecation warnings were logged.");
      return warn(
        `${hit.lines} lines are deprecation warnings — scheduled breakage, not current breakage.`,
        hit.sample,
      );
    },
  },

  /* --------------------------------------------------------- observability */
  {
    id: "log-noise",
    group: "observability",
    title: "Noise level",
    run: (report) => {
      const noisy = report.levels.debug + report.levels.trace;
      if (report.parsedLines === 0) return unknown("Nothing parsed.");
      const rate = noisy / report.parsedLines;
      if (rate > 0.4)
        return warn(
          `${pct(rate, 0)} of the file is debug/trace noise — raise the level in production so real problems stand out.`,
        );
      return ok(`Debug/trace lines are ${pct(rate, 0)} of the file.`);
    },
  },
  {
    id: "single-logger",
    group: "observability",
    title: "Logger coverage",
    run: (report) => {
      if (report.parsedLines < 200) return unknown("File too small to judge logger coverage.");
      if (report.loggers.length <= 1)
        return warn(
          "Every line comes from a single logger, so subsystem attribution is impossible.",
        );
      const worst = report.loggers[0];
      return ok(
        `${report.loggers.length} loggers seen; busiest is ${worst.logger} with ${pct(worst.total / report.parsedLines, 0)} of lines.`,
      );
    },
  },
  {
    id: "correlation-id",
    group: "observability",
    title: "Correlation identifiers",
    run: (report) => {
      if (report.parsedLines < 200) return unknown("File too small to judge correlation coverage.");
      const hit = scan(
        report,
        /request[_-]?id|requestid|trace[_-]?id|correlation[_-]?id|x-request-id|span[_-]?id|rid=/i,
      );
      if (hit.lines === 0)
        return warn(
          "No request or trace id appears in the log, so individual requests cannot be reconstructed across services.",
        );
      return ok(
        `${hit.lines.toLocaleString()} lines carry a request or trace id.`,
        hit.sample,
      );
    },
  },
  {
    id: "structure",
    group: "observability",
    title: "Log structure",
    run: (report) => {
      if (report.format === "json")
        return ok("The file is structured JSON — every field is machine readable.");
      if (report.format === "apache" || report.format === "syslog")
        return ok(`The file follows the ${report.format} format.`);
      return warn(
        `The file is free-form text, so fields must be guessed. Emit JSON (or at least level + timestamp + message) to make triage reliable.`,
      );
    },
  },
  {
    id: "error-context",
    group: "observability",
    title: "Errors logged with context",
    run: (report) => {
      const errors = report.issues.filter(
        (issue) => LEVEL_SEVERITY[issue.level] >= LEVEL_SEVERITY.error,
      );
      if (errors.length === 0) return ok("No error lines to inspect.");
      const withStack = errors.filter(
        (issue) => issue.frames.length > 0 || issue.exceptionType,
      ).length;
      if (withStack === 0)
        return warn(
          `None of the ${errors.length} error groups carries an exception type or stack trace.`,
        );
      return ok(
        `${withStack} of ${errors.length} error groups include an exception type or stack trace.`,
      );
    },
  },
];

export const CHECK_COUNT = CHECKS.length;

/** Groups in display order. */
export const CHECK_GROUP_LABEL: Record<CheckGroup, string> = {
  availability: "Availability & crashes",
  resources: "Resources",
  concurrency: "Concurrency",
  latency: "Latency & HTTP",
  throughput: "Throughput",
  data: "Data quality",
  security: "Security",
  configuration: "Configuration",
  observability: "Logging hygiene",
};

/**
 * Run every check against a finished report. `checks` is read-only here, so it
 * is safe to call on a report whose `checks` field is still empty.
 */
export function runChecks(report: LogReport): DiagnosticCheck[] {
  return CHECKS.map((entry) => {
    let outcome: CheckOutcome;
    try {
      outcome = entry.run(report);
    } catch (error) {
      outcome = unknown(
        `This check could not run: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    return {
      id: entry.id,
      group: entry.group,
      title: entry.title,
      status: outcome.status,
      detail: outcome.detail,
      evidence: outcome.evidence,
    };
  });
}