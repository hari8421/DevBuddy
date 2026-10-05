// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { analyzeLog } from "@/lib/analyzer";
import { CATALOG_BY_ID } from "@/lib/error-catalog";
import { ReportView } from "@/components/report/ReportView";

/**
 * End-to-end-ish check of the user-facing behaviour: take a real bundled log,
 * run the engine over it, render the report and assert that the numbers a
 * developer would act on actually appear on screen.
 */
const SAMPLES = [
  "orders-service.log",
  "checkout-api.jsonl",
  "nginx-access.log",
  "system.log",
];

function readSample(name: string): string {
  return readFileSync(join(process.cwd(), "public", "samples", name), "utf8");
}

/** The report links to the error directory, so it needs a router. */
function renderReport(report: Awaited<ReturnType<typeof analyzeLog>>) {
  return render(
    <MemoryRouter>
      <ReportView report={report} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("ReportView", () => {
  it("renders a Java service log with grouped errors and insights", async () => {
    const report = await analyzeLog(readSample("orders-service.log"), {
      fileName: "orders-service.log",
    });

    const { container } = renderReport(report);

    expect(screen.getByText("orders-service.log")).toBeTruthy();
    expect(screen.getByText(/Grouped issues/)).toBeTruthy();
    expect(screen.getByText(/Insights/)).toBeTruthy();
    expect(screen.getByText(/Null \/ undefined dereferences/)).toBeTruthy();
    expect(screen.getAllByText(/Timeouts and deadline overruns/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("java.lang.NullPointerException");
    expect(container.textContent).toContain("OrderService.java:88");
    // Request lines (`GET /api/orders/1 -> 200 (12ms)`) are recovered, so both
    // the HTTP panel and the latency percentiles are populated.
    expect(screen.getByText("HTTP traffic")).toBeTruthy();
    expect(screen.getAllByText(/^Latency$/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("p95");
    expect(container.textContent).toContain("timings recovered from the file");
  });

  it("renders an access log with an HTTP panel", async () => {
    const report = await analyzeLog(readSample("nginx-access.log"), {
      fileName: "nginx-access.log",
    });

    const { container } = renderReport(report);

    expect(screen.getByText("HTTP traffic")).toBeTruthy();
    expect(container.textContent).toContain("/api/orders/:id");
    expect(container.textContent).toContain("/api/reports/monthly");
    expect(screen.getAllByText(/Server-side HTTP failures/).length).toBeGreaterThan(0);
  });

  it("renders JSON lines with nested stacks and a memory insight", async () => {
    const report = await analyzeLog(readSample("checkout-api.jsonl"), {
      fileName: "checkout-api.jsonl",
    });

    const { container } = renderReport(report);

    expect(screen.getByText("JSON / JSON Lines")).toBeTruthy();
    expect(screen.getAllByText(/Memory exhaustion/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("ETIMEDOUT");
    expect(container.textContent).toContain("src/payments/client.ts:112");
  });

  it("renders a syslog with OOM, auth and database findings", async () => {
    const report = await analyzeLog(readSample("system.log"), {
      fileName: "system.log",
    });

    const { container } = renderReport(report);

    expect(screen.getByText("Syslog")).toBeTruthy();
    expect(screen.getAllByText(/Memory exhaustion/).length).toBeGreaterThan(0);
    expect(container.textContent).toContain("password authentication failed");
  });

  it("adds error-directory entries with their causes and fixes to the report", async () => {
    const report = await analyzeLog(readSample("orders-service.log"), {
      fileName: "orders-service.log",
    });
    const { container } = renderReport(report);

    // The section lists the directory entries this file matched.
    expect(screen.getByText(/Known problems \(\d+\)/)).toBeTruthy();
    expect(container.textContent).toContain("Null / undefined dereference");

    const nulls = report.knownProblems.find((match) => match.catalogId === "null-reference")!;
    expect(nulls.occurrences).toBeGreaterThan(0);

    // Expanding an entry reveals the directory's reasons and fixes.
    const other =
      report.knownProblems.find((match) => match.catalogId !== report.knownProblems[0].catalogId)!;
    const entry = CATALOG_BY_ID.get(other.catalogId)!;
    fireEvent.click(screen.getAllByText(entry.title)[0]);

    expect(screen.getByText("Why it happens")).toBeTruthy();
    expect(screen.getByText("How to fix it")).toBeTruthy();
    expect(screen.getByText(entry.fixes[0])).toBeTruthy();
    // Every reason of the entry is listed in the expanded panel.
    for (const reason of entry.reasons) {
      expect(screen.getAllByText(reason).length).toBeGreaterThan(0);
    }
  });

  it("shows the automated diagnostic checks and can list all of them", async () => {
    const report = await analyzeLog(readSample("orders-service.log"), {
      fileName: "orders-service.log",
    });
    renderReport(report);

    expect(
      screen.getByText(`Diagnostic checks (${report.checks.length})`),
    ).toBeTruthy();

    // Problems are listed by default: this sample has a 50%+ error rate.
    expect(screen.getByText("Overall error rate")).toBeTruthy();

    // Checks that passed are hidden until they are asked for, which is what
    // makes the section an audit trail rather than a list of complaints.
    const passed = report.checks.find((check) => check.status === "pass");
    expect(passed).toBeDefined();
    expect(screen.queryByText(passed!.title)).toBeNull();

    fireEvent.click(screen.getByText("Show every check"));

    expect(screen.getByText(passed!.title)).toBeTruthy();
    expect(screen.getByText("Timestamp coverage")).toBeTruthy();
    expect(screen.getByText("Show problems only")).toBeTruthy();
  });

  it("never throws on an empty file", async () => {
    const report = await analyzeLog("", { fileName: "empty.log" });
    renderReport(report);
    expect(screen.getByText("empty.log")).toBeTruthy();
  });

  it.each(SAMPLES)("produces a usable report for %s", async (name) => {
    const report = await analyzeLog(readSample(name), { fileName: name });
    expect(report.parsedLines).toBeGreaterThan(0);
    expect(report.format).not.toBe("generic");
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });
});
