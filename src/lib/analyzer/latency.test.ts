import { describe, expect, it } from "vitest";

import { analyzeLog } from "./index";
import { extractDuration, looksTimed, percentile, toMs } from "./latency";
import { extractRequestLine } from "./parse";
import { CHECK_COUNT, runChecks } from "./checks";

describe("toMs", () => {
  it("converts every unit to milliseconds", () => {
    expect(toMs(250, "ms")).toBe(250);
    expect(toMs(1.5, "s")).toBe(1500);
    expect(toMs(2, "minutes")).toBe(120_000);
    expect(toMs(1000, "us")).toBeCloseTo(1, 6);
    expect(Number.isNaN(toMs(1, "parsec"))).toBe(true);
  });
});

describe("extractDuration", () => {
  it("finds durations written in the common shapes", () => {
    expect(extractDuration("Query finished took 812 ms")?.ms).toBe(812);
    expect(extractDuration("duration=340ms operation=checkout")?.ms).toBe(340);
    expect(extractDuration("GET /api/orders/1 -> 200 (12ms)")?.ms).toBe(12);
    expect(extractDuration("elapsed time: 2.50s")?.ms).toBe(2500);
    expect(extractDuration("response took 1.5 s")?.ms).toBe(1500);
  });

  it("ignores numbers that are not durations", () => {
    expect(extractDuration("processed order 991 for tenant 12")).toBeUndefined();
    expect(extractDuration("no numbers here")).toBeUndefined();
    expect(extractDuration("queue depth 42")).toBeUndefined();
  });

  it("gates on a cheap pre-check", () => {
    expect(looksTimed("took 5ms")).toBe(true);
    expect(looksTimed("order 12 shipped")).toBe(false);
  });

  it("names the operation from the surrounding text", () => {
    expect(extractDuration('query took time "loadOrder" 812ms')?.name).toBe("loadOrder");
    expect(extractDuration("GET /api/orders/1 -> 200 (12ms)")?.name).toMatch(/^GET \/api\/orders/);
    expect(extractDuration("duration=340ms operation=checkout")?.name).toBe("checkout");
  });
});

describe("percentile", () => {
  it("returns nearest-rank values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(6);
    expect(percentile(values, 0.95)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("extractRequestLine", () => {
  it("reads method, path, status and response time", () => {
    expect(extractRequestLine("GET /api/orders/12 -> 200 (12ms)")).toEqual({
      method: "GET",
      path: "/api/orders/:id",
      status: 200,
      durationMs: 12,
    });
    expect(extractRequestLine("POST /api/orders -> 500 in 2.5s")?.durationMs).toBe(2500);
  });

  it("ignores lines that are not request lines", () => {
    expect(extractRequestLine("failed to process order")).toBeUndefined();
    expect(extractRequestLine("worker 4 starting")).toBeUndefined();
  });
});

describe("latency statistics", () => {
  /** 30 healthy requests plus two that blow the budget, plus one slow operation. */
const FAST_LINES = Array.from({ length: 30 }, (_, index) =>
  `2024-05-01 10:00:00,${String(index).padStart(3, "0")} INFO  [main] app.orders - GET /api/orders/1 -> 200 (${10 + index}ms)`,
);
const LINES = [
  ...FAST_LINES,
  "2024-05-01 10:00:01,000 INFO  [main] app.orders - GET /api/reports -> 200 (1500ms)",
  "2024-05-01 10:00:02,000 INFO  [main] app.orders - GET /api/reports -> 200 (3000ms)",
  "2024-05-01 10:00:03,000 WARN  [main] app.orders - Report generation took 30000ms",
].join("\n");

  it("produces percentiles, overruns and a per-operation breakdown", async () => {
    const report = await analyzeLog(LINES, { fileName: "latency.log" });
    const latency = report.latency;

    expect(latency).toBeDefined();
    expect(latency!.samples).toBe(33);
    expect(latency!.p95).toBeGreaterThan(1000);
    expect(latency!.p50).toBeLessThan(100);
    expect(latency!.max).toBe(30_000);
    expect(latency!.overBudget).toBe(3);
    expect(latency!.operations[0]?.name).toBe("Report generation");
    const reports = latency!.operations.find((op) => op.name === "/api/reports");
    expect(reports?.p95).toBeGreaterThan(1000);
    expect(latency!.http?.coverage).toBe(1);
  });

  it("raises a latency insight when the tail is over budget", async () => {
    const report = await analyzeLog(LINES, { fileName: "latency.log" });
    const ids = report.insights.map((insight) => insight.id);
    expect(ids).toContain("latency-p95");
    expect(ids).toContain("latency-outlier");
  });

  it("reports no latency at all when the file has no timings", async () => {
    const report = await analyzeLog(
      "2024-05-01 10:00:00,000 INFO  [main] a - Application started\n",
      { fileName: "quiet.log" },
    );
    expect(report.latency).toBeUndefined();
    const check = report.checks.find((entry) => entry.id === "latency-p95");
    expect(check?.status).toBe("unknown");
  });

  it("warns when HTTP lines carry no response time", async () => {
    const report = await analyzeLog(
      [
        '10.0.0.1 - - [01/May/2024:09:58:00 +0000] "GET /a HTTP/1.1" 200 15 "-" "curl"',
        '10.0.0.2 - - [01/May/2024:09:58:01 +0000] "GET /b HTTP/1.1" 200 15 "-" "curl"',
        '10.0.0.3 - - [01/May/2024:09:58:02 +0000] "GET /c HTTP/1.1" 200 15 "-" "curl"',
      ].join("\n"),
      { fileName: "access.log" },
    );
    const check = report.checks.find((entry) => entry.id === "http-latency-coverage");
    expect(check?.status).toBe("warn");
    // Without any timing the report has no latency block at all.
    expect(report.latency).toBeUndefined();
    expect(report.http?.total).toBe(3);
  });
});

describe("diagnostic checks", () => {
  const SECRET_LOG = [
    "2024-05-01 10:00:00,000 INFO  [main] a - server started on :8080",
    "2024-05-01 10:00:01,000 WARN  [main] a - calling stripe with api_key=sk_live_51H8xQ2eZvKYlo2C",
    "2024-05-01 10:00:02,000 INFO  [main] a - health check ok",
    "2024-05-01 10:00:03,000 INFO  [main] a - health check ok",
  ].join("\n");

  it("always runs every check", async () => {
    const report = await analyzeLog("2024-05-01 10:00:00,000 INFO  [main] a - started\n");
    expect(report.checks.length).toBe(CHECK_COUNT);
    expect(new Set(report.checks.map((check) => check.id)).size).toBe(CHECK_COUNT);
    // A clean file still reports passes, so the section is an audit trail.
    expect(report.checks.some((check) => check.status === "pass")).toBe(true);
  });

  it("flags a leaked credential", async () => {
    const report = await analyzeLog(SECRET_LOG, { fileName: "secret.log" });
    const check = report.checks.find((entry) => entry.id === "secret-exposure");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toMatch(/rotate/i);
  });

  it("flags missing timestamps as unknown rather than passing", async () => {
    const report = await analyzeLog("GET /a -> 200\nGET /b -> 500\nGET /c -> 200\n");
    const check = report.checks.find((entry) => entry.id === "timestamps");
    expect(check?.status).toBe("unknown");
  });

  it("flags OOM kills and crash loops", async () => {
    const report = await analyzeLog(
      [
        "2024-05-01 10:00:00,000 ERROR [main] a - Container OOMKilled, exit code 137",
        "2024-05-01 10:00:01,000 ERROR [main] a - back-off restarting failed container",
      ].join("\n"),
      { fileName: "kube.log" },
    );
    const flagged = report.checks
      .filter((c) => c.status === "fail" || c.status === "warn")
      .map((c) => c.id);
    expect(flagged).toContain("oom");
    expect(flagged).toContain("restart-loop");
  });

  it("never throws for a report with nothing in it", () => {
    const report = analyzeLogReportFixture();
    expect(() => runChecks(report)).not.toThrow();
    expect(runChecks(report).length).toBe(CHECK_COUNT);
  });
});

/** Minimal hand-made report used to prove the checks tolerate sparse data. */
function analyzeLogReportFixture() {
  const base = {
    version: 1 as const,
    fileName: "empty.log",
    sizeBytes: 0,
    format: "generic" as const,
    formatConfidence: 0.2,
    formatNotes: [],
    lineCount: 0,
    parsedLines: 0,
    emptyLines: 0,
    unclassifiedLines: 0,
    multiLineEntries: 0,
    levels: {
      fatal: 0,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      trace: 0,
      unknown: 0,
    },
    errorRate: 0,
    warningRate: 0,
    issues: [],
    knownProblems: [],
    checks: [],
    exceptionTypes: [],
    loggers: [],
    sources: [],
    timeline: [],
    insights: [],
    recommendations: [],
    samples: [],
    sampledLines: 0,
    healthScore: 100,
    analyzedAt: 0,
  };
  return base;
}