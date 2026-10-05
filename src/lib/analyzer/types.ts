/**
 * Core data model shared by the LogLens analysis engine and the UI.
 *
 * The engine is dependency free and side effect free so the exact same code can
 * run in the browser, in a Web Worker, or in Node.js (unit tests / CLI).
 */

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "unknown",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Severity ranking, higher means more severe. */
export const LEVEL_SEVERITY: Record<LogLevel, number> = {
  fatal: 6,
  error: 5,
  warn: 4,
  info: 3,
  debug: 2,
  trace: 1,
  unknown: 0,
};

export const LEVEL_LABEL: Record<LogLevel, string> = {
  fatal: "Fatal",
  error: "Error",
  warn: "Warning",
  info: "Info",
  debug: "Debug",
  trace: "Trace",
  unknown: "Unclassified",
};

/** Tailwind class fragments used to colour levels consistently across the UI. */
export const LEVEL_COLOR: Record<LogLevel, string> = {
  fatal: "text-severity-fatal",
  error: "text-severity-error",
  warn: "text-severity-warn",
  info: "text-severity-info",
  debug: "text-severity-debug",
  trace: "text-severity-trace",
  unknown: "text-muted-foreground",
};

export const LEVEL_BG: Record<LogLevel, string> = {
  fatal: "bg-severity-fatal",
  error: "bg-severity-error",
  warn: "bg-severity-warn",
  info: "bg-severity-info",
  debug: "bg-severity-debug",
  trace: "bg-severity-trace",
  unknown: "bg-muted-foreground",
};

export type LogFormat =
  | "json"
  | "apache"
  | "syslog"
  | "text"
  | "generic";

export const FORMAT_LABEL: Record<LogFormat, string> = {
  json: "JSON / JSON Lines",
  apache: "Apache / Nginx access log",
  syslog: "Syslog",
  text: "Delimited text",
  generic: "Generic plain text",
};

export interface StackFrame {
  /** Fully qualified function name when it could be recovered. */
  functionName?: string;
  /** Source file the frame points at. */
  file?: string;
  /** 1-based line number inside `file`. */
  line?: number;
  /** The frame exactly as it appeared in the log. */
  raw: string;
}

export interface HttpEntry {
  method?: string;
  path?: string;
  status?: number;
  bytes?: number;
  ip?: string;
  referer?: string;
  userAgent?: string;
  /** Response time in milliseconds, when the log format carries it. */
  durationMs?: number;
}

export interface ExceptionInfo {
  /** Exception/error class name, e.g. `java.lang.NullPointerException`. */
  type: string;
  message: string;
  /**
   * Frames collected for this exception. The aggregator fills them in as it
   * reads the continuation lines, so this is usually empty here.
   */
  frames?: StackFrame[];
  /** True for `panic:`, `fatal error:` and process-level aborts. */
  fatal: boolean;
}

/** A single parsed log line. */
export interface ParsedLine {
  /** 0-based index of the line inside the file. */
  index: number;
  raw: string;
  level: LogLevel;
  message: string;
  timestamp?: number;
  timestampRaw?: string;
  logger?: string;
  thread?: string;
  http?: HttpEntry;
  exception?: ExceptionInfo;
  /** True when the line is part of a stack trace / multi-line message. */
  isContinuation: boolean;
  /** Stable grouping key (see `normalize.ts`). */
  signature: string;
}

export interface IssueGroup {
  id: string;
  level: LogLevel;
  title: string;
  /** Normalised, variable-free version of the message. */
  pattern: string;
  count: number;
  /** Share of all parsed lines, 0..1. */
  share: number;
  firstIndex: number;
  lastIndex: number;
  firstSeen?: number;
  lastSeen?: number;
  loggers: string[];
  exceptionType?: string;
  frames: StackFrame[];
  samples: { index: number; raw: string }[];
}

export interface LoggerStat {
  logger: string;
  total: number;
  errors: number;
  warnings: number;
}

export interface SourceStat {
  location: string;
  count: number;
}

export interface TimelineBucket {
  /** Bucket start, epoch milliseconds. */
  t: number;
  total: number;
  error: number;
  warn: number;
  info: number;
  other: number;
}

export interface StatusStat {
  status: number;
  count: number;
  errors: number;
}

export interface PathStat {
  path: string;
  count: number;
  errors: number;
  avgDurationMs?: number;
  maxDurationMs?: number;
}

export interface HttpStats {
  total: number;
  classes: { class: string; count: number }[];
  statuses: StatusStat[];
  paths: PathStat[];
  errorRate: number;
  slowest?: { path: string; durationMs: number; index: number; raw: string };
}

/** Per-operation latency breakdown, ranked by p95. */
export interface LatencyOperation {
  /** Operation name: the message prefix, a quoted label or the HTTP path. */
  name: string;
  samples: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** Samples slower than the 1s budget. */
  overBudget: number;
}

/** Timing information recovered from the log, in milliseconds. */
export interface LatencyStats {
  /** Number of timings found (HTTP response times included). */
  samples: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  /** Timings slower than 1s. */
  overBudget: number;
  /** Timings slower than 5s. */
  severe: number;
  overBudgetRate: number;
  operations: LatencyOperation[];
  /** Parsed lines that carried no duration. */
  linesWithoutTiming: number;
  http?: {
    samples: number;
    requests: number;
    /** Share of HTTP lines that carried a response time, 0..1. */
    coverage: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
}

/**
 * A single automated diagnostic run against the finished report.
 *
 * Every check is always evaluated, so a clean file produces `pass` rows. That
 * makes the section an audit trail: it shows what LogLens looked for, not only
 * what it happened to find.
 */
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";

/** Diagnostic area a check belongs to, used to group them in the report. */
export type CheckGroup =
  | "availability"
  | "resources"
  | "concurrency"
  | "latency"
  | "throughput"
  | "data"
  | "security"
  | "configuration"
  | "observability";

export interface DiagnosticCheck {
  id: string;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  detail: string;
  /** Supporting line or number, when one exists. */
  evidence?: string;
}

export type InsightSeverity = "critical" | "warning" | "info";

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  occurrences: number;
  /** Concrete next step for the developer. */
  recommendation: string;
  /** Example line from the log. */
  example?: string;
}

/** Lines kept around for the raw viewer / report samples. */
export interface SampleLine {
  index: number;
  raw: string;
  level: LogLevel;
}

/**
 * A hit from the error directory (see `src/lib/error-catalog.ts`). Only the
 * identity and the counts are stored in the report; reasons and fixes are
 * resolved from the directory when the report is displayed, so a report stays
 * small and always shows the latest wording of an entry.
 */
export interface KnownProblemMatch {
  catalogId: string;
  title: string;
  category: string;
  severity: "critical" | "warning" | "info";
  occurrences: number;
  /** Grouped-issue ids that produced the match. */
  issueIds: string[];
  example?: string;
}

export interface TimeRange {
  start: number;
  end: number;
  durationMs: number;
  /** True when timestamps were missing or went backwards in the file. */
  outOfOrder: boolean;
}

export interface LogReport {
  version: 1;
  fileName: string;
  sizeBytes: number;
  format: LogFormat;
  formatConfidence: number;
  formatNotes: string[];
  lineCount: number;
  parsedLines: number;
  emptyLines: number;
  unclassifiedLines: number;
  multiLineEntries: number;
  levels: Record<LogLevel, number>;
  errorRate: number;
  warningRate: number;
  /** Distinct grouped problems, sorted by count. */
  issues: IssueGroup[];
  /** Entries from the error directory that matched this file. */
  knownProblems: KnownProblemMatch[];
  /** Timing statistics, when the file carried any durations. */
  latency?: LatencyStats;
  /** Every automated diagnostic that ran against this file. */
  checks: DiagnosticCheck[];
  exceptionTypes: { type: string; count: number }[];
  loggers: LoggerStat[];
  sources: SourceStat[];
  timeline: TimelineBucket[];
  timeRange?: TimeRange;
  http?: HttpStats;
  insights: Insight[];
  recommendations: string[];
  samples: SampleLine[];
  /** Number of lines sampled for `samples` (the file may be much bigger). */
  sampledLines: number;
  /** Lines per second over the observed time range, when timestamps exist. */
  throughputPerSecond?: number;
  healthScore: number;
  analyzedAt: number;
}

export interface AnalyzeOptions {
  fileName?: string;
  sizeBytes?: number;
  /** Cap on how many raw lines are retained for the viewer. */
  maxSamples?: number;
  /** Cap on how many issue groups are returned. */
  maxIssues?: number;
  /** Called roughly every few thousand lines while parsing. */
  onProgress?: (progress: { linesRead: number; percent: number }) => void;
}

export const DEFAULT_MAX_SAMPLES = 2000;
export const DEFAULT_MAX_ISSUES = 60;