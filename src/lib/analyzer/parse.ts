/**
 * Line level parsing.
 *
 * One entry per non-empty line of the file. The parser is stateless: multi-line
 * entries (stack traces) are stitched together by the aggregator, which knows
 * which error line a continuation belongs to.
 */

import type { LogFormat, LogLevel, ParsedLine, SourceStat } from "./types";
import { detectLevel, inferLevelFromContent, levelFromHttpStatus } from "./levels";
import { extractTimestamp } from "./timestamps";
import { toMs } from "./latency";
import { buildSignature } from "./normalize";
import {
  APACHE_PATTERN,
  type FormatDetection,
} from "./detect";
import {
  isContinuationLine,
  parseExceptionHeader,
} from "./stack";

const LOGO_RE =
  /(^|\s)((?:[a-z0-9_]+\.){1,6}[A-Z][\w$]*(?:\.[\w$]+)*|\[[^\]]{2,60}\])\s*(?:[-:|]\s*)?/;

/** Replace volatile path segments so `/users/12/orders` and `/users/87/orders` group. */
export function normalizePath(path: string): string {
  return path
    .replace(/[?#].*$/, "")
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ":uuid";
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ":hash";
      if (segment.length > 24 && /\d/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

const SOURCE_REF_PATTERNS = [
  /\b((?:[\w.-]+\/)+[\w.-]+\.\w{1,5}):(\d+)(?::(\d+))?/g,
  /\b([A-Za-z]:\\[^\s:]+|[^\s:]+\.(?:java|kt|py|go|cs|js|jsx|ts|tsx|rb|php|c|h|cc|cpp|cs|rs|scala)):(\d+)(?::(\d+))?/g,
];

export function extractSourceRefs(text: string, limit = 3): string[] {
  const found: string[] = [];
  for (const pattern of SOURCE_REF_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match && found.length < limit) {
      const file = match[1];
      const line = match[2];
      if (!found.some((f) => f.startsWith(`${file}:`))) {
        found.push(`${file}:${line}`);
      }
      match = pattern.exec(text);
    }
    if (found.length >= limit) break;
  }
  return found;
}

function fromJson(record: Record<string, unknown>): {
  level?: LogLevel;
  message?: string;
  timestamp?: number;
  timestampRaw?: string;
  logger?: string;
  thread?: string;
  exceptionMessage?: string;
  http?: ParsedLine["http"];
  sources: string[];
} {
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
  };

  const levelRaw = pick("level", "severity", "lvl", "levelname", "severity_text", "log.level", "@level");
  const messageRaw = pick("message", "msg", "log", "@message", "short_message", "event", "description", "error");
  const timeRaw = pick("timestamp", "time", "ts", "@timestamp", "date", "eventTime", "asctime");
  const loggerRaw = pick("logger", "logger_name", "source", "service", "component", "channel", "name", "log.logger");
  const threadRaw = pick("thread", "thread_name", "threadName", "tid", "threadId");

  let level: LogLevel | undefined;
  if (typeof levelRaw === "string") {
    const detected = detectLevel(levelRaw, 40);
    level = detected?.level;
  } else if (typeof levelRaw === "number") {
    // syslog severity numbers
    level =
      levelRaw <= 2 ? "fatal" : levelRaw <= 3 ? "error" : levelRaw <= 4 ? "warn" : levelRaw <= 6 ? "info" : "debug";
  }

  let timestamp: number | undefined;
  let timestampRaw: string | undefined;
  if (typeof timeRaw === "number") {
    timestamp = timeRaw > 1e12 ? timeRaw : timeRaw * 1000;
    timestampRaw = new Date(timestamp).toISOString();
  } else if (typeof timeRaw === "string") {
    timestampRaw = timeRaw;
    const parsed = Date.parse(timeRaw);
    if (!Number.isNaN(parsed)) timestamp = parsed;
    else {
      const nested = extractTimestamp(timeRaw);
      if (nested) timestamp = nested.value;
    }
  }

  let exceptionMessage: string | undefined;
  const errorObj = pick("error", "err", "exception", "errorObject");
  if (typeof errorObj === "string") {
    exceptionMessage = errorObj;
  } else if (errorObj && typeof errorObj === "object") {
    const record2 = errorObj as Record<string, unknown>;
    const stack = record2.stack;
    const name = record2.name ?? record2.type ?? record2.class;
    const msg = record2.message;
    if (typeof stack === "string") {
      exceptionMessage = `${name ? `${String(name)}: ` : ""}${stack}`;
    } else if (name || msg) {
      exceptionMessage = `${name ? `${String(name)}: ` : ""}${msg ? String(msg) : ""}`;
    }
  }
  const stackRaw = pick("stacktrace", "stack_trace", "stackTrace");
  if (!exceptionMessage && typeof stackRaw === "string") exceptionMessage = stackRaw;
  if (!exceptionMessage && Array.isArray(stackRaw)) {
    exceptionMessage = stackRaw.join("\n");
  }

  // HTTP-ish fields (common in structured access logs)
  let http: ParsedLine["http"];
  const status = pick("status", "statusCode", "status_code", "http.status_code", "response_code");
  const method = pick("method", "http.method", "requestMethod", "verb");
  const url = pick("path", "url", "uri", "http.url", "request", "route", "endpoint");
  const durationRaw = pick(
    "duration",
    "durationMs",
    "duration_ms",
    "responseTime",
    "responseTimeMs",
    "elapsed",
    "elapsedMs",
    "latency",
    "latencyMs",
    "took",
    "tookMs",
  );
  if (status !== undefined || method !== undefined || url !== undefined || durationRaw !== undefined) {
    http = {
      method: typeof method === "string" ? method : undefined,
      path: typeof url === "string" ? normalizePath(url) : undefined,
      status: typeof status === "number" ? status : Number(status) || undefined,
      durationMs: typeof durationRaw === "number" ? durationRaw : undefined,
      bytes: typeof pick("bytes", "size", "responseSize") === "number" ? Number(pick("bytes", "size", "responseSize")) : undefined,
      ip: typeof pick("ip", "clientIp", "remoteAddr", "remote_addr", "client_ip") === "string"
        ? String(pick("ip", "clientIp", "remoteAddr", "remote_addr", "client_ip"))
        : undefined,
    };
  }

  return {
    level,
    message: typeof messageRaw === "string" ? messageRaw : messageRaw !== undefined ? JSON.stringify(messageRaw) : undefined,
    timestamp,
    timestampRaw,
    logger: typeof loggerRaw === "string" ? loggerRaw : undefined,
    thread: typeof threadRaw === "string" || typeof threadRaw === "number" ? String(threadRaw) : undefined,
    exceptionMessage,
    http,
    sources: typeof messageRaw === "string" ? extractSourceRefs(messageRaw) : [],
  };
}

function emptyLine(index: number, raw: string): ParsedLine {
  return {
    index,
    raw,
    level: "unknown",
    message: "",
    isContinuation: false,
    signature: "empty",
  };
}

export function parseLine(
  raw: string,
  index: number,
  format: LogFormat,
  detection?: FormatDetection,
): ParsedLine {
  const trimmed = raw.trim();
  if (!trimmed) return emptyLine(index, raw);

  if (format === "json") {
    const parsed = parseJsonLine(raw, index);
    if (parsed) return parsed;
  }

  if (format === "apache") {
    const parsed = parseApacheLine(raw, index);
    if (parsed) return parsed;
  }

  if (format === "syslog") {
    const parsed = parseSyslogLine(raw, index);
    if (parsed) return parsed;
  }

  return parseTextLine(raw, index, detection);
}

function parseJsonLine(raw: string, index: number): ParsedLine | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return undefined;
  let record: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    record = value as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const fields = fromJson(record);
  const exception = fields.exceptionMessage
    ? parseExceptionHeader(fields.exceptionMessage.split("\n")[0] ?? "") ?? {
        type: "exception",
        message: fields.exceptionMessage.split("\n")[0] ?? "",
        fatal: false,
      }
    : undefined;

  const message = fields.message ?? (exception ? `${exception.type}: ${exception.message}` : trimmed);
  const level: LogLevel =
    fields.level ??
    (exception ? inferLevelFromContent(message) : fields.http?.status ? levelFromHttpStatus(fields.http.status) : "info");

  return {
    index,
    raw,
    level,
    message,
    timestamp: fields.timestamp,
    timestampRaw: fields.timestampRaw,
    logger: fields.logger,
    thread: fields.thread,
    http: fields.http,
    exception,
    isContinuation: false,
    signature: buildSignature(level, message, exception?.type, fields.logger),
  };
}

function parseApacheLine(raw: string, index: number): ParsedLine | undefined {
  const match = APACHE_PATTERN.exec(raw.trim());
  if (!match) return undefined;
  const [
    ,
    ip,
    ,
    ,
    timestampRaw,
    method,
    path,
    statusRaw,
    bytesRaw,
    referer,
    userAgent,
    requestTime,
    upstreamTime,
  ] = match;
  const status = Number(statusRaw);
  const bytes = bytesRaw === "-" ? undefined : Number(bytesRaw);

  const ts = extractTimestamp(`[${timestampRaw}]`);
  const normalizedPath = normalizePath(path ?? "");

  return {
    index,
    raw,
    level: levelFromHttpStatus(status),
    message: `${method ?? "GET"} ${normalizedPath} ${status}`,
    timestamp: ts?.value,
    timestampRaw,
    http: {
      method,
      path: normalizedPath,
      status,
      bytes,
      ip,
      referer,
      userAgent,
      durationMs: secondsFieldToMs(requestTime) ?? secondsFieldToMs(upstreamTime),
    },
    isContinuation: false,
    signature: buildSignature(levelFromHttpStatus(status), `${method} ${normalizedPath} ${status}`),
  };
}

function parseSyslogLine(raw: string, index: number): ParsedLine | undefined {
  const line = raw.trim();
  const ts = extractTimestamp(line);
  let rest = line;
  if (ts) rest = line.slice(ts.end);

  // <34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick
  const syslogBody = /^(?:\S+:\s*)?(\S+?)\[\d+\]:\s*(.*)$/.exec(rest);
  if (!syslogBody) return undefined;
  const [, process, message] = syslogBody;

  const exception = parseExceptionHeader(message);
  const level: LogLevel = exception
    ? exception.fatal
      ? "fatal"
      : "error"
    : detectLevel(message)?.level ?? inferLevelFromContent(message);

  return {
    index,
    raw,
    level,
    message: exception ? `${exception.type}: ${exception.message}` : message ?? "",
    timestamp: ts?.value,
    timestampRaw: ts?.raw,
    logger: process,
    exception,
    isContinuation: false,
    signature: buildSignature(level, message ?? "", exception?.type, process),
  };
}

function parseTextLine(
  raw: string,
  index: number,
  detection?: FormatDetection,
): ParsedLine {
  const line = raw.trim();
  const continuation = isContinuationLine(raw);

  const exceptionHeader = parseExceptionHeader(line);
  if (continuation) {
    // Handled by the aggregator, but keep enough context for grouping.
    const message = exceptionHeader ? exceptionHeader.message || exceptionHeader.type : line;
    return {
      index,
      raw,
      level: "unknown",
      message,
      exception: exceptionHeader,
      isContinuation: true,
      signature: buildSignature("unknown", message, exceptionHeader?.type),
    };
  }

  const ts = extractTimestamp(line);
  let rest = ts ? line.slice(ts.end) : line;

  // Strip leading separators left behind by the timestamp match.
  rest = rest.replace(/^[\s\])>|:,-]+/, "");

  const levelHit = detectLevel(rest);
  let level: LogLevel | undefined = levelHit?.level;
  let afterLevel = levelHit ? rest.slice(levelHit.end).replace(/^[\s:\-–—>|]+/, "") : rest;

  // `INFO  1234 - [main] com.foo - message` (log4j with thread id + name)
  const threadMatch = /^(?:\d+\s+)?-\s*\[([^\]]{1,40})\]/.exec(afterLevel);
  const thread = threadMatch?.[1];
  if (threadMatch) afterLevel = afterLevel.slice(threadMatch[0].length).replace(/^[\s:\-–—>|]+/, "");

  // `[main] INFO com.foo - message` (timestamp first, then thread)
  if (!level) {
    const leadingThread = /^\[([^\]]{1,40})\]\s*(.*)$/.exec(afterLevel);
    if (leadingThread) {
      const inner = detectLevel(leadingThread[2] ?? "");
      if (inner) {
        level = inner.level;
        afterLevel = (leadingThread[2] ?? "").slice(inner.end).replace(/^[\s:\-–—>|]+/, "");
      }
    }
  }

  // Exception header first: a bare `java.lang.NullPointerException: …` looks
  // exactly like a logger name, and must not be swallowed as one.
  let exception = parseExceptionHeader(afterLevel);

  // Logger name right after the severity marker: `com.foo.Bar - message`
  let logger: string | undefined;
  if (!exception) {
    const logoMatch = LOGO_RE.exec(afterLevel);
    if (logoMatch && logoMatch.index !== undefined && logoMatch.index <= 2) {
      logger = (logoMatch[2] ?? "").trim();
      if (logger.startsWith("[") && logger.endsWith("]")) logger = logger.slice(1, -1);
      afterLevel = afterLevel.slice(logoMatch.index + logoMatch[0].length).replace(/^[\s:\-–—>|]+/, "");
    }
    if (!logger) {
      const loggerAttr = /\b(?:logger|log|component|source|category)\s*[=:]\s*"?([\w.$:-]+)"?/i.exec(afterLevel);
      if (loggerAttr) {
        logger = loggerAttr[1];
        afterLevel = afterLevel.replace(loggerAttr[0], "");
      }
    }
    exception = parseExceptionHeader(afterLevel);
  }

  const message = exception ? exception.message || exception.type : afterLevel;

  if (!level) {
    level = exception
      ? exception.fatal
        ? "fatal"
        : "error"
      : inferLevelFromContent(message);
  }

  // Apache-like lines can show up in otherwise unstructured text logs.
  let http: ParsedLine["http"];
  const apacheInText = APACHE_PATTERN.exec(line);
  if (apacheInText && detection?.format !== "text") {
    const [, ip, , , , method, path, statusRaw, bytesRaw] = apacheInText;
    http = {
      method,
      path: normalizePath(path ?? ""),
      status: Number(statusRaw),
      bytes: bytesRaw === "-" ? undefined : Number(bytesRaw),
      ip,
    };
  }

  // Application request lines: `GET /api/orders/12 -> 200 (12ms)`. Without
  // this, the most common shape of web log never reaches the HTTP or latency
  // statistics. The arrow is required, and substring checks are far cheaper
  // than running two regexes on every line of a large file.
  if (!http && (message.includes("->") || message.includes("=>"))) {
    http = extractRequestLine(message);
  }

  return {
    index,
    raw,
    level,
    message,
    timestamp: ts?.value,
    timestampRaw: ts?.raw,
    logger,
    thread,
    http,
    exception,
    isContinuation: false,
    signature: buildSignature(level, message, exception?.type, logger),
  };
}

/** `$request_time` style fields are seconds, possibly quoted or `-`. */
function secondsFieldToMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.replace(/"/g, ""));
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

/** `GET /api/orders/12 -> 200 (12ms)`, `POST /x => 500 in 2.5s`, … */
const REQUEST_LINE =
  /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(\S+)\s*(?:->|=>)\s*([1-5]\d{2})\b\s*(.*)$/i;
const REQUEST_DURATION = /(\d+(?:[.,]\d+)?)\s*(ns|us|µs|μs|ms|msec|milliseconds|s|sec|secs|seconds?)\b/i;

/**
 * Pull method, path, status and response time out of an application request
 * line. Returns `undefined` for anything that is not clearly a request, so the
 * caller can keep the plain-text interpretation.
 */
export function extractRequestLine(message: string): ParsedLine["http"] | undefined {
  // `c.f.orders.OrderController - GET /api/orders/12 -> 200 (12ms)` keeps the
  // logger prefix in the message; drop it before matching.
  const body = message.replace(/^[\w.$]{4,}\s+[-–—|]\s+/, "");
  const match = REQUEST_LINE.exec(body);
  if (!match) return undefined;
  const [, method, target, statusRaw, tail = ""] = match;
  const duration = REQUEST_DURATION.exec(tail);
  const durationMs = duration
    ? toMs(Number(duration[1].replace(",", ".")), duration[2])
    : undefined;

  return {
    method: method.toUpperCase(),
    path: normalizePath(target.split("?")[0] ?? target),
    status: Number(statusRaw),
    durationMs: durationMs !== undefined && Number.isFinite(durationMs) ? durationMs : undefined,
  };
}

/** Sorted, de-duplicated source references for a message. */
export function collectSources(message: string, into: Map<string, number>): SourceStat[] {
  const stats: SourceStat[] = [];
  for (const ref of extractSourceRefs(message, 3)) {
    into.set(ref, (into.get(ref) ?? 0) + 1);
    stats.push({ location: ref, count: into.get(ref) ?? 1 });
  }
  return stats;
}