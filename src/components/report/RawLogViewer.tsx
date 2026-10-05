import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { LEVEL_BG, type LogLevel, type LogReport } from "@/lib/analyzer";

const FILTERS: { value: "all" | LogLevel; label: string }[] = [
  { value: "all", label: "All" },
  { value: "fatal", label: "Fatal" },
  { value: "error", label: "Error" },
  { value: "warn", label: "Warning" },
  { value: "info", label: "Info" },
];

const MAX_RENDERED = 300;

/**
 * Read-only view of the retained log lines, with a substring filter and a
 * severity filter. Only a bounded sample is kept by the engine, which the copy
 * makes explicit instead of pretending the list is complete.
 */
export function RawLogViewer({ report }: { report: LogReport }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | LogLevel>("all");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return report.samples.filter((sample) => {
      if (filter !== "all" && sample.level !== filter) return false;
      if (!needle) return true;
      return sample.raw.toLowerCase().includes(needle);
    });
  }, [filter, query, report.samples]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter lines…"
          className="h-8 max-w-xs font-mono text-xs"
          aria-label="Filter log lines"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                filter === option.value
                  ? "bg-secondary font-medium text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {matches.length.toLocaleString()} matching ·{" "}
          {report.sampledLines.toLocaleString()} retained of{" "}
          {report.lineCount.toLocaleString()} lines
        </span>
      </div>

      <div className="max-h-[28rem] overflow-auto">
        {matches.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No retained line matches that filter.
          </p>
        ) : (
          <ol className="divide-y font-mono text-[11.5px] leading-relaxed">
            {matches.slice(0, MAX_RENDERED).map((sample) => (
              <li key={`${sample.index}-${sample.raw.slice(0, 24)}`} className="flex gap-3 px-5 py-1.5 hover:bg-muted/30">
                <span className="w-16 shrink-0 select-none text-right text-muted-foreground/70">
                  {sample.index + 1}
                </span>
                <span
                  className={cn(
                    "w-12 shrink-0 uppercase",
                    sample.level === "fatal" && "text-severity-fatal",
                    sample.level === "error" && "text-severity-error",
                    sample.level === "warn" && "text-severity-warn",
                    sample.level === "info" && "text-severity-info",
                    (sample.level === "debug" || sample.level === "trace") &&
                      "text-severity-debug",
                  )}
                >
                  {sample.level.slice(0, 4)}
                </span>
                <span className="whitespace-pre-wrap break-all text-foreground/85">
                  {sample.raw}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {matches.length > MAX_RENDERED ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Rendering the first {MAX_RENDERED} lines — narrow the filter to see the
          rest.
        </p>
      ) : null}
    </div>
  );
}

export { LEVEL_BG };
