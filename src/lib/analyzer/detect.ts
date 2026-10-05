/**
 * Format detection.
 *
 * A short sample of the file is inspected once, before parsing, so the parser
 * knows which strategy to use. Detection is heuristic but conservative: it only
 * commits to a format when the majority of sampled lines match.
 */

import type { LogFormat } from "./types";
import { detectLevel } from "./levels";
import { extractTimestamp } from "./timestamps";
import { isContinuationLine } from "./stack";

export interface FormatDetection {
  format: LogFormat;
  /** 0..1 share of sampled lines that matched the chosen format. */
  confidence: number;
  notes: string[];
}

// The last two optional groups are `$request_time` and `$upstream_response_time`
// from the nginx extended access log format; both are quoted seconds there and
// bare numbers in some variants.
const APACHE_RE =
  /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) (\S+)(?: HTTP\/[\d.]+)?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?(?: (\S+))?(?: (\S+))?/;

const SYSLOG_RE = /^(?:<\d{1,3}>)?[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/;
const RFC5424_RE = /^<\d{1,3}>\d+\s+\S+\s+\S+\s+\S+\s+\S+\s+/;

export const APACHE_PATTERN = APACHE_RE;
export const SYSLOG_PATTERN = SYSLOG_RE;

export function detectFormat(sample: string[]): FormatDetection {
  const lines = sample.filter((line) => line.trim().length > 0);
  const notes: string[] = [];
  if (lines.length === 0) {
    return { format: "generic", confidence: 0, notes: ["File is empty"] };
  }

  let json = 0;
  let apache = 0;
  let syslog = 0;
  let text = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          json++;
          continue;
        }
      } catch {
        // not JSON after all, fall through
      }
    }

    if (APACHE_RE.test(trimmed)) {
      apache++;
      continue;
    }

    if (RFC5424_RE.test(trimmed) || SYSLOG_RE.test(trimmed)) {
      syslog++;
      continue;
    }

    if (extractTimestamp(trimmed) && (detectLevel(trimmed) || isContinuationLine(trimmed))) {
      // Timestamped entries plus their stack-trace bodies describe a
      // conventional delimited log rather than free-form output.
      text++;
    }
  }

  const total = lines.length;
  const candidates: { format: LogFormat; count: number }[] = [
    { format: "json", count: json },
    { format: "apache", count: apache },
    { format: "syslog", count: syslog },
    { format: "text", count: text },
  ];
  candidates.sort((a, b) => b.count - a.count);

  const best = candidates[0];
  const confidence = best.count / total;

  if (confidence < 0.4) {
    return {
      format: "generic",
      confidence,
      notes: [
        `No dominant structure found (best match ${Math.round(confidence * 100)}%), falling back to generic parsing.`,
      ],
    };
  }

  if (best.format === "json") {
    notes.push("Structured JSON objects detected on each line");
  } else if (best.format === "apache") {
    notes.push("Combined access-log layout detected");
  } else if (best.format === "syslog") {
    notes.push("Syslog-style priority/timestamp layout detected");
  } else {
    notes.push("Timestamp + severity markers detected");
  }

  return { format: best.format, confidence, notes };
}