/**
 * Streaming aggregator.
 *
 * The aggregator never keeps the whole file in memory: it folds each parsed
 * line into counters, issue groups and bounded samples, which is what makes it
 * safe to run on multi-hundred-megabyte log files in a browser tab.
 */

import {
  DEFAULT_MAX_ISSUES,
  DEFAULT_MAX_SAMPLES,
  LOG_LEVELS,
  LEVEL_SEVERITY,
  type ExceptionInfo,
type HttpStats,
type IssueGroup,
type LogLevel,
  type LogReport,
  type ParsedLine,
  type PathStat,
  type SampleLine,
  type StackFrame,
  type StatusStat,
  type TimelineBucket,
} from "./types";
import { buildTitle, normalizeMessage } from "./normalize";
import { compactFrames, frameOwner, parseStackFrame } from "./stack";
import { extractTimestamp } from "./timestamps";
import { LatencyCollector } from "./latency";
import { collectSources } from "./parse";
import { matchCatalog } from "../error-catalog";

const MAX_FRAMES_PER_ISSUE = 24;
const MAX_SAMPLES_PER_ISSUE = 3;
const MAX_LOGGERS = 40;
const MAX_PATHS = 60;
const MAX_STATUSES = 20;
const MAX_SOURCES = 40;
const MAX_EXCEPTIONS = 60;

const BUCKET_SIZES = [
  1_000, 5_000, 10_000, 30_000,
  60_000, 300_000, 600_000, 900_000, 1_800_000,
  3_600_000, 10_800_000, 21_600_000, 43_200_000,
  86_400_000, 604_800_000,
];

export interface AggregatorOptions {
  maxSamples?: number;
  maxIssues?: number;
}

export class LogAggregator {
  private readonly maxSamples: number;
  private readonly maxIssues: number;

  readonly levels: Record<LogLevel, number> = {
    fatal: 0,
    error: 0,
    warn: 0,
    info: 0,
    debug: 0,
    trace: 0,
    unknown: 0,
  };

  lineCount = 0;
  parsedLines = 0;
  emptyLines = 0;
  unclassifiedLines = 0;
  continuationLines = 0;
  multiLineEntries = 0;

  private readonly issues = new Map<string, IssueGroup>();
  private readonly exceptionTypes = new Map<string, number>();
  private readonly loggerStats = new Map<string, { total: number; errors: number; warnings: number }>();
  private readonly sources = new Map<string, number>();
  private readonly timestamps: number[] = [];
  private readonly samples: SampleLine[] = [];
  /** Bounded reservoir of durations recovered from messages and HTTP lines. */
  private readonly latency = new LatencyCollector();

  // HTTP
  private httpTotal = 0;
  private httpErrors = 0;
  private readonly statuses = new Map<number, { count: number; errors: number }>();
  private readonly paths = new Map<string, { count: number; errors: number; totalMs: number; maxMs: number }>();
  private slowest?: { path: string; durationMs: number; index: number; raw: string };

  /** Stack trace currently being collected. */
  private open?: {
    key: string;
    frames: StackFrame[];
    exceptionType?: string;
    count: number;
    countedAsMultiLine: boolean;
  };

  constructor(options: AggregatorOptions = {}) {
    this.maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
    this.maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
  }

  add(line: ParsedLine): void {
    this.lineCount++;
    if (!line.raw.trim()) {
      this.emptyLines++;
      return;
    }

    if (line.isContinuation || this.looksLikeStackBody(line.raw)) {
      this.continuationLines++;
      this.addContinuation(line, parseStackFrame(line.raw));
      return;
    }

    this.parsedLines++;
    this.levels[line.level]++;
    if (line.level === "unknown") this.unclassifiedLines++;
    if (line.timestamp !== undefined) this.timestamps.push(line.timestamp);
    // A request line carries its response time in `http`, so it is counted
    // once from there instead of being scraped again out of the message.
    if (line.http?.durationMs !== undefined) {
      this.latency.addHttp(
        line.http.path,
        line.http.durationMs,
        line.http.status !== undefined,
        line.message,
      );
    } else {
      this.latency.addMessage(line.message);
    }

    const logger = line.logger ?? this.loggerFromMessage(line);
    this.trackLogger(logger, line.level);
    for (const source of collectSources(line.message, this.sources)) {
      void source; // counted in the map already
    }

    const http = line.http ?? this.httpFromMessage(line);
    if (http) this.trackHttp(line, http);

    const key = line.signature;
    const exceptionType = line.exception?.type;
    // Frames collected for the preceding entry (Python tracebacks, Java
    // `Caused by:` chains) belong to this exception as well.
    const inheritedFrames = exceptionType ? (this.open?.frames ?? []) : [];
    let group = this.issues.get(key);

    if (!group) {
      group = {
        id: key,
        level: line.level,
        title: buildTitle(line.message, exceptionType),
        pattern: normalizeMessage(line.message).slice(0, 240),
        count: 0,
        share: 0,
        firstIndex: line.index,
        lastIndex: line.index,
        loggers: [],
        exceptionType,
        frames: [],
        samples: [],
      };
      this.issues.set(key, group);
    }

    group.count++;
    group.lastIndex = line.index;
    if (line.timestamp !== undefined) {
      group.lastSeen = line.timestamp;
      if (group.firstSeen === undefined) group.firstSeen = line.timestamp;
    }
    if (line.level !== "unknown" && LEVEL_SEVERITY[line.level] > LEVEL_SEVERITY[group.level]) {
      group.level = line.level;
    }
    if (exceptionType && !group.exceptionType) group.exceptionType = exceptionType;
    if (logger && !group.loggers.includes(logger) && group.loggers.length < 5) {
      group.loggers.push(logger);
    }
    if (group.samples.length < MAX_SAMPLES_PER_ISSUE) {
      group.samples.push({ index: line.index, raw: truncate(line.raw, 400) });
    }

    if (exceptionType) {
      this.exceptionTypes.set(exceptionType, (this.exceptionTypes.get(exceptionType) ?? 0) + 1);
      for (const frame of inheritedFrames) this.noteFrameSource(frame);
      if (group.frames.length === 0 && inheritedFrames.length > 0) {
        group.frames = compactFrames([...inheritedFrames]).slice(0, MAX_FRAMES_PER_ISSUE);
      }
    }

    this.open = {
      key,
      frames: [],
      exceptionType,
      count: 1,
      countedAsMultiLine: false,
    };

    this.maybeSample(line);
  }

  /**
   * Indented lines that follow a stack frame belong to the trace being
   * collected (Python source lines, nested `Caused by:` bodies, and so on).
   */
  private looksLikeStackBody(raw: string): boolean {
    const open = this.open;
    if (!open || open.frames.length === 0) return false;
    if (!/^(\s{2,}|\t)/.test(raw)) return false;
    if (extractTimestamp(raw)) return false;
    if (parseStackFrame(raw)) return false;
    return true;
  }

  /** Fold a stack-trace continuation line into the entry that opened it. */
  private addContinuation(line: ParsedLine, frame: StackFrame | undefined): void {
    const open = this.open;
    const header = line.exception;
    this.noteFrameSource(frame);

    if (!open) {
      // Trace without a parent entry (e.g. the file starts mid-stack).
      this.parsedLines++;
      this.levels[line.level === "unknown" ? "error" : line.level]++;
      const level: LogLevel = line.level === "unknown" ? "error" : line.level;
      const key = line.signature;
      let group = this.issues.get(key);
      if (!group) {
        group = {
          id: key,
          level,
          title: buildTitle(line.message, header?.type),
          pattern: normalizeMessage(line.message).slice(0, 240),
          count: 0,
          share: 0,
          firstIndex: line.index,
          lastIndex: line.index,
          loggers: [],
          exceptionType: header?.type,
          frames: [],
          samples: [],
        };
        this.issues.set(key, group);
      }
      group.count++;
      group.lastIndex = line.index;
      if (frame) group.frames = compactFrames([...group.frames, frame]);
      this.open = {
        key,
        frames: frame ? [frame] : [],
        exceptionType: header?.type,
        count: 1,
        countedAsMultiLine: Boolean(frame),
      };
      return;
    }

    open.count++;
    if (frame) {
      open.frames.push(frame);
      if (open.frames.length > 200) open.frames.shift();
      const group = this.issues.get(open.key);
      if (group && group.frames.length < MAX_FRAMES_PER_ISSUE) {
        group.frames = compactFrames([...group.frames, frame]);
      }
      if (!open.countedAsMultiLine) {
        open.countedAsMultiLine = true;
        this.multiLineEntries++;
      }
    }
    if (header) {
      const group = this.issues.get(open.key);
      if (group) {
        group.exceptionType = group.exceptionType ?? header.type;
        if (!group.title.startsWith(header.type)) {
          group.title = buildTitle(`${group.title}`, header.type);
        }
      }
      if (!open.exceptionType) open.exceptionType = header.type;
      this.exceptionTypes.set(header.type, (this.exceptionTypes.get(header.type) ?? 0) + 1);
    }
  }

  private noteFrameSource(frame: StackFrame | undefined): void {
    if (!frame?.file || frame.line === undefined) return;
    const location = `${frame.file}:${frame.line}`;
    this.sources.set(location, (this.sources.get(location) ?? 0) + 1);
  }

  private maybeSample(line: ParsedLine): void {
    if (this.samples.length >= this.maxSamples) return;
    const interesting =
      LEVEL_SEVERITY[line.level] >= LEVEL_SEVERITY.warn || line.http?.status === 500;
    const keepFirst = this.samples.length < Math.min(this.maxSamples, 200);
    if (interesting || keepFirst) {
      this.samples.push({ index: line.index, raw: truncate(line.raw, 500), level: line.level });
    }
  }

  private trackLogger(logger: string | undefined, level: LogLevel): void {
    if (!logger) return;
    const stat = this.loggerStats.get(logger) ?? { total: 0, errors: 0, warnings: 0 };
    stat.total++;
    if (LEVEL_SEVERITY[level] >= LEVEL_SEVERITY.error) stat.errors++;
    if (level === "warn") stat.warnings++;
    this.loggerStats.set(logger, stat);
  }

  private loggerFromMessage(line: ParsedLine): string | undefined {
    if (line.exception?.type) return line.exception.type.split(".").slice(0, 3).join(".");
    return undefined;
  }

  private httpFromMessage(line: ParsedLine): ParsedLine["http"] {
    const match =
      /\b(?:status(?:Code)?[=: ]|HTTP\/\d\.\d"\s+|responded with )\s*([1-5]\d{2})\b/i.exec(line.message);
    if (!match) return undefined;
    const status = Number(match[1]);
    return { status };
  }

  private trackHttp(
    line: ParsedLine,
    http: NonNullable<ParsedLine["http"]>,
  ): void {
    if (http.status === undefined) return;
    this.httpTotal++;
    const failed = http.status >= 500;
    if (failed) this.httpErrors++;

    const statusStat = this.statuses.get(http.status) ?? { count: 0, errors: 0 };
    statusStat.count++;
    if (failed) statusStat.errors++;
    this.statuses.set(http.status, statusStat);

    if (http.path) {
      const pathStat = this.paths.get(http.path) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
      pathStat.count++;
      if (failed) pathStat.errors++;
      if (http.durationMs !== undefined && http.durationMs >= 0) {
        pathStat.totalMs += http.durationMs;
        pathStat.maxMs = Math.max(pathStat.maxMs, http.durationMs);
        if (!this.slowest || http.durationMs > this.slowest.durationMs) {
          this.slowest = { path: http.path, durationMs: http.durationMs, index: line.index, raw: truncate(line.raw, 300) };
        }
      }
      this.paths.set(http.path, pathStat);
    }
  }

  /** Issue groups sorted by severity, then by frequency. */
  topIssues(limit = this.maxIssues): IssueGroup[] {
    const total = this.parsedLines || 1;
    return [...this.issues.values()]
      .map((issue) => ({ ...issue, share: issue.count / total }))
      .sort(
        (a, b) =>
          LEVEL_SEVERITY[b.level] - LEVEL_SEVERITY[a.level] ||
          b.count - a.count ||
          a.title.localeCompare(b.title),
      )
      .slice(0, limit);
  }

  buildTimeline(): TimelineBucket[] {
    if (this.timestamps.length < 2) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const value of this.timestamps) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const span = max - min;
    if (span <= 0) return [];

    const target = 48;
    let size = BUCKET_SIZES[BUCKET_SIZES.length - 1];
    for (const candidate of BUCKET_SIZES) {
      if (span / candidate <= target) {
        size = candidate;
        break;
      }
    }

    const start = Math.floor(min / size) * size;
    const bucketCount = Math.min(Math.ceil((max - start) / size) + 1, 500);
    const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
      t: start + index * size,
      total: 0,
      error: 0,
      warn: 0,
      info: 0,
      other: 0,
    }));

    for (const value of this.timestamps) {
      const index = Math.min(
        buckets.length - 1,
        Math.max(0, Math.floor((value - start) / size)),
      );
      const bucket = buckets[index];
      bucket.total++;
    }

    return buckets;
  }

  private buildTimeRange() {
    if (this.timestamps.length === 0) return undefined;
    let min = Infinity;
    let max = -Infinity;
    let outOfOrder = false;
    let previous: number | undefined;
    for (const value of this.timestamps) {
      if (previous !== undefined && value < previous) outOfOrder = true;
      previous = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    return { start: min, end: max, durationMs: max - min, outOfOrder };
  }

  private buildHttpStats(): HttpStats | undefined {
    if (this.httpTotal === 0) return undefined;
    const classes = new Map<string, number>();
    for (const [status, stat] of this.statuses) {
      const key = `${Math.floor(status / 100)}xx`;
      classes.set(key, (classes.get(key) ?? 0) + stat.count);
    }
    const statuses: StatusStat[] = [...this.statuses.entries()]
      .map(([status, stat]) => ({ status, count: stat.count, errors: stat.errors }))
      .sort((a, b) => b.status - a.status);

    const paths: PathStat[] = [...this.paths.entries()]
      .map(([path, stat]) => ({
        path,
        count: stat.count,
        errors: stat.errors,
        avgDurationMs: stat.totalMs > 0 ? stat.totalMs / stat.count : undefined,
        maxDurationMs: stat.maxMs > 0 ? stat.maxMs : undefined,
      }))
      .sort((a, b) => b.errors - a.errors || b.count - a.count)
      .slice(0, MAX_PATHS);

    return {
      total: this.httpTotal,
      classes: [...classes.entries()]
        .map(([className, count]) => ({ class: className, count }))
        .sort((a, b) => a.class.localeCompare(b.class)),
      statuses: statuses.slice(0, MAX_STATUSES),
      paths,
      errorRate: this.httpErrors / this.httpTotal,
      slowest: this.slowest,
    };
  }

  /** 0..100 health score derived from the severity mix. */
  healthScore(): number {
    const total = this.parsedLines || 1;
    const errors = (this.levels.error + this.levels.fatal) / total;
    const warnings = this.levels.warn / total;
    const unknown = this.levels.unknown / total;
    let score = 100;
    score -= Math.min(65, errors * 420);
    score -= Math.min(20, warnings * 120);
    score -= Math.min(15, unknown * 60);
    if (this.levels.fatal > 0) score -= 10;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  toReport(base: {
    fileName: string;
    sizeBytes: number;
    format: LogReport["format"];
    formatConfidence: number;
    formatNotes: string[];
    analyzedAt: number;
    insights: LogReport["insights"];
    recommendations: string[];
  }): LogReport {
    const timeRange = this.buildTimeRange();
    const parsed = this.parsedLines || 1;
    const errors = this.levels.error + this.levels.fatal;

    return {
      version: 1,
      fileName: base.fileName,
      sizeBytes: base.sizeBytes,
      format: base.format,
      formatConfidence: base.formatConfidence,
      formatNotes: base.formatNotes,
      lineCount: this.lineCount,
      parsedLines: this.parsedLines,
      emptyLines: this.emptyLines,
      unclassifiedLines: this.unclassifiedLines,
      multiLineEntries: this.multiLineEntries,
      levels: { ...this.levels },
      errorRate: errors / parsed,
      warningRate: this.levels.warn / parsed,
      issues: this.topIssues(),
      latency: this.latency.build(),
      checks: [],
      knownProblems: matchCatalog({
        issues: this.topIssues(),
        exceptionTypes: [...this.exceptionTypes.entries()].map(([type, count]) => ({ type, count })),
        extraText: base.fileName,
      }),
      exceptionTypes: [...this.exceptionTypes.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_EXCEPTIONS),
      loggers: [...this.loggerStats.entries()]
        .map(([logger, stat]) => ({ logger, ...stat }))
        .sort((a, b) => b.errors - a.errors || b.total - a.total)
        .slice(0, MAX_LOGGERS),
      sources: [...this.sources.entries()]
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_SOURCES),
      timeline: this.buildTimeline(),
      timeRange,
      http: this.buildHttpStats(),
      insights: base.insights,
      recommendations: base.recommendations,
      samples: this.samples,
      sampledLines: this.samples.length,
      throughputPerSecond:
        timeRange && timeRange.durationMs > 0
          ? this.parsedLines / (timeRange.durationMs / 1000)
          : undefined,
      healthScore: this.healthScore(),
      analyzedAt: base.analyzedAt,
    };
  }

  /** Snapshot of the counters used to build insights after the full pass. */
  snapshot() {
    return {
      levels: { ...this.levels },
      parsedLines: this.parsedLines,
      issues: this.topIssues(this.maxIssues),
      exceptionTypes: [...this.exceptionTypes.entries()].map(([type, count]) => ({ type, count })),
      loggers: [...this.loggerStats.entries()].map(([logger, stat]) => ({ logger, ...stat })),
      sources: [...this.sources.entries()].map(([location, count]) => ({ location, count })),
      http: this.buildHttpStats(),
      latency: this.latency.build(),
      timeRange: this.buildTimeRange(),
    };
  }
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function countLevels(report: LogReport): { level: LogLevel; count: number }[] {
  return LOG_LEVELS.map((level) => ({ level, count: report.levels[level] }));
}

export function topFrameOwner(issue: IssueGroup): string | undefined {
  return issue.frames.length > 0 ? frameOwner(issue.frames[0]) : undefined;
}

export type { ExceptionInfo };