/**
 * Severity detection.
 *
 * Logs spell severity in a lot of ways (`ERROR`, `Error`, `[warn]`, `level=info`,
 * `WARNING:root:`). The detector looks for an explicit marker first and only
 * falls back to keyword heuristics when the format has no severity field at all.
 */

import type { LogLevel } from "./types";

/** Canonical token -> level. Keys are uppercase. */
const TOKEN_TO_LEVEL: Record<string, LogLevel> = {
  FATAL: "fatal",
  CRITICAL: "fatal",
  CRIT: "fatal",
  PANIC: "fatal",
  EMERG: "fatal",
  ALERT: "fatal",
  ERROR: "error",
  ERR: "error",
  EXCEPTION: "error",
  FAILURE: "error",
  FAILED: "error",
  FAIL: "error",
  WARN: "warn",
  WARNING: "warn",
  NOTICE: "warn",
  INFO: "info",
  INFORMATION: "info",
  LOG: "info",
  DEBUG: "debug",
  DBG: "debug",
  TRACE: "trace",
  VERBOSE: "trace",
  FINE: "trace",
  FINER: "trace",
  FINEST: "trace",
};

/** Content keywords used when a line carries no explicit severity marker. */
const ERROR_KEYWORDS = [
  "exception",
  "traceback",
  "stack trace",
  "fatal",
  "panic:",
  "segmentation fault",
  "assertionerror",
  "assertion failed",
  "failed",
  "failure",
  "cannot ",
  "unable to",
  "refused",
  "denied",
  "not found",
  "timed out",
  "timeout",
  "out of memory",
  "crash",
  "invalid",
  "expected ",
];

const WARN_KEYWORDS = [
  "warn",
  "warning",
  "deprecated",
  "deprecation",
  "retry",
  "retrying",
  "slow",
  "retryable",
  "approaching",
  "fallback",
  "falling back",
  "soft ",
];

const DEBUG_KEYWORDS = [
  "debug",
  "trace",
  "verbose",
];

function tokenLevel(token: string): LogLevel | undefined {
  const upper = token.toUpperCase();
  if (TOKEN_TO_LEVEL[upper]) return TOKEN_TO_LEVEL[upper];
  // Very short tokens are ambiguous (`err`, `inf`), require an exact match
  // which the map above already enforces.
  return undefined;
}

/**
 * Find an explicit severity marker in `text`.
 * Returns the level and the `[start, end)` range it occupies.
 */
export function detectLevel(
  text: string,
  scanLimit = 160,
): { level: LogLevel; start: number; end: number } | undefined {
  const head = text.slice(0, scanLimit);

  // [LEVEL]
  let match = /[[({<]\s*([A-Za-z]{3,9})\s*[\])}>]/.exec(head);
  if (match && tokenLevel(match[1])) {
    return {
      level: tokenLevel(match[1])!,
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  // level=ERROR / severity: warn / lvl=debug
  match = /\b(?:level|severity|lvl|levelname|log_level|log\.level)\b\s*[=:]\s*"?([A-Za-z]{3,9})"?/i.exec(
    head,
  );
  if (match && tokenLevel(match[1])) {
    return {
      level: tokenLevel(match[1])!,
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  // Prefix marker: `ERROR: message`, `WARN - message`, `- ERROR -`, `INFO|message`
  match = /(?:^|[\s-])[*#=]?\s*([A-Za-z]{3,9})\s*[:|]\s*/.exec(head);
  if (match && tokenLevel(match[1])) {
    return {
      level: tokenLevel(match[1])!,
      start: match.index,
      end: match.index + match[0].length,
    };
  }

  // Python logging prefix: `WARNING:root:message`
  match = /^([A-Z]{3,9}):\S+?:/.exec(head);
  if (match && tokenLevel(match[1])) {
    return {
      level: tokenLevel(match[1])!,
      start: 0,
      end: match.index + match[0].length,
    };
  }

  // Word surrounded by separators: `... ERROR com.foo - msg`, `2024/01/01 ERROR - msg`
  match = /(?:^|[\s\])>(|])([*#=]?\s*)([A-Za-z]{3,9})\s*(?=[-:|(\s]|$)/.exec(head);
  if (match && tokenLevel(match[2] ?? "")) {
    const start = match.index + (match[1] ?? "").length;
    return { level: tokenLevel(match[2])!, start, end: start + match[2].length };
  }

  // Bare uppercase token at position 0 (e.g. `FATAL something broke`)
  match = /^[*#=]?\s*([A-Z]{3,9})\b/.exec(head);
  if (match && tokenLevel(match[1])) {
    return {
      level: tokenLevel(match[1])!,
      start: 0,
      end: match[0].length,
    };
  }

  return undefined;
}

/** Severity inferred from the wording of a message. */
export function inferLevelFromContent(message: string): LogLevel {
  const lower = message.toLowerCase();
  for (const keyword of ERROR_KEYWORDS) {
    if (lower.includes(keyword)) return "error";
  }
  for (const keyword of WARN_KEYWORDS) {
    if (lower.includes(keyword)) return "warn";
  }
  for (const keyword of DEBUG_KEYWORDS) {
    if (lower.includes(keyword)) return "debug";
  }
  return "info";
}

/** Map an HTTP status code onto a severity. */
export function levelFromHttpStatus(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status === 429 || status === 408) return "warn";
  if (status >= 400) return "warn";
  return "info";
}