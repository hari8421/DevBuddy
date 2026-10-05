import { useSyncExternalStore } from "react";

import {
  getAnalysis,
  listAnalyses,
  subscribe,
  type SavedAnalysis,
} from "@/lib/history";

/** Every saved report in this browser, newest first. */
export function useAnalyses(): SavedAnalysis[] {
  return useSyncExternalStore(
    subscribe,
    listAnalyses,
    () => [] as SavedAnalysis[],
  );
}

/** A single saved report, or undefined while it does not exist. */
export function useAnalysis(id: string | undefined): SavedAnalysis | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getAnalysis(id) : undefined),
    () => undefined,
  );
}
