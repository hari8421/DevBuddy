// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  copyText,
  downloadCatalog,
  downloadReport,
  downloadText,
} from "./export";
import { analyzeLog } from "./analyzer";

const SAMPLE = readFileSync(
  join(process.cwd(), "public", "samples", "orders-service.log"),
  "utf8",
);

let downloads: string[] = [];
const blobs: Blob[] = [];

beforeEach(() => {
  downloads = [];
  blobs.length = 0;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  const create = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:stub";
  });
  Object.defineProperty(window.URL, "createObjectURL", {
    value: create,
    writable: true,
  });
  Object.defineProperty(window.URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadReport", () => {
  it("saves each format under a descriptive file name", async () => {
    const report = await analyzeLog(SAMPLE, { fileName: "orders-service.log" });

    expect(downloadReport(report, "json")).toBe("orders-service.report.json");
    expect(downloadReport(report, "csv")).toBe("orders-service.issues.csv");
    expect(downloadReport(report, "markdown")).toBe("orders-service.report.md");
    expect(downloadReport(report, "html")).toBe("orders-service.report.html");

    expect(downloads).toEqual([
      "orders-service.report.json",
      "orders-service.issues.csv",
      "orders-service.report.md",
      "orders-service.report.html",
    ]);
  });

  it("strips the original extension from the download name", async () => {
    const report = await analyzeLog(SAMPLE, { fileName: "access.log.gz" });
    expect(downloadReport(report, "markdown")).toBe("access.log.report.md");
  });

  it("writes real content into the blob", async () => {
    const report = await analyzeLog(SAMPLE, { fileName: "orders-service.log" });
    downloadReport(report, "markdown");
    const text = await blobs[0].text();
    expect(text).toContain("# LogLens report");
  });
});

describe("downloadCatalog", () => {
  it("saves the error directory as CSV or JSON", () => {
    expect(downloadCatalog("csv")).toBe("loglens-error-directory.csv");
    expect(downloadCatalog("json")).toBe("loglens-error-directory.json");
    expect(downloads).toHaveLength(2);
  });
});

describe("downloadText", () => {
  it("creates and releases an object url", () => {
    const revoke = vi.fn();
    Object.defineProperty(window.URL, "revokeObjectURL", {
      value: revoke,
      writable: true,
    });
    vi.useFakeTimers();
    downloadText("notes.txt", "hello", "text/plain");
    expect(downloads).toEqual(["notes.txt"]);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:stub");
    vi.useRealTimers();
  });
});

describe("copyText", () => {
  it("uses the clipboard when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    await expect(copyText("payload")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("payload");
  });

  it("falls back to a hidden textarea when the clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      writable: true,
      configurable: true,
    });
    await expect(copyText("payload")).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});