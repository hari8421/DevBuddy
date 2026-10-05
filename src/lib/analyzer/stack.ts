/**
 * Exception and stack-frame extraction.
 *
 * The engine understands the stack-trace dialects developers actually see in
 * production logs: Java, Kotlin, JavaScript/Node, Python, Go, .NET and Ruby.
 */

import type { StackFrame } from "./types";

const MAX_FRAMES = 40;
const TRIM_FRAMES = 12;

/**
 * Extract a stack frame from a continuation line.
 * Returns `undefined` when the line is not a frame.
 */
export function parseStackFrame(raw: string): StackFrame | undefined {
  const line = raw.trim();

  // Java / Kotlin: at com.foo.Bar.baz(Bar.java:42)  |  at com.foo.Bar.baz(Unknown Source)
  let match = /^(?:at\s+)?([\w$.<>]+)\.([\w$<>]+)\(([^)]*)\)\s*$/.exec(line);
  if (match && line.startsWith("at ")) {
    const [, className, methodName, location] = match;
    return frame(`${className}.${methodName}`, location, line);
  }

  // Java module prefix: at app//com.foo.Bar.baz(Bar.java:42)
  match = /^at\s+([\w$]+(?:\.[\w$]+)*)\(([^)]*)\)\s*$/.exec(line);
  if (match) {
    const [, qualified, location] = match;
    return frame(qualified, location, line);
  }

  // JavaScript: at Object.<anonymous> (/app/src/index.js:10:15)
  match = /^at\s+(?:async\s+)?(.+?)\s+\((.+?)\)\s*$/.exec(line);
  if (match) {
    const [, fn, location] = match;
    return frame(fn.trim(), location, line);
  }

  // JavaScript anonymous: at /app/src/index.js:10:15  |  at new Promise (<anonymous>)
  match = /^at\s+(\S+?)(?::(\d+):(\d+))\s*$/.exec(line);
  if (match) {
    return {
      functionName: undefined,
      file: match[1],
      line: Number(match[2]),
      raw: line,
    };
  }

  // Python: File "/app/main.py", line 42, in handler
  match = /^File\s+"([^"]+)",\s*line\s+(\d+)(?:,\s*in\s+(.+))?$/.exec(line);
  if (match) {
    return {
      functionName: match[3],
      file: match[1],
      line: Number(match[2]),
      raw: line,
    };
  }

  // Python (3.11+): ^^^^ style markers carry no extra info; ignore.
  // Python chain marker: During handling of the above exception, another exception occurred:
  // Go: main.(*Server).handle(0xc0000b4000) /app/main.go:42 +0x1d
  match = /^([\w./()*[[\]]-]+)\((0x[0-9a-f]+)?\)?\s+(\/[^:]+|\S+\.go):(\d+)/i.exec(line);
  if (match) {
    return frame(match[1], `${match[3]}:${match[4]}`, line);
  }

  // .NET: at Namespace.Class.Method() in C:\src\File.cs:line 42
  match = /^at\s+([\w.<>`]+)\(?\)?\s+in\s+(.+?):line\s+(\d+)$/i.exec(line);
  if (match) {
    return frame(match[1], `${match[2]}:${match[3]}`, line);
  }

  // Ruby: from /app/lib/worker.rb:42:in `perform'
  match = /^from\s+(.+?):(\d+)(?::in\s+[`'](.+?)')?/.exec(line);
  if (match) {
    return {
      functionName: match[3],
      file: match[1],
      line: Number(match[2]),
      raw: line,
    };
  }

  return undefined;
}

function frame(
  functionName: string,
  location: string,
  raw: string,
): StackFrame {
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(location.trim());
  if (match) {
    return { functionName, file: match[1], line: Number(match[2]), raw };
  }
  if (location && location !== "Unknown Source" && location !== "<anonymous>") {
    return { functionName, file: location, raw };
  }
  return { functionName, raw };
}

/**
 * Recognise the first line of an exception, which carries the type and message.
 * Covers `java.lang.NullPointerException: boom`, `Error: nope`,
 * `System.NullReferenceException: ...`, `panic: ...` and `fatal error: ...`.
 */
export function parseExceptionHeader(
  raw: string,
): { type: string; message: string; fatal: boolean } | undefined {
  const line = raw.trim();

  let match = /^(?:Caused by:\s*|Suppressed:\s*|Unhandled exception:\s*)?([\w$.]*(?:Exception|Error|Throwable|Fault|Failure))\b\s*[:-]?\s*(.*)$/.exec(
    line,
  );
  if (match) {
    return { type: match[1], message: (match[2] ?? "").trim(), fatal: false };
  }

  // .NET: System.Collections.Generic.KeyNotFoundException: 'x' (no namespace dot)
  match = /^([A-Z][\w+]*(?:Exception|Error))\s*:\s*(.*)$/.exec(line);
  if (match) {
    return { type: match[1], message: (match[2] ?? "").trim(), fatal: false };
  }

  // Python: ValueError: bad input
  match = /^([A-Z][\w.]*(?:Error|Exception|Warning|Interrupt|Exit))\s*:\s*(.*)$/.exec(line);
  if (match) {
    return { type: match[1], message: (match[2] ?? "").trim(), fatal: false };
  }

  // JavaScript: ReferenceError: x is not defined
  match = /^(?:Uncaught\s+)?([A-Z][\w]*(?:Error|Exception))\s*:\s*(.*)$/.exec(line);
  if (match) {
    return { type: match[1], message: (match[2] ?? "").trim(), fatal: false };
  }

  // Go / runtime aborts.
  match = /^panic:\s*(.*)$/.exec(line);
  if (match) {
    return { type: "panic", message: (match[1] ?? "").trim(), fatal: true };
  }
  match = /^fatal error:\s*(.*)$/.exec(line);
  if (match) {
    return { type: "fatal error", message: (match[1] ?? "").trim(), fatal: true };
  }

  return undefined;
}

/** Lines that only carry structure for a stack trace. */
const CONTINUATION_MARKERS = [
  "caused by:",
  "suppressed:",
  "during handling of the above exception",
  "the above exception was thrown",
  "... ",
  "traceback (most recent call last):",
  "stack trace:",
  "exception in thread",
  "unhandled exception",
  "unhandled rejection",
  "unhandledpromiserejection",
  "^",
];

export function isContinuationLine(raw: string): boolean {
  const line = raw.trimStart();
  if (!line) return false;
  if (parseStackFrame(raw)) return true;
  const lower = line.toLowerCase();
  return CONTINUATION_MARKERS.some((marker) => lower.startsWith(marker));
}

/** Trim long traces: keep the first frames (where the failure happens) and the tail. */
export function compactFrames(frames: StackFrame[]): StackFrame[] {
  if (frames.length <= MAX_FRAMES) return frames;
  return [...frames.slice(0, TRIM_FRAMES), ...frames.slice(-6)];
}

/** `com.foo.Bar.baz` -> `com.foo.Bar` : the class/module a frame belongs to. */
export function frameOwner(frame: StackFrame): string | undefined {
  const fn = frame.functionName;
  if (!fn) return frame.file;
  const withoutParens = fn.replace(/\(.*$/, "").trim();
  const parts = withoutParens.split(".");
  if (parts.length < 2) return withoutParens;
  return parts.slice(0, -1).join(".");
}