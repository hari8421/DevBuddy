/**
 * Timestamp extraction.
 *
 * Logs in the wild carry timestamps in a dozen formats, so a handful of
 * patterns are tried in order of specificity. Everything is converted to epoch
 * milliseconds; unparsable input yields `undefined` instead of a wrong date.
 */

export interface TimestampHit {
  value: number;
  raw: string;
  /** Index in the original line where the timestamp starts. */
  start: number;
  /** Index in the original line right after the timestamp. */
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

type Matcher = { re: RegExp; build: (m: RegExpExecArray) => number | undefined };

const MATCHERS: Matcher[] = [
  {
    // 2024-05-01T12:34:56.789Z / 2024-05-01 12:34:56,123 +02:00
    re:
      /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?/,
    build: (m) => {
      const ms = m[7] ? Number(m[7].padEnd(3, "0").slice(0, 3)) : 0;
      const iso =
        `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${String(ms).padStart(3, "0")}` +
        (m[8] ? (m[8] === "Z" ? "Z" : m[8].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "");
      const value = Date.parse(iso);
      return Number.isNaN(value) ? undefined : value;
    },
  },
  {
    // Apache / Nginx: [01/May/2024:12:34:56 +0000]
    re: /(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/,
    build: (m) => {
      const month = MONTHS[m[2].toLowerCase()];
      if (month === undefined) return undefined;
      const offset = m[7] ?? "+0000";
      const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${offset.slice(0, 3)}:${offset.slice(3)}`;
      const value = Date.parse(iso);
      return Number.isNaN(value) ? undefined : value;
    },
  },
  {
    // Syslog: May  1 12:34:56 (no year in the log)
    re: /([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/,
    build: (m) => {
      const month = MONTHS[m[1].toLowerCase()];
      if (month === undefined) return undefined;
      const year = new Date().getFullYear();
      const value = new Date(year, month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])).getTime();
      return Number.isNaN(value) ? undefined : value;
    },
  },
  {
    // 05/01/2024 12:34:56 or 2024/05/01 12:34:56
    re: /(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
    build: (m) => {
      const value = Date.parse(
        `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`,
      );
      return Number.isNaN(value) ? undefined : value;
    },
  },
  {
    re: /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    build: (m) => {
      // Assume US ordering (MM/DD/YYYY) which is the common case for this shape.
      const value = Date.parse(
        `${m[3]}-${m[1]}-${m[2]}T${m[4]}:${m[5]}:${m[6]}Z`,
      );
      return Number.isNaN(value) ? undefined : value;
    },
  },
  {
    // Epoch milliseconds (13 digits) at the start of a line or in brackets.
    re: /(?:^|[[({| ])(1[0-9]{12}|20[0-9]{11})(?:[\])}| ,:]|$)/,
    build: (m) => {
      const value = Number(m[1]);
      if (!Number.isFinite(value)) return undefined;
      // Sanity check: between 2001 and 2100.
      if (value < 1_000_000_000_000 || value > 4_102_444_800_000) return undefined;
      return value;
    },
  },
];

/**
 * Find the first timestamp on a line. Prefers a match near the start of the
 * line because that is where essentially every log format puts it.
 */
export function extractTimestamp(line: string): TimestampHit | undefined {
  for (const { re, build } of MATCHERS) {
    const match = re.exec(line);
    if (match && match.index !== undefined) {
      const value = build(match);
      if (value !== undefined) {
        return {
          value,
          raw: match[0].trim(),
          start: match.index + (match[0].startsWith(" ") ? 1 : 0),
          end: match.index + match[0].length,
        };
      }
    }
  }
  return undefined;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Compact, readable timestamp for chart axes and list rows. */
export function formatTime(value: number, withDate = true): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  if (!withDate) return `${hh}:${mm}:${ss}`;
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()} ${hh}:${mm}:${ss}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}