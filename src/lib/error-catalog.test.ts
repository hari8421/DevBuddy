import { describe, expect, it } from "vitest";

import {
  CATALOG_BY_ID,
  CATEGORY_COLOR,
  CATEGORY_COUNTS,
  CATEGORY_LABEL,
  ERROR_CATALOG,
  ERROR_CATEGORIES,
  matchCatalog,
} from "./error-catalog";

describe("error catalog integrity", () => {
  it("covers every category with at least one entry", () => {
    for (const category of ERROR_CATEGORIES) {
      expect(CATEGORY_COUNTS[category]).toBeGreaterThan(0);
      expect(CATEGORY_LABEL[category]).toBeTruthy();
      expect(CATEGORY_COLOR[category]).toBeTruthy();
    }
  });

  it("has no duplicate ids", () => {
    const ids = ERROR_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry the content the UI renders", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.reasons.length).toBeGreaterThanOrEqual(2);
      expect(entry.fixes.length).toBeGreaterThanOrEqual(2);
      expect(entry.patterns.length).toBeGreaterThan(0);
      expect(entry.languages.length).toBeGreaterThan(0);
      expect(ERROR_CATEGORIES).toContain(entry.category);
      // Patterns are compiled and anchored on text that actually exists.
      for (const pattern of entry.patterns) {
        expect(pattern.flags).not.toContain("g");
      }
    }
  });

  it("is broad enough to be worth calling a directory", () => {
    expect(ERROR_CATALOG.length).toBeGreaterThanOrEqual(100);
    expect(ERROR_CATEGORIES.length).toBeGreaterThanOrEqual(19);
  });
});

describe("matchCatalog", () => {
  const match = (lines: string[]) =>
    matchCatalog({
      issues: lines.map((line, index) => ({
        id: `issue-${index}`,
        pattern: line,
        title: line,
        count: 1,
        samples: [{ raw: line }],
      })),
      exceptionTypes: [],
    }).map((found) => found.catalogId);

  it("recognises a spread of failure modes", () => {
    expect(match(["java.lang.NullPointerException: order is null"])).toContain("null-reference");
    expect(match(["Error: read ECONNRESET 10.0.0.4:5432"])).toContain("connection-refused");
    expect(match(["Container OOMKilled (exit code 137)"])).toContain("oom-killed");
    expect(match(["back-off restarting failed container payment"])).toContain("crash-loop");
    expect(match(["RabbitMQ: no brokers available"])).toContain("queue-unavailable");
    expect(match(["org.springframework.beans.factory.NoSuchBeanDefinitionException: no qualifying bean of type 'com.acme.Pay'"])).toContain("injection-failure");
    expect(match(["cert verify failed: self signed certificate in chain"])).toContain("dns-tls");
    expect(match(["UnicodeEncodeError: 'ascii' codec can't encode character"])).toContain("unicode-error");
    expect(match(["GET /api/orders/1 -> 503 (12ms)"])).toContain("http-5xx");
    expect(match(["payment declined: insufficient funds"])).toContain("insufficient-balance");
  });

  it("does not fire on a timestamp that merely contains 400", () => {
    // `10:00:12,400` is a millisecond field, not an HTTP status.
    const ids = match(["2024-05-01 10:00:12,400 INFO  [main] a - Graceful shutdown complete"]);
    expect(ids).not.toContain("http-4xx");
    expect(ids).not.toContain("validation-error");
  });

  it("adds up occurrences across groups and de-duplicates by entry", () => {
    const matches = matchCatalog({
      issues: [
        { id: "a", pattern: "NullPointerException", title: "a", count: 3 },
        { id: "b", pattern: "NullPointerException", title: "b", count: 4 },
      ],
      exceptionTypes: [{ type: "java.lang.NullPointerException", count: 2 }],
    });
    const nulls = matches.find((entry) => entry.catalogId === "null-reference");
    expect(nulls?.occurrences).toBe(7);
    expect(nulls?.issueIds).toEqual(["a", "b"]);
  });

  it("ranks critical entries first", () => {
    const matches = matchCatalog({
      issues: [
        { id: "a", pattern: "legacy api deprecated", title: "deprecated", count: 900 },
        { id: "b", pattern: "deadlock detected", title: "deadlock", count: 1 },
      ],
      exceptionTypes: [],
    });
    expect(matches[0]?.severity).toBe("critical");
  });

  it("finds entries through exception types alone", () => {
    const matches = matchCatalog({
      issues: [{ id: "a", pattern: "failed", title: "failed", count: 1 }],
      exceptionTypes: [{ type: "java.util.concurrent.TimeoutException", count: 5 }],
    });
    expect(matches.map((entry) => entry.catalogId)).toContain("timeout");
  });

  it("can be resolved back to its directory entry", () => {
    const matches = matchCatalog({
      issues: [{ id: "a", pattern: "NullPointerException", title: "npe", count: 1 }],
      exceptionTypes: [],
    });
    expect(CATALOG_BY_ID.get(matches[0].catalogId)?.reasons.length).toBeGreaterThan(1);
  });
});