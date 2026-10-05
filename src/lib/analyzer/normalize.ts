/**
 * Message normalisation + fingerprinting.
 *
 * Two log lines are considered "the same problem" when their messages differ
 * only in volatile values: ids, numbers, hex addresses, durations, quoted
 * payloads, urls, e-mails, file paths and line numbers.
 */

/** Ordered replacements: the most specific patterns must run first. */
const REPLACEMENTS: [RegExp, string][] = [
  // Fully qualified exception / error type -> keep the type, drop the args.
  [/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:\.[A-Za-z_$][\w$]*)*Exception|\b[A-Za-z_$][\w$]*Error|\b[A-Za-z_$][\w$]*Exception)\b/g, "<type>"],
  // ISO timestamps.
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, "<ts>"],
  // Apache style timestamps: [01/May/2024:12:34:56 +0000]
  [/\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s*[+-]\d{4}/g, "<ts>"],
  // Syslog style timestamps: May  1 12:34:56
  [/\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/g, "<ts>"],
  // Clock times on their own.
  [/\b\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g, "<time>"],
  // Durations.
  [/\b\d+(?:\.\d+)?\s?(?:ms|msec|millis|seconds?|secs?|s|minutes?|min|m)\b/gi, "<duration>"],
  // Sizes.
  [/\b\d+(?:\.\d+)?\s?(?:bytes?|kb|mb|gb|tb|kib|mib|gib)\b/gi, "<size>"],
  // Percentages.
  [/\b\d+(?:\.\d+)?%/g, "<pct>"],
  // uuids.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  // E-mail addresses.
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "<email>"],
  // IPv4 / IPv6.
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  [/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, "<ip>"],
  // Hex pointers / hashes / long base64.
  [/0x[0-9a-f]+/gi, "<hex>"],
  [/\b[0-9a-f]{16,}\b/gi, "<hash>"],
  [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "<blob>"],
  // Quoted and JSON-ish payloads.
  [/"(?:[^"\\]|\\.)*"/g, "<str>"],
  [/"[^"]*"?:/g, "<key>:"],
  [/'(?:[^'\\]|\\.)*'/g, "<str>"],
  // file:line references.
  [/([\w./\\-]+\.\w{1,5}):\d+(?::\d+)?/g, "<file>:<line>"],
  // Ids like `id=1234`, `order-8891`, `pid: 22`.
  [/\b(pid|tid|thread|status|code|id|index|offset|port|offset|size|length|bytes|attempt|retry|connection|conn)\b(\s*[=:]\s*)\S+/gi, "$1$2<val>"],
  // Long digit runs (ids, pids, counts).
  [/\b\d{4,}\b/g, "<n>"],
  // Query strings / urls.
  [/([a-z][a-z0-9+.-]*:\/\/[^\s"']+\?)[^\s"']*/gi, "$1<query>"],
  // Remaining small numbers.
  [/\b\d+(?:\.\d+)?\b/g, "<n>"],
];

/** Collapse whitespace so messages that only differ in spacing group together. */
export function normalizeMessage(message: string): string {
  let out = message;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** FNV-1a, 32 bit. Stable across platforms and runs. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (kept in 32 bit range without BigInt)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
}

const SIGNATURE_LENGTH = 220;

/**
 * Build the grouping key for a line. Messages that only differ in volatile
 * values collapse onto the same key, so a burst of the same failure shows up as
 * a single issue with a count instead of thousands of rows.
 */
export function buildSignature(
  level: string,
  message: string,
  exceptionType?: string,
  logger?: string,
): string {
  const normalized = normalizeMessage(message).slice(0, SIGNATURE_LENGTH);
  const scope = exceptionType ?? logger ?? "";
  return hashString(`${level}|${scope}|${normalized}`);
}

/** Human readable one-liner used as the issue title. */
export function buildTitle(
  message: string,
  exceptionType?: string,
  limit = 120,
): string {
  const base = (exceptionType ? `${exceptionType}: ` : "") + message;
  const flat = base.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}