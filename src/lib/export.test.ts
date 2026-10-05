import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXPORT_FORMATS,
  catalogToCsv,
  catalogToJson,
  exportFileName,
  reportToCsv,
  reportToHtml,
  reportToJson,
  reportToMarkdown,
  reportToSummary,
  serializeReport,
} from "./export";
import { ERROR_CATALOG } from "./error-catalog";
import { analyzeLog } from "./analyzer";

const SAMPLE = readFileSync(
  join(process.cwd(), "public", "samples", "orders-service.log"),
  "utf8",
);

let cached: Awaited<ReturnType<typeof analyzeLog>> | undefined;
async function report() {
  cached ??= await analyzeLog(SAMPLE, { fileName: "orders-service.log" });
  return cached;
}

describe("reportToJson", () => {
  it("round-trips the report object", async () => {
    const original = await report();
    expect(JSON.parse(reportToJson(original))).toEqual(JSON.parse(JSON.stringify(original)));
  });
});

describe("reportToCsv", () => {
  it("writes a header row and one row per grouped issue", async () => {
    const original = await report();
    const rows = reportToCsv(original).trim().split("\n");
    expect(rows[0]).toContain("level");
    expect(rows[0]).toContain("directory_entry");
    expect(rows.length).toBe(original.issues.length + 1);
  });

  it("quotes values that contain a comma", async () => {
    const original = await report();
    // Message titles and samples routinely contain commas, so they must be
    // quoted rather than breaking the column alignment.
    expect(reportToCsv(original)).toContain('"');
  });
});

describe("reportToMarkdown", () => {
  it("includes the summary, findings, directory matches and latency", async () => {
    const original = await report();
    const markdown = reportToMarkdown(original);

    expect(markdown).toContain("# LogLens report — orders-service.log");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Latency");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("## Error directory matches");
    expect(markdown).toContain("## Diagnostic checks");
    expect(markdown).toContain("p95");
    // The directory entry resolved from the report is expanded with its fixes.
    expect(markdown).toContain("How to fix it");
  });
});

describe("reportToHtml", () => {
  it("is a self-contained page with escaped content", async () => {
    const original = await report();
    const html = reportToHtml(original);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).toContain("orders-service.log");
    // The whole document must be one page with no external requests.
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/src=/);
  });

  it("escapes markup that came from the log", async () => {
    const original = await analyzeLog(
      '2024-05-01 10:00:00,000 ERROR [main] a - Failed: <img src=x onerror=alert(1)>\n',
      { fileName: "xss.log" },
    );
    const html = reportToHtml(original);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("serializeReport", () => {
  it("supports every advertised format", async () => {
    const original = await report();
    for (const format of EXPORT_FORMATS) {
      const content = serializeReport(original, format.id);
      expect(content.length).toBeGreaterThan(100);
      expect(format.extension.length).toBeGreaterThan(0);
    }
  });

  it("names the download after the file", async () => {
    const original = await report();
    expect(exportFileName(original, "markdown")).toBe("orders-service.report.md");
    expect(exportFileName(original, "json")).toBe("orders-service.report.json");
    expect(exportFileName(original, "html")).toBe("orders-service.report.html");
  });
});

describe("reportToSummary", () => {
  it("fits on a handful of lines", async () => {
    const summary = reportToSummary(await report());
    const lines = summary.split("\n");
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(summary).toContain("orders-service.log");
    expect(summary).toContain("health");
  });
});

describe("catalog exports", () => {
  it("writes every entry as CSV with its reasons and fixes", () => {
    const csv = catalogToCsv();
    const rows = csv.trim().split("\n");
    expect(rows.length).toBe(ERROR_CATALOG.length + 1);
    expect(csv).toContain("Null / undefined dereference");
    expect(csv).toContain("reasons");
    expect(csv).toContain("fixes");
  });

  it("writes every entry as JSON with resolved category labels", () => {
    const parsed = JSON.parse(catalogToJson());
    expect(parsed.length).toBe(ERROR_CATALOG.length);
    expect(parsed[0]).toHaveProperty("categoryLabel");
    expect(parsed[0]).toHaveProperty("patterns");
  });
});