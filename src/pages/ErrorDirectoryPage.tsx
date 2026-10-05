import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DownloadIcon } from "@/components/icons";
import {
  CATEGORY_COLOR,
  CATEGORY_COUNTS,
  CATEGORY_LABEL,
  ERROR_CATALOG,
  ERROR_CATEGORIES,
  type ErrorCategory,
} from "@/lib/error-catalog";
import { downloadCatalog } from "@/lib/export";

type SeverityFilter = "all" | "critical" | "warning" | "info";

/**
 * The error directory: every failure mode LogLens knows about, with the reasons
 * it normally happens and the fixes that work. Reports link back here for any
 * entry they matched.
 */
export function ErrorDirectoryPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ErrorCategory | "all">("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ERROR_CATALOG.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (severity !== "all" && entry.severity !== severity) return false;
      if (!needle) return true;
      return (
        entry.title.toLowerCase().includes(needle) ||
        entry.reasons.some((reason) => reason.toLowerCase().includes(needle)) ||
        entry.fixes.some((fix) => fix.toLowerCase().includes(needle)) ||
        entry.languages.some((language) => language.toLowerCase().includes(needle))
      );
    });
  }, [category, query, severity]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="container flex-1 py-10">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
            Error directory
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Every error, why it happens, what fixes it
          </h1>
          <p className="mt-4 text-muted-foreground">
            {ERROR_CATALOG.length} documented failure modes across{" "}
            {ERROR_CATEGORIES.length} categories. LogLens matches each analysed
            file against these entries, so a report tells you not only that an
            error occurred but what usually causes it.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {(["csv", "json"] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                size="sm"
                onClick={() => {
                  try {
                    const fileName = downloadCatalog(format);
                    toast.success(`Downloaded ${fileName}`);
                  } catch {
                    toast.error("The download could not be started");
                  }
                }}
              >
                <DownloadIcon className="mr-2 h-3.5 w-3.5" />
                Download directory as {format.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search errors, causes or fixes…"
              className="max-w-sm"
              aria-label="Search the error directory"
            />
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["all", `All ${ERROR_CATALOG.length}`],
                  ["critical", "Critical"],
                  ["warning", "Warning"],
                  ["info", "Info"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSeverity(value)}
                  className={
                    severity === value
                      ? "rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
                      : "rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategory("all")}
              className={
                category === "all"
                  ? "rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-xs text-primary"
                  : "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              All categories
            </button>
            {ERROR_CATEGORIES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={
                  category === value
                    ? "rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-xs text-primary"
                    : "rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {CATEGORY_LABEL[value]}
                <span className="ml-1.5 opacity-60">{CATEGORY_COUNTS[value]}</span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          Showing {entries.length} of {ERROR_CATALOG.length} entries
        </p>

        <ul className="mt-4 space-y-3">
          {entries.map((entry) => {
            const open = expanded === entry.id;
            return (
              <li key={entry.id} className="panel overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : entry.id)}
                  className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-medium ${CATEGORY_COLOR[entry.category]}`}
                      >
                        {entry.title}
                      </span>
                      <Badge variant="outline">{CATEGORY_LABEL[entry.category]}</Badge>
                      <Badge
                        variant={
                          entry.severity === "critical"
                            ? "destructive"
                            : entry.severity === "warning"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {entry.severity}
                      </Badge>
                    </span>
                    <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">
                      {entry.languages.join(" · ")}
                    </span>
                    <span className="mt-1.5 block text-sm text-muted-foreground">
                      {entry.reasons[0]}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {open ? "−" : "+"}
                  </span>
                </button>

                {open ? (
                  <div className="grid gap-6 border-t bg-muted/20 px-5 py-5 md:grid-cols-2">
                    <div>
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Why it happens
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                        {entry.reasons.map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span className="text-severity-error">•</span>
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        How to fix it
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm leading-relaxed">
                        {entry.fixes.map((fix) => (
                          <li key={fix} className="flex gap-2">
                            <span className="text-primary">→</span>
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-muted-foreground">
                        Matched by:{" "}
                        <code className="font-mono text-[11px]">
                          {entry.patterns.map((pattern) => pattern.source).join("  ·  ")}
                        </code>
                      </p>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {entries.length === 0 ? (
          <p className="panel mt-4 p-8 text-center text-sm text-muted-foreground">
            Nothing matches that search. Try a broader term, or{" "}
            <Link to="/app" className="text-primary underline-offset-4 hover:underline">
              analyse a log file
            </Link>{" "}
            to see which of these entries it matches.
          </p>
        ) : null}

        <div className="mt-12 panel px-6 py-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            See which of these your logs contain
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Drop a log file on the dashboard. Every entry above is matched
            against your lines, with counts and real examples in the report.
          </p>
          <Button asChild className="mt-6">
            <Link to="/app">Analyze a log file</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
