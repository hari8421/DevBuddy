import { describe, expect, it } from "vitest";

import { analyzeLog } from "./index";
import { detectFormat } from "./detect";
import { buildSignature, normalizeMessage } from "./normalize";
import { extractTimestamp } from "./timestamps";
import { detectLevel, inferLevelFromContent } from "./levels";
import { parseStackFrame } from "./stack";
import { normalizePath } from "./parse";
import { CATALOG_BY_ID } from "../error-catalog";

const JSON_LOG = [
  JSON.stringify({ timestamp: "2024-05-01T10:00:00.000Z", level: "info", msg: "server listening", logger: "boot" }),
  JSON.stringify({ timestamp: "2024-05-01T10:00:01.000Z", level: "error", msg: "connection refused", logger: "db.pool" }),
  JSON.stringify({ timestamp: "2024-05-01T10:00:02.000Z", level: "error", msg: "connection refused", logger: "db.pool" }),
  JSON.stringify({ timestamp: "2024-05-01T10:00:03.000Z", level: "warn", msg: "slow query", logger: "db.pool" }),
].join("\n");

const JAVA_LOG = `2024-05-01 10:00:00,001 INFO  [main] c.f.Bootstrap - Application starting
2024-05-01 10:00:01,220 WARN  [http-nio-8080-exec-1] c.f.Orders - Falling back to legacy pricing for order 991
2024-05-01 10:00:02,530 ERROR [http-nio-8080-exec-1] c.f.Orders - Failed to process order
java.lang.NullPointerException: order is null
	at com.foo.orders.OrderService.process(OrderService.java:88)
	at com.foo.orders.OrderController.submit(OrderController.java:41)
2024-05-01 10:00:02,531 ERROR [http-nio-8080-exec-2] c.f.Orders - Failed to process order
java.lang.NullPointerException: order is null
	at com.foo.orders.OrderService.process(OrderService.java:88)
	at com.foo.orders.OrderController.submit(OrderController.java:41)
2024-05-01 10:00:03,000 INFO  [http-nio-8080-exec-3] c.f.Orders - order 992 processed
`;

const NGINX_LOG = `10.0.0.1 - - [01/May/2024:10:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "-" "curl/8.0"
10.0.0.2 - - [01/May/2024:10:00:01 +0000] "GET /api/orders/12 HTTP/1.1" 500 512 "-" "curl/8.0"
10.0.0.3 - - [01/May/2024:10:00:02 +0000] "GET /api/orders/993 HTTP/1.1" 500 512 "-" "curl/8.0"
10.0.0.4 - - [01/May/2024:10:00:03 +0000] "GET /api/orders/9 HTTP/1.1" 404 128 "-" "curl/8.0"
10.0.0.5 - - [01/May/2024:10:00:04 +0000] "GET /api/orders/31 HTTP/1.1" 200 998 "-" "curl/8.0"
10.0.0.6 - - [01/May/2024:10:00:05 +0000] "GET /health HTTP/1.1" 200 15 "-" "kube-probe/1.29"
`;

const SYSLOG_LOG = `May  1 10:00:01 myhost sshd[1234]: Failed password for invalid user admin from 10.0.0.9 port 51522
May  1 10:00:02 myhost kernel: [12345.678] Out of memory: Kill process 998 (worker)
May  1 10:00:03 myhost cron[999]: unable to open /var/spool/cron/root: No such file or directory
`;

const PYTHON_LOG = `2024-05-01 10:00:00,100 INFO worker - job started
2024-05-01 10:00:01,200 ERROR worker - job failed
Traceback (most recent call last):
  File "/app/worker.py", line 88, in run
    do_work(payload)
  File "/app/worker.py", line 31, in do_work
    return cache[key]
KeyError: 'user:991'
2024-05-01 10:00:02,300 INFO worker - job started
`;

describe("normalize", () => {
  it("collapses volatile values so repeated errors group together", () => {
    const a = normalizeMessage("failed to load order 991 for user 12 after 1500ms");
    const b = normalizeMessage("failed to load order 1873 for user 44 after 2500ms");
    expect(a).toBe(b);
  });

  it("keeps genuinely different messages apart", () => {
    expect(normalizeMessage("NullPointerException: order is null")).not.toBe(
      normalizeMessage("IllegalArgumentException: email is blank"),
    );
  });

  it("produces stable signatures", () => {
    const first = buildSignature("error", "timeout after 500ms for host 10.0.0.1");
    const second = buildSignature("error", "timeout after 900ms for host 10.0.0.2");
    const other = buildSignature("error", "connection refused by host 10.0.0.1");
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });
});

describe("levels", () => {
  it.each([
    ["[ERROR] something broke", "error"],
    ["WARN: disk almost full", "warn"],
    ["2024-01-01 level=debug starting", "debug"],
    ["INFO: ready", "info"],
    ["FATAL cannot bind port", "fatal"],
    ["2024-01-01T00:00:00Z WARNING:root:slow query", "warn"],
  ])("reads %s as %s", (line, expected) => {
    expect(detectLevel(line)?.level).toBe(expected);
  });

  it("infers severity from wording when the format has no level field", () => {
    expect(inferLevelFromContent("failed to open socket")).toBe("error");
    expect(inferLevelFromContent("retrying in 3s")).toBe("warn");
    expect(inferLevelFromContent("handled request")).toBe("info");
  });
});

describe("timestamps", () => {
  it.each([
    ["2024-05-01T10:00:00.123Z INFO x", Date.UTC(2024, 4, 1, 10, 0, 0, 123)],
    ["[01/May/2024:10:00:00 +0000] GET /", Date.UTC(2024, 4, 1, 10, 0, 0)],
    ["1714567200123 hello", 1714567200123],
  ])("parses %s", (line, expected) => {
    const hit = extractTimestamp(line);
    expect(hit).toBeDefined();
    expect(Math.abs((hit?.value ?? 0) - expected)).toBeLessThan(1500);
  });

  it("returns undefined for lines without a timestamp", () => {
    expect(extractTimestamp("just a plain message")).toBeUndefined();
  });
});

describe("stack frames", () => {
  it("parses Java frames", () => {
    const frame = parseStackFrame("\tat com.foo.Bar.baz(Bar.java:42)");
    expect(frame).toMatchObject({ functionName: "com.foo.Bar.baz", file: "Bar.java", line: 42 });
  });

  it("parses JavaScript frames", () => {
    const frame = parseStackFrame("    at Object.<anonymous> (/app/src/index.js:10:15)");
    expect(frame).toMatchObject({ functionName: "Object.<anonymous>", file: "/app/src/index.js", line: 10 });
  });

  it("parses Python frames", () => {
    const frame = parseStackFrame('  File "/app/worker.py", line 88, in run');
    expect(frame).toMatchObject({ file: "/app/worker.py", line: 88, functionName: "run" });
  });
});

describe("paths", () => {
  it("parameterises ids", () => {
    expect(normalizePath("/api/orders/12/items")).toBe("/api/orders/:id/items");
    expect(normalizePath("/api/orders/993?full=true")).toBe("/api/orders/:id");
  });
});

describe("detectFormat", () => {
  it("detects json logs", () => {
    expect(detectFormat(JSON_LOG.split("\n")).format).toBe("json");
  });

  it("detects access logs", () => {
    expect(detectFormat(NGINX_LOG.split("\n")).format).toBe("apache");
  });

  it("detects syslog", () => {
    expect(detectFormat(SYSLOG_LOG.split("\n")).format).toBe("syslog");
  });

  it("detects delimited text logs", () => {
    expect(detectFormat(JAVA_LOG.split("\n")).format).toBe("text");
  });
});

describe("analyzeLog", () => {
  it("summarises a JSON log", async () => {
    const report = await analyzeLog(JSON_LOG, { fileName: "api.jsonl" });
    expect(report.format).toBe("json");
    expect(report.parsedLines).toBe(4);
    expect(report.levels.error).toBe(2);
    expect(report.levels.warn).toBe(1);
    expect(report.errorRate).toBeCloseTo(0.5);
    expect(report.issues[0]?.count).toBe(2);
    expect(report.issues[0]?.title).toContain("connection refused");
    expect(report.timeline.length).toBeGreaterThan(0);
    expect(report.healthScore).toBeLessThan(100);
  });

  it("groups repeated Java exceptions and keeps the stack frames", async () => {
    const report = await analyzeLog(JAVA_LOG, { fileName: "orders.log" });
    expect(report.format).toBe("text");
    // Two `ERROR` context lines plus the two exception header lines.
    expect(report.levels.error).toBe(4);

    const issue = report.issues.find((entry) => entry.exceptionType === "java.lang.NullPointerException");
    expect(issue).toBeDefined();
    expect(issue?.count).toBe(2);
    expect(issue?.frames[0]).toMatchObject({ file: "OrderService.java", line: 88 });
    expect(issue?.frames.length).toBeGreaterThanOrEqual(3);
    expect(report.multiLineEntries).toBe(2);
    expect(report.insights.map((i) => i.id)).toContain("nulls");
    expect(report.sources.map((s) => s.location)).toContain("OrderService.java:88");
  });

  it("computes HTTP statistics for access logs", async () => {
    const report = await analyzeLog(NGINX_LOG, { fileName: "access.log" });
    expect(report.http?.total).toBe(6);
    expect(report.http?.statuses.find((s) => s.status === 500)?.count).toBe(2);
    // /api/orders/:id groups the two failing requests together.
    const path = report.http?.paths.find((p) => p.path === "/api/orders/:id");
    expect(path?.count).toBe(4);
    expect(path?.errors).toBe(2);
    expect(report.insights.map((i) => i.id)).toContain("http-5xx");
  });

  it("flags syslog failures as insights", async () => {
    const report = await analyzeLog(SYSLOG_LOG, { fileName: "syslog" });
    const ids = report.insights.map((insight) => insight.id);
    expect(ids).toContain("memory");
    expect(ids).toContain("auth");
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("handles Python tracebacks", async () => {
    const report = await analyzeLog(PYTHON_LOG, { fileName: "worker.log" });
    const issue = report.issues.find((entry) => entry.exceptionType === "KeyError");
    expect(issue?.count).toBe(1);
    expect(issue?.frames[0]).toMatchObject({ file: "/app/worker.py", line: 88 });
  });

  it("matches grouped issues against the error directory", async () => {
    const report = await analyzeLog(JAVA_LOG, { fileName: "orders.log" });

    const ids = report.knownProblems.map((match) => match.catalogId);
    expect(ids).toContain("null-reference");

    const nulls = report.knownProblems.find((match) => match.catalogId === "null-reference")!;
    // Two NPE occurrences in JAVA_LOG, plus the exception-type attribution.
    expect(nulls.occurrences).toBeGreaterThanOrEqual(2);
    expect(nulls.title).toBe("Null / undefined dereference");
    expect(nulls.example).toContain("NullPointerException");

    // Every match must resolve to a directory entry that explains itself.
    for (const match of report.knownProblems) {
      const entry = CATALOG_BY_ID.get(match.catalogId);
      expect(entry).toBeDefined();
      expect(entry!.reasons.length).toBeGreaterThan(0);
      expect(entry!.fixes.length).toBeGreaterThan(0);
    }

    // A JSON log full of timeouts is matched on the nested error stack.
    const timeoutReport = await analyzeLog(
      [
        JSON.stringify({
          timestamp: "2024-05-01T10:00:00.000Z",
          level: "error",
          msg: "checkout failed",
          logger: "payments",
          error: "Error: ETIMEDOUT payments.internal:8443\n    at capture (src/payments/client.ts:112:11)",
        }),
      ].join("\n"),
      { fileName: "checkout.jsonl" },
    );
    expect(timeoutReport.knownProblems.map((match) => match.catalogId)).toContain(
      "timeout",
    );
  });

  it("matches HTTP access logs against the directory", async () => {
    const report = await analyzeLog(NGINX_LOG, { fileName: "access.log" });
    const ids = report.knownProblems.map((match) => match.catalogId);
    expect(ids).toContain("http-5xx");
    expect(ids).toContain("http-4xx");
  });

  it("reports progress while parsing", async () => {
    const seen: number[] = [];
    await analyzeLog(JAVA_LOG, { onProgress: (progress) => seen.push(progress.percent) });
    expect(seen.at(-1)).toBe(100);
  });

  it("never throws on unstructured input", async () => {
    const report = await analyzeLog("hello\nworld\n\n???\n");
    expect(report.lineCount).toBe(4);
    expect(report.emptyLines).toBe(1);
    expect(report.parsedLines).toBe(3);
    expect(report.format).toBe("generic");
    expect(report.levels.info).toBe(3);
  });
});