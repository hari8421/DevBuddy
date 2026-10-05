/**
 * LogLens analysis engine — public entry point.
 *
 * `analyzeLog` takes the raw text of a log file and returns a complete report.
 * It is pure TypeScript with no platform dependencies, so it runs unchanged in
 * the browser, in a Web Worker and in Node.js.
 */

import { detectFormat } from "./detect";
import { parseLine } from "./parse";
import { LogAggregator } from "./aggregate";
import { buildInsights } from "./insights";
import { runChecks } from "./checks";
import type { AnalyzeOptions, LogReport } from "./types";

export * from "./types";
export { detectFormat } from "./detect";
export { buildSignature, normalizeMessage } from "./normalize";
export { extractTimestamp, formatBytes, formatDuration, formatTime } from "./timestamps";
export { parseLine } from "./parse";
export { runChecks, CHECK_GROUP_LABEL, CHECK_COUNT } from "./checks";
export {
  extractDuration,
  LatencyCollector,
  latencyFindings,
  percentile,
  toMs,
  LATENCY_BUDGET_MS,
  LATENCY_SEVERE_MS,
} from "./latency";

const DETECTION_SAMPLE_LINES = 400;
const PROGRESS_INTERVAL = 2000;

/** Let the browser paint between chunks so big files do not freeze the tab. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * End offset of the line spanning `[start, hardEnd)`. A `\r` is only part of
 * the separator when the line is actually terminated by `\n` — a lone `\r`
 * at the end of the file is content, exactly as with a `/\r?\n/` split.
 */
function lineEnd(text: string, start: number, hardEnd: number, newlineTerminated: boolean): number {
  if (newlineTerminated && hardEnd > start && text.charCodeAt(hardEnd - 1) === 13) {
    return hardEnd - 1;
  }
  return hardEnd;
}

export async function analyzeLog(
  text: string,
  options: AnalyzeOptions = {},
): Promise<LogReport> {
  const fileName = options.fileName ?? "log.txt";
  const sizeBytes = options.sizeBytes ?? new Blob([text]).size;

  const startedAt = Date.now();

  // Detection reads a sample of the file, not the whole thing. The sample is
  // scanned straight off the string so that a 200 MB file is never cut into
  // a full array of line strings first.
  const sample: string[] = [];
  for (let pos = 0; pos < text.length && sample.length < DETECTION_SAMPLE_LINES; ) {
    const nl = text.indexOf("\n", pos);
    const hardEnd = nl === -1 ? text.length : nl;
    const line = text.slice(pos, lineEnd(text, pos, hardEnd, nl !== -1));
    if (line.trim()) sample.push(line);
    if (nl === -1) break;
    pos = nl + 1;
  }
  const detection = detectFormat(sample);

  const aggregator = new LogAggregator({
    maxSamples: options.maxSamples,
    maxIssues: options.maxIssues,
  });

  // Lines are sliced off one at a time with the same trailing-newline rules a
  // `/\r?\n/` split would follow, so peak memory is the file text plus one
  // line instead of the file text plus every line.
  const len = text.length;
  const progressTotal = Math.max(1, len);
  let lineIndex = 0;
  for (let pos = 0; pos < len || lineIndex === 0; ) {
    const nl = text.indexOf("\n", pos);
    const hardEnd = nl === -1 ? len : nl;
    const line = text.slice(pos, lineEnd(text, pos, hardEnd, nl !== -1));
    aggregator.add(parseLine(line, lineIndex, detection.format, detection));
    lineIndex += 1;

    if (options.onProgress && lineIndex % PROGRESS_INTERVAL === 0) {
      options.onProgress({
        linesRead: lineIndex,
        percent: Math.min(100, Math.round((pos / progressTotal) * 100)),
      });
      await yieldToUi();
    }

    if (nl === -1) break;
    pos = nl + 1;
  }

  const snapshot = aggregator.snapshot();
  const { insights, recommendations } = buildInsights({
    issues: snapshot.issues,
    exceptionTypes: snapshot.exceptionTypes,
    http: snapshot.http,
    latency: snapshot.latency,
    timeRange: snapshot.timeRange,
    healthScore: aggregator.healthScore(),
    levels: snapshot.levels,
  });

  const report = aggregator.toReport({
    fileName,
    sizeBytes,
    format: detection.format,
    formatConfidence: detection.confidence,
    formatNotes: [
      ...detection.notes,
      `Parsed in ${Math.max(1, Date.now() - startedAt)}ms`,
    ],
    analyzedAt: Date.now(),
    insights,
    recommendations,
  });

  options.onProgress?.({ linesRead: lineIndex, percent: 100 });
  // Checks run last: they read the finished report (level mix, timeline,
  // latency percentiles), so they can only run once everything is aggregated.
  report.checks = runChecks(report);
  return report;
}

/** Analyze several files, returning one report per file. */
export async function analyzeLogs(
  files: { name: string; text: string }[],
  options: Omit<AnalyzeOptions, "fileName" | "sizeBytes"> = {},
): Promise<LogReport[]> {
  const reports: LogReport[] = [];
  for (const file of files) {
    reports.push(
      await analyzeLog(file.text, {
        ...options,
        fileName: file.name,
        sizeBytes: new Blob([file.text]).size,
      }),
    );
  }
  return reports;
}