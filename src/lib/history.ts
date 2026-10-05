/**
 * Local report history.
 *
 * LogLens has no accounts and no server: analysed reports are kept in this
 * browser's localStorage so they survive a reload without anyone having to
 * sign in. The store is tiny and synchronous, which lets React pages read it
 * through `useSyncExternalStore`.
 */

import type { LogReport } from "@/lib/analyzer";

const STORAGE_KEY = "loglens.analyses.v1";
/** Enough for real use while staying well inside the ~5 MB storage budget. */
const MAX_ENTRIES = 30;
/** Raw lines are the bulk of a report; keep a readable sample only. */
const MAX_STORED_SAMPLES = 150;
const MAX_STORED_SAMPLE_LENGTH = 300;
const MAX_STORED_FRAME_LENGTH = 200;

export interface SavedAnalysis {
  id: string;
  name: string;
  sizeBytes: number;
  lineCount: number;
  format: string;
  errorCount: number;
  warningCount: number;
  healthScore: number;
  savedAt: number;
  report: LogReport;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: SavedAnalysis[] | null = null;

function read(): SavedAnalysis[] {
  if (cache) return cache;
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as SavedAnalysis[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(entries: SavedAnalysis[]): boolean {
  cache = entries;
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Most likely a quota error: retry once without raw line samples before
    // giving up, so a big report is still usable in the current session.
    const lighter = entries.map((entry) => ({
      ...entry,
      report: {
        ...entry.report,
        samples: [],
        issues: entry.report.issues.slice(0, 20).map((issue) => ({
          ...issue,
          samples: [],
          frames: issue.frames.slice(0, 5).map((frame) => ({
            ...frame,
            raw: frame.raw.slice(0, MAX_STORED_FRAME_LENGTH),
          })),
        })),
      },
    }));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lighter));
      cache = lighter;
      return true;
    } catch {
      return false;
    }
  } finally {
    notify();
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to history changes (used by `useSyncExternalStore`). */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Newest first. */
export function listAnalyses(): SavedAnalysis[] {
  return read();
}

export function getAnalysis(id: string): SavedAnalysis | undefined {
  return read().find((entry) => entry.id === id);
}

function trimReport(report: LogReport): LogReport {
  return {
    ...report,
    samples: report.samples.slice(0, MAX_STORED_SAMPLES).map((sample) => ({
      ...sample,
      raw: sample.raw.slice(0, MAX_STORED_SAMPLE_LENGTH),
    })),
    issues: report.issues.slice(0, 40).map((issue) => ({
      ...issue,
      samples: issue.samples.slice(0, 1).map((sample) => ({
        ...sample,
        raw: sample.raw.slice(0, MAX_STORED_SAMPLE_LENGTH),
      })),
      frames: issue.frames.slice(0, 8).map((frame) => ({
        ...frame,
        raw: frame.raw.slice(0, MAX_STORED_FRAME_LENGTH),
      })),
    })),
  };
}

/** Persist a report and return the stored entry. */
export function saveAnalysis(report: LogReport): SavedAnalysis {
  const entry: SavedAnalysis = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: report.fileName,
    sizeBytes: report.sizeBytes,
    lineCount: report.lineCount,
    format: report.format,
    errorCount: report.levels.error + report.levels.fatal,
    warningCount: report.levels.warn,
    healthScore: report.healthScore,
    savedAt: Date.now(),
    report: trimReport(report),
  };

  const next = [entry, ...read().filter((item) => item.name !== entry.name)].slice(0, MAX_ENTRIES);
  write(next);
  return entry;
}

export function deleteAnalysis(id: string): void {
  write(read().filter((entry) => entry.id !== id));
}

export function clearAnalyses(): void {
  write([]);
}

/** Approximate size of the stored history, for the dashboard footer. */
export function historySizeBytes(): number {
  if (typeof window === "undefined") return 0;
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.length ?? 0;
  } catch {
    return 0;
  }
}
