/**
 * Insight detectors.
 *
 * Each detector recognises a well-known failure mode (memory exhaustion,
 * timeouts, database problems, auth failures, …) and turns the grouped issues
 * into an explanation plus a concrete next step for the developer.
 */

import type { Insight, InsightSeverity, IssueGroup, LatencyStats } from "./types";
import { LEVEL_SEVERITY } from "./types";
import { latencyFindings } from "./latency";

export interface InsightInput {
  issues: IssueGroup[];
  exceptionTypes: { type: string; count: number }[];
  http?: {
    total: number;
    errorRate: number;
    classes: { class: string; count: number }[];
    slowest?: { path: string; durationMs: number };
    paths: { path: string; count: number; errors: number; maxDurationMs?: number }[];
  };
  timeRange?: { durationMs: number };
  latency?: LatencyStats;
  healthScore: number;
  levels: Record<string, number>;
}

interface Detector {
  id: string;
  severity: InsightSeverity;
  pattern: RegExp;
  title: string;
  recommendation: string;
  detail: (hits: MatchHit[]) => string;
}

interface MatchHit {
  issue: IssueGroup;
  matches: string[];
}

const count = (hits: MatchHit[]) => hits.reduce((sum, hit) => sum + hit.issue.count, 0);

const DETECTORS: Detector[] = [
  {
    id: "memory",
    severity: "critical",
    pattern: /out of memory|outofmemory|memoryerror|heap space|oom|gc overhead|cannot allocate memory/i,
    title: "Memory exhaustion",
    recommendation:
      "Raise the heap/limit for the failing process, and check for a leak: look for objects retained by long-lived collections, un-closed subscriptions or caches without eviction.",
    detail: (hits) =>
      `${count(hits)} lines report the process ran out of memory. This is the failure most likely to take the service down, so treat it before the other findings.`,
  },
  {
    id: "timeouts",
    severity: "critical",
    pattern: /timed out|timeout|etimedout|esockettimedout|deadlineexceeded|read timed/i,
    title: "Timeouts and deadline overruns",
    recommendation:
      "Check the slowest dependency in the trace (database, cache, third-party API). Add or tune a timeout budget, make retries idempotent with exponential backoff, and consider a circuit breaker.",
    detail: (hits) =>
      `${count(hits)} lines timed out. Timeouts usually mean an upstream dependency is slow or unreachable, and they cascade into retries that make the load worse.`,
  },
  {
    id: "connection",
    severity: "critical",
    pattern: /econnrefused|econnreset|connection refused|connection reset|broken pipe|epipe|ehostunreach|enetunreach/i,
    title: "Connection failures",
    recommendation:
      "The target host is refusing or dropping connections. Verify the service is up and the port/host is correct, then add a bounded connection pool with retry and health checks.",
    detail: (hits) =>
      `${count(hits)} lines report refused or reset connections, which points at an unhealthy instance, a wrong endpoint or a proxy/LB dropping connections.`,
  },
  {
    id: "database",
    severity: "critical",
    pattern: /sqlstate|sqlexception|deadlock|too many connections|connection pool|queryfailederror|unique constraint|foreign key|duplicate key|lock wait timeout|serializationfailure/i,
    title: "Database problems",
    recommendation:
      "Review the failing queries in the stack traces, add the missing indexes, bound the connection pool, and make writes idempotent so retries cannot duplicate rows.",
    detail: (hits) =>
      `${count(hits)} lines report database errors such as constraint violations, deadlocks or pool exhaustion.`,
  },
  {
    id: "crash",
    severity: "critical",
    pattern: /segmentation fault|sigsegv|sigabrt|core dumped|panic:|fatal error|abort\(\)|assertionerror|assertion failed/i,
    title: "Process crashes",
    recommendation:
      "These lines come from a hard abort, so the process died rather than logged an error. Reproduce locally from the top frame of the trace and fix the crash before anything else.",
    detail: (hits) =>
      `${count(hits)} lines report a crash or fatal abort. Anything logged before the abort is a symptom; the top stack frame is the actual defect.`,
  },
  {
    id: "unhandled",
    severity: "warning",
    pattern: /unhandled(promise)?rejection|unhandled exception|uncaught (exception|error)/i,
    title: "Unhandled errors escaping handlers",
    recommendation:
      "Wrap the throwing call sites in try/catch (or await them), and add a global error handler so failures surface as normal error logs instead of terminating the process.",
    detail: (hits) =>
      `${count(hits)} errors were never handled. Anything unhandled can terminate the process or silently drop work.`,
  },
  {
    id: "nulls",
    severity: "warning",
    pattern: /nullpointerexception|nullreferenceexception|cannot read propert|is not iterable|undefined is not|cannot access .* before initialization|typeerror/i,
    title: "Null / undefined dereferences",
    recommendation:
      "Guard the null paths in the top frames, validate input at the boundary (schema validation), and enable null-safety in the language if it is available.",
    detail: (hits) =>
      `${count(hits)} lines are null/undefined dereferences — the single most common defect class in application logs.`,
  },
  {
    id: "resources",
    severity: "warning",
    pattern: /enoent|emfile|enospc|too many open files|no space left|resource temporarily unavailable|quota exceeded|filenotfounderror/i,
    title: "Filesystem and resource limits",
    recommendation:
      "Check disk usage and file-descriptor limits, close handles in a finally block, and add disk/FD headroom alerts before the limit is hit again.",
    detail: (hits) =>
      `${count(hits)} lines report filesystem or resource-limit problems (missing files, no space, too many open handles).`,
  },
  {
    id: "auth",
    severity: "warning",
    pattern: /unauthorized|forbidden|authentication fail|invalid credentials|invalid token|token expired|jwt|signature has expired|permission denied|access denied|failed password|invalid user|login failed|bad credentials|401|403/i,
    title: "Authentication and authorization failures",
    recommendation:
      "Distinguish expired credentials from real attacks: refresh tokens proactively, verify clocks/NTP, and alert when the failure rate for one tenant or IP spikes.",
    detail: (hits) =>
      `${count(hits)} lines are auth-related. A steady trickle is usually expiry; a sudden spike is usually a client bug or an attack.`,
  },
  {
    id: "rate-limit",
    severity: "warning",
    pattern: /rate limit|throttl|429|too many requests|quota exceeded/i,
    title: "Rate limiting and throttling",
    recommendation:
      "Back off exponentially on 429/503 responses, honour the Retry-After header, and batch or debounce client calls that hit the limit.",
    detail: (hits) => `${count(hits)} lines mention rate limiting or throttling.`,
  },
  {
    id: "retries",
    severity: "warning",
    pattern: /\bretry|retrying|reconnect|backoff|redeliver/i,
    title: "Retry storms",
    recommendation:
      "Cap retries with exponential backoff and jitter, and make sure retries are idempotent. Many duplicated failures are a single client retrying far too hard.",
    detail: (hits) =>
      `${count(hits)} lines mention retries or reconnects. When these are close in time to the errors, the client is amplifying the incident.`,
  },
  {
    id: "dns-tls",
    severity: "warning",
    pattern: /enotfound|eai_again|getaddrinfo|name resolution|certificate|ssl|tls handshake|cert_/i,
    title: "DNS and TLS problems",
    recommendation:
      "Verify DNS records and the certificate chain on every instance, and pin the trust store in the container image so system trust differences cannot break the handshake.",
    detail: (hits) =>
      `${count(hits)} lines report DNS resolution or TLS handshake failures — often caused by a stale image or a rotated certificate.`,
  },
  {
    id: "corruption",
    severity: "critical",
    pattern: /corrupt|checksum mismatch|integrityerror|unexpected eof|truncated|bad signature|malformed/i,
    title: "Data corruption or truncated payloads",
    recommendation:
      "Do not retry blindly: capture the failing payload, verify the producer's encoding/checksum, and check for partial writes on the producer side.",
    detail: (hits) =>
      `${count(hits)} lines indicate corrupted, truncated or malformed data. These are rarely fixed by a retry.`,
  },
  {
    id: "deprecation",
    severity: "info",
    pattern: /deprecat|will be removed|no longer supported|end of life|legacy api/i,
    title: "Deprecation warnings",
    recommendation:
      "Track these down before the next major release. Each one is a scheduled breaking change in a dependency or platform API.",
    detail: (hits) => `${count(hits)} deprecation warnings were logged.`,
  },
  {
    id: "slow",
    severity: "warning",
    pattern: /took \d+ ?ms|elapsed|duration|slow|latency exceeded|degraded/i,
    title: "Slow operations",
    recommendation:
      "Compare the slowest endpoints against their budgets and add tracing around the slowest frames to find where the time is actually spent.",
    detail: (hits) => `${count(hits)} lines report slow operations or latency overruns.`,
  },
  {
    id: "gc-pause",
    severity: "warning",
    pattern: /gc overhead|full gc|garbage collection|pause.*young gen|promotion failed|allocation failure/i,
    title: "GC pauses and allocation failures",
    recommendation:
      "Reduce allocation on the hot path (reuse buffers, avoid per-request object graphs), size the heap deliberately, and consider a collector or GC settings tuned for throughput.",
    detail: (hits) =>
      `${count(hits)} lines report garbage-collection pressure. GC pauses look like random latency spikes, so they are usually mistaken for a slow dependency.`,
  },
  {
    id: "lock-wait",
    severity: "warning",
    pattern: /lock wait timeout|deadlock|waiting for lock|could not obtain lock|lock contention|blocked for \d+/i,
    title: "Lock waits and contention",
    recommendation:
      "Shorten the critical section, order your lock acquisition consistently, and check for a transaction that holds a row lock across a network call.",
    detail: (hits) =>
      `${count(hits)} lines report waiting for a lock. A wait of a few hundred milliseconds inside a transaction turns into a request timeout at the edge.`,
  },
  {
    id: "circuit-breaker",
    severity: "warning",
    pattern: /circuit breaker|fallback activated|degraded mode|failover|bulkhead|shedding load|retry budget/i,
    title: "Resilience mechanisms engaged",
    recommendation:
      "These lines mean the system already reacted to a failure. Find the dependency that tripped the breaker first; the fallback is a symptom, not the cause.",
    detail: (hits) =>
      `${count(hits)} lines show a circuit breaker, fallback or degraded mode. Requests were served, but the dependency behind them was already unhealthy.`,
  },
  {
    id: "container-restart",
    severity: "critical",
    pattern: /oomkilled|back-off restarting|crashloop|liveness probe failed|readiness probe failed|restart policy|unhealthy container/i,
    title: "Instances restarted under load",
    recommendation:
      "An instance is being recycled repeatedly, which usually means an OOM kill, a crash loop or a probe timeout. Check the exit reason before scaling out.",
    detail: (hits) =>
      `${count(hits)} lines show the platform restarting an instance. The previous crash is the real bug — this is the platform reacting to it.`,
  },
  {
    id: "logging-noise",
    severity: "info",
    pattern: /logged at (debug|trace)|verbose logging|log level set to (debug|trace)|debug logging enabled/i,
    title: "Verbose logging enabled in production",
    recommendation:
      "Turn debug logging off outside a debugging window. It multiplies volume and cost, and it buries the lines you need during an incident.",
    detail: (hits) =>
      `${count(hits)} lines report debug or trace level logging in a non-development environment.`,
  },
];

export function buildInsights(input: InsightInput): {
  insights: Insight[];
  recommendations: string[];
} {
  const insights: Insight[] = [];

  for (const detector of DETECTORS) {
    const hits: MatchHit[] = [];
    for (const issue of input.issues) {
      const haystack = `${issue.pattern} ${issue.title} ${issue.exceptionType ?? ""}`;
      const match = haystack.match(detector.pattern);
      if (match) hits.push({ issue, matches: match });
    }
    if (hits.length === 0) continue;
    insights.push({
      id: detector.id,
      severity: detector.severity,
      title: detector.title,
      detail: detector.detail(hits),
      occurrences: count(hits),
      recommendation: detector.recommendation,
      example: hits[0].issue.samples[0]?.raw,
    });
  }

  // HTTP-specific findings that are not visible in message text.
  const http = input.http;
  if (http && http.total >= 3) {
    const server = http.classes.find((c) => c.class === "5xx");
    const client = http.classes.find((c) => c.class === "4xx");
    if (server && server.count / http.total > 0.02) {
      insights.push({
        id: "http-5xx",
        severity: "critical",
        title: "Server-side HTTP failures",
        detail: `${server.count} of ${http.total} requests (${((server.count / http.total) * 100).toFixed(1)}%) returned 5xx. These are generated by your own code, not the client.`,
        occurrences: server.count,
        recommendation:
          "Sort the failing endpoints by error count below, then reproduce the top one with the request id from the log to find the throwing frame.",
        example: http.paths.find((p) => p.errors > 0)?.path,
      });
    }
    if (client && client.count / http.total > 0.1) {
      insights.push({
        id: "http-4xx",
        severity: "warning",
        title: "High client-error rate",
        detail: `${client.count} of ${http.total} requests (${((client.count / http.total) * 100).toFixed(1)}%) returned 4xx, which usually means a broken client, a bad URL or expired credentials.`,
        occurrences: client.count,
        recommendation:
          "Check the top 4xx paths for a shared pattern (missing parameter, wrong route, expired token) before touching server code.",
      });
    }
    if (http.slowest && http.slowest.durationMs >= 1000) {
      insights.push({
        id: "http-slowest-endpoint",
        severity: "warning",
        title: "Slow endpoint",
        detail: `${http.slowest.path} answered in ${Math.round(http.slowest.durationMs)}ms, which is above the usual 1s budget.`,
        occurrences: 1,
        recommendation:
          "Profile that route and add a latency alert so the regression is caught by monitoring rather than by users.",
        example: http.slowest.path,
      });
    }
  }

  // Latency statistics cannot be read off message text, so they arrive as their
  // own findings computed from the collected percentiles.
  for (const finding of latencyFindings(input.latency, http)) {
    insights.push({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      occurrences: input.latency?.samples ?? 1,
      recommendation: finding.recommendation,
    });
  }

  const severityRank: Record<InsightSeverity, number> = { critical: 3, warning: 2, info: 1 };
  insights.sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || b.occurrences - a.occurrences,
  );

  return { insights, recommendations: buildRecommendations(input, insights) };
}

function buildRecommendations(input: InsightInput, insights: Insight[]): string[] {
  const recommendations: string[] = [];

  const noise = input.issues.filter(
    (issue) => LEVEL_SEVERITY[issue.level] < LEVEL_SEVERITY.warn && issue.share < 0.2,
  );
  if (noise.length > 5) {
    recommendations.push(
      `Suppress or lower the level of ${noise.length} high-volume informational groups (for example debug chatter) so real problems stand out.`,
    );
  }

  const top = input.issues
    .filter((issue) => LEVEL_SEVERITY[issue.level] >= LEVEL_SEVERITY.warn)
    .slice(0, 3);
  for (const issue of top) {
    recommendations.push(
      `Fix "${issue.title}" first: ${issue.count} occurrence${issue.count === 1 ? "" : "s"} (${(issue.share * 100).toFixed(1)}% of the file).`,
    );
  }

  for (const insight of insights.filter((i) => i.severity === "critical").slice(0, 2)) {
    recommendations.push(`${insight.title}: ${insight.recommendation}`);
  }

  const bursty = input.issues.filter((issue) => issue.firstSeen !== undefined && issue.lastSeen !== undefined
    && issue.lastSeen - issue.firstSeen < 60_000 && issue.count > 20);
  if (bursty.length > 0) {
    recommendations.push(
      `${bursty.length} error group${bursty.length === 1 ? "" : "s"} fired inside a single minute: correlate the first timestamp with deployments, config changes or traffic spikes.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      input.levels.error
        ? "Add the surrounding context (request ids, deploy version, dependency timings) to make the next run easier to triage."
        : "No errors or warnings were found. Keep an eye on volume growth and add sampling if the file gets very large.",
    );
  }

  return recommendations.slice(0, 8);
}