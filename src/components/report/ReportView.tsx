import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { BarList, HealthGauge, SeverityBar, TimelineChart } from "@/components/report/charts";
import { RawLogViewer } from "@/components/report/RawLogViewer";
import {
  CATALOG_BY_ID,
  CATEGORY_COLOR,
  CATEGORY_LABEL,
} from "@/lib/error-catalog";
import {
  CHECK_GROUP_LABEL,
  FORMAT_LABEL,
  LEVEL_BG,
  LEVEL_LABEL,
  type CheckGroup,
  type CheckStatus,
  type DiagnosticCheck,
  type IssueGroup,
  type LogLevel,
  type LogReport,
} from "@/lib/analyzer";

const LEVEL_ORDER: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace", "unknown"];

const LEVEL_TONE: Record<LogLevel, string> = {
  fatal: "text-severity-fatal border-severity-fatal/40",
  error: "text-severity-error border-severity-error/40",
  warn: "text-severity-warn border-severity-warn/40",
  info: "text-severity-info border-severity-info/40",
  debug: "text-severity-debug border-severity-debug/40",
  trace: "text-severity-trace border-severity-trace/40",
  unknown: "text-muted-foreground border-border",
};

export function ReportView({ report }: { report: LogReport }) {
  const errors = report.levels.error + report.levels.fatal;
  const timeRange = report.timeRange;

  const severitySlices = useMemo(
    () =>
      LEVEL_ORDER.map((level) => ({ level, count: report.levels[level] })).filter(
        (slice) => slice.count > 0,
      ),
    [report.levels],
  );

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------- header */}
      <section className="panel flex flex-wrap items-start justify-between gap-6 p-6">
        <div className="min-w-0">
          <h1 className="truncate font-mono text-xl font-semibold">{report.fileName}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" title={`detected format: ${report.format}`}>
              {FORMAT_LABEL[report.format]}
            </Badge>
            <Badge variant="secondary">
              {Math.round(report.formatConfidence * 100)}% confidence
            </Badge>
            <span className="text-muted-foreground">
              {report.lineCount.toLocaleString()} lines ·{" "}
              {formatSize(report.sizeBytes)} · {report.sampledLines.toLocaleString()} sampled
            </span>
          </div>
          {timeRange ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {new Date(timeRange.start).toLocaleString()} →{" "}
              {new Date(timeRange.end).toLocaleString()} (
              {formatSpan(timeRange.durationMs)})
              {timeRange.outOfOrder ? " · timestamps out of order" : ""}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              No timestamps detected in this file
            </p>
          )}
          {report.formatNotes.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground/80">
              {report.formatNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex items-center gap-5">
          <HealthGauge score={report.healthScore} />
          <div className="space-y-1 text-right text-xs text-muted-foreground">
            <p>
              errors{" "}
              <span className="font-mono text-severity-error">
                {errors.toLocaleString()}
              </span>
            </p>
            <p>
              warnings{" "}
              <span className="font-mono text-severity-warn">
                {report.levels.warn.toLocaleString()}
              </span>
            </p>
            <p>
              groups{" "}
              <span className="font-mono text-foreground">
                {report.issues.length}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- key figures */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Lines analysed"
          value={report.parsedLines.toLocaleString()}
          hint={`${report.lineCount.toLocaleString()} total, ${report.emptyLines.toLocaleString()} blank`}
        />
        <Stat
          label="Error rate"
          value={`${(report.errorRate * 100).toFixed(2)}%`}
          hint={`${errors.toLocaleString()} error and fatal entries`}
          tone="text-severity-error"
        />
        <Stat
          label="Warning rate"
          value={`${(report.warningRate * 100).toFixed(2)}%`}
          hint={`${report.levels.warn.toLocaleString()} warnings`}
          tone="text-severity-warn"
        />
        <Stat
          label="Throughput"
          value={
            report.throughputPerSecond
              ? `${report.throughputPerSecond.toFixed(0)}/s`
              : "n/a"
          }
          hint={
            report.multiLineEntries > 0
              ? `${report.multiLineEntries.toLocaleString()} entries with stack traces`
              : "No stack traces found"
          }
        />
      </section>

      {/* -------------------------------------------------- severity + timeline */}
      <section className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="panel p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Severity mix
          </h2>
          <div className="mt-4">
            <SeverityBar slices={severitySlices} />
          </div>

          {report.unclassifiedLines > 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {report.unclassifiedLines.toLocaleString()} lines carried no
              severity marker and were classified from their wording.
            </p>
          ) : null}

          {report.exceptionTypes.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Exception types
              </h3>
              <BarList
                items={report.exceptionTypes.slice(0, 8).map((entry) => ({
                  label: entry.type,
                  value: entry.count,
                }))}
                emptyLabel="No exception types detected"
              />
            </div>
          ) : null}
        </div>

        <div className="panel p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Activity over time
          </h2>
          <div className="mt-4">
            <TimelineChart buckets={report.timeline} />
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
            {(
              [
                ["error", "bg-severity-error"],
                ["warn", "bg-severity-warn"],
                ["info", "bg-severity-info"],
                ["other", "bg-severity-trace"],
              ] as const
            ).map(([label, tone]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-sm", tone)} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- latency */}
      <LatencySection report={report} />

      {/* ----------------------------------------------------- diagnostics */}
      <DiagnosticsSection report={report} />

      {/* ------------------------------------------------- known problems */}
      {report.knownProblems && report.knownProblems.length > 0 ? (
        <KnownProblems matches={report.knownProblems} />
      ) : null}

      {/* ---------------------------------------------------------- insights */}
      {report.insights.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">
            Insights ({report.insights.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {report.insights.map((insight) => (
              <article
                key={insight.id}
                className={cn(
                  "panel p-5",
                  insight.severity === "critical" && "border-destructive/45",
                  insight.severity === "warning" && "border-severity-warn/45",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3
                    className={cn(
                      "font-medium",
                      insight.severity === "critical"
                        ? "text-destructive"
                        : insight.severity === "warning"
                          ? "text-severity-warn"
                          : "text-severity-info",
                    )}
                  >
                    {insight.title}
                  </h3>
                  <Badge variant="outline">{insight.occurrences.toLocaleString()}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {insight.detail}
                </p>
                <p className="mt-3 flex gap-2 text-sm leading-relaxed">
                  <span className="text-primary">→</span>
                  <span>{insight.recommendation}</span>
                </p>
                {insight.example ? (
                  <pre className="mt-3 overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] text-muted-foreground">
                    {insight.example}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- recommendations */}
      {report.recommendations.length > 0 ? (
        <section className="panel p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            What to do next
          </h2>
          <ol className="mt-4 space-y-2.5">
            {report.recommendations.map((recommendation, index) => (
              <li key={recommendation} className="flex gap-3 text-sm leading-relaxed">
                <span className="font-mono text-xs text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{recommendation}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ------------------------------------------------------ grouped issues */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Grouped issues ({report.issues.length})
        </h2>
        <IssuesTable issues={report.issues} totalLines={report.parsedLines} />
      </section>

      {/* -------------------------------------------------------------- http */}
      {report.http ? (
        <section className="panel p-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            HTTP traffic
          </h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <div className="mb-4">
                <SeverityBar
                  slices={report.http.classes.map((entry) => ({
                    level:
                      entry.class === "5xx"
                        ? "error"
                        : entry.class === "4xx"
                          ? "warn"
                          : "info",
                    count: entry.count,
                  }))}
                />
              </div>
              <BarList
                items={report.http.statuses.slice(0, 8).map((entry) => ({
                  label: String(entry.status),
                  value: entry.count,
                  secondary: entry.errors > 0 ? `${entry.errors} failed` : undefined,
                  tone: entry.status >= 500 ? "bg-severity-error" : entry.status >= 400 ? "bg-severity-warn" : "bg-severity-info",
                }))}
                emptyLabel="No status codes found"
              />
              {report.http.slowest ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Slowest request:{" "}
                  <span className="font-mono text-foreground">
                    {report.http.slowest.path}
                  </span>{" "}
                  in {report.http.slowest.durationMs.toFixed(0)}ms
                </p>
              ) : null}
            </div>

            <div>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Endpoints by error volume
              </h3>
              <BarList
                items={report.http.paths.slice(0, 10).map((path) => ({
                  label: path.path,
                  value: path.errors > 0 ? path.errors : path.count,
                  secondary: `${path.count.toLocaleString()} req${
                    path.maxDurationMs ? ` · max ${path.maxDurationMs.toFixed(0)}ms` : ""
                  }`,
                  tone: path.errors > 0 ? "bg-severity-error" : "bg-severity-info",
                }))}
                emptyLabel="No request paths found"
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------ loggers and sources */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Noisiest components
          </h2>
          <BarList
            items={report.loggers.slice(0, 10).map((logger) => ({
              label: logger.logger,
              value: logger.errors > 0 ? logger.errors : logger.total,
              secondary: `${logger.total.toLocaleString()} total`,
              tone: logger.errors > 0 ? "bg-severity-error" : "bg-muted-foreground/60",
            }))}
            emptyLabel="No logger or component names were detected in this file"
          />
        </div>

        <div className="panel p-6">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Hot source locations
          </h2>
          <BarList
            items={report.sources.slice(0, 10).map((source) => ({
              label: source.location,
              value: source.count,
            }))}
            emptyLabel="No file:line references were found"
          />
        </div>
      </section>

      {/* ------------------------------------------------------- raw log view */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Log lines</h2>
        <RawLogViewer report={report} />
      </section>
    </div>
  );
}

/**
 * Directory entries that this file matched, with the reasons and fixes from the
 * error directory resolved at render time (the report only stores identities
 * and counts, so it never goes stale).
 */
function KnownProblems({
  matches,
}: {
  matches: NonNullable<LogReport["knownProblems"]>;
}) {
  const [openId, setOpenId] = useState<string | null>(matches[0]?.catalogId ?? null);
  const entries = matches
    .map((match) => ({ match, entry: CATALOG_BY_ID.get(match.catalogId) }))
    .filter((item): item is { match: (typeof matches)[number]; entry: NonNullable<ReturnType<typeof CATALOG_BY_ID.get>> } =>
      Boolean(item.entry),
    );

  const totalOccurrences = matches.reduce((sum, match) => sum + match.occurrences, 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Known problems ({entries.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          {totalOccurrences.toLocaleString()} lines match the error directory ·{" "}
          <Link to="/errors" className="text-primary underline-offset-4 hover:underline">
            browse all entries
          </Link>
        </p>
      </div>

      <div className="panel divide-y overflow-hidden">
        {entries.map(({ match, entry }) => {
          const open = openId === entry.id;
          return (
            <article key={entry.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : entry.id)}
                className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium", CATEGORY_COLOR[entry.category])}>
                      {entry.title}
                    </span>
                    <Badge variant="outline">
                      {CATEGORY_LABEL[entry.category]}
                    </Badge>
                  </span>
                  <span className="mt-1.5 block text-xs text-muted-foreground">
                    {entry.reasons[0]}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm">
                    {match.occurrences.toLocaleString()}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {open ? "hide" : "why?"}
                  </span>
                </span>
              </button>

              {open ? (
                <div className="space-y-5 bg-muted/20 px-5 py-5">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Why it happens
                      </h4>
                      <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed">
                        {entry.reasons.map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span className="text-severity-error">•</span>
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        How to fix it
                      </h4>
                      <ul className="mt-2.5 space-y-1.5 text-sm leading-relaxed">
                        {entry.fixes.map((fix) => (
                          <li key={fix} className="flex gap-2">
                            <span className="text-primary">→</span>
                            <span>{fix}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {match.example ? (
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Seen in this file
                      </h4>
                      <pre className="mt-2 overflow-x-auto rounded-md border bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {match.example}
                      </pre>
                    </div>
                  ) : null}

                  <Link
                    to="/errors"
                    className="inline-block text-xs text-primary underline-offset-4 hover:underline"
                  >
                    Open “{entry.title}” in the error directory →
                  </Link>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Percentile table + slowest operations, or an explanation of why it is empty. */
function LatencySection({ report }: { report: LogReport }) {
  const latency = report.latency;
  const [showAll, setShowAll] = useState(false);

  const fmt = (value: number) => {
    if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
    return `${Math.round(value)}ms`;
  };

  if (!latency || latency.samples === 0) {
    const httpRequests = report.http?.total ?? 0;
    return (
      <section className="panel p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Latency
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          No durations were found in this file, so latency could not be measured.
          {httpRequests > 0
            ? ` ${httpRequests.toLocaleString()} HTTP lines were found but none of them carries a response time.`
            : ""}{" "}
          LogLens reads <code className="font-mono text-xs">took 1.2s</code>,{" "}
          <code className="font-mono text-xs">duration=340ms</code>,{" "}
          <code className="font-mono text-xs">(12ms)</code>,{" "}
          <code className="font-mono text-xs">$request_time</code> and a{" "}
          <code className="font-mono text-xs">durationMs</code> field — add one of
          them and the percentile breakdown below appears automatically.
        </p>
      </section>
    );
  }

  const operations = showAll ? latency.operations : latency.operations.slice(0, 8);
  const worstP95 = Math.max(...latency.operations.map((op) => op.p95), 1);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Latency</h2>
        <p className="text-xs text-muted-foreground">
          {latency.samples.toLocaleString()} timings recovered from the file ·
          budget 1s
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Median (p50)" value={fmt(latency.p50)} hint={`avg ${fmt(latency.avg)}`} />
        <Stat
          label="p95"
          value={fmt(latency.p95)}
          hint={`p90 ${fmt(latency.p90)}`}
          tone={latency.p95 > 1000 ? "text-severity-warn" : undefined}
        />
        <Stat
          label="p99"
          value={fmt(latency.p99)}
          hint={`max ${fmt(latency.max)}`}
          tone={latency.p99 > 1000 ? "text-severity-warn" : undefined}
        />
        <Stat
          label="Over budget"
          value={latency.overBudget.toLocaleString()}
          hint={`${(latency.overBudgetRate * 100).toFixed(1)}% of timings · ${latency.severe} over 5s`}
          tone={latency.overBudget > 0 ? "text-severity-error" : undefined}
        />
      </div>

      {latency.operations.length > 0 ? (
        <div className="panel p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Slowest operations
            </h3>
            {latency.operations.length > 8 ? (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                {showAll ? "Show fewer" : `Show all ${latency.operations.length}`}
              </button>
            ) : null}
          </div>

          <div className="mt-4 space-y-3">
            {operations.map((op) => (
              <div key={op.name} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs" title={op.name}>
                    {op.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    p50 {fmt(op.p50)} · p95 {fmt(op.p95)} · max {fmt(op.max)} ·{" "}
                    {op.samples.toLocaleString()} samples
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      op.p95 > 1000 ? "bg-severity-error" : "bg-primary",
                    )}
                    style={{ width: `${Math.max(2, (op.p95 / worstP95) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {latency.http ? (
        <p className="text-xs text-muted-foreground">
          HTTP response times: {latency.http.samples.toLocaleString()} of{" "}
          {latency.http.requests.toLocaleString()} request lines (
          {(latency.http.coverage * 100).toFixed(0)}% coverage, p95{" "}
          {fmt(latency.http.p95)})
        </p>
      ) : null}
    </section>
  );
}

const CHECK_TONE: Record<CheckStatus, string> = {
  fail: "border-destructive/50 text-destructive",
  warn: "border-severity-warn/50 text-severity-warn",
  pass: "border-border text-muted-foreground",
  unknown: "border-border text-muted-foreground",
};

const CHECK_ORDER: CheckStatus[] = ["fail", "warn", "unknown", "pass"];

/** Every automated diagnostic, grouped by area, worst first. */
function DiagnosticsSection({ report }: { report: LogReport }) {
  const checks = report.checks ?? [];
  const [onlyProblems, setOnlyProblems] = useState(true);
  if (checks.length === 0) return null;

  const counts = CHECK_ORDER.reduce<Record<string, number>>((acc, status) => {
    acc[status] = checks.filter((check) => check.status === status).length;
    return acc;
  }, {});

  const visible = onlyProblems
    ? checks.filter((check) => check.status === "fail" || check.status === "warn")
    : checks;

  const groups = new Map<CheckGroup, DiagnosticCheck[]>();
  for (const check of visible) {
    const list = groups.get(check.group) ?? [];
    list.push(check);
    groups.set(check.group, list);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Diagnostic checks ({checks.length})
        </h2>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {CHECK_ORDER.map((status) =>
            counts[status] ? (
              <span key={status} className={cn("font-medium", CHECK_TONE[status])}>
                {counts[status]} {status}
              </span>
            ) : null,
          )}
          <button
            type="button"
            onClick={() => setOnlyProblems((value) => !value)}
            className="text-primary underline-offset-4 hover:underline"
          >
            {onlyProblems ? "Show every check" : "Show problems only"}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="panel p-6 text-sm text-muted-foreground">
          Every automated check passed. Nothing in this file matched a known
          failure mode — switch to &ldquo;Show every check&rdquo; to see what was
          looked for.
        </div>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([group, items]) => (
            <div key={group} className="panel p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                {CHECK_GROUP_LABEL[group]}
              </h3>
              <ul className="mt-4 space-y-4">
                {items.map((check) => (
                  <li key={check.id} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("uppercase", CHECK_TONE[check.status])}>
                        {check.status}
                      </Badge>
                      <span className="font-medium">{check.title}</span>
                    </div>
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {check.detail}
                    </p>
                    {check.evidence ? (
                      <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] text-muted-foreground">
                        {check.evidence}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="panel p-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-mono text-2xl font-semibold", tone)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function IssuesTable({
  issues,
  totalLines,
}: {
  issues: IssueGroup[];
  totalLines: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(issues[0]?.id ?? null);
  const [filter, setFilter] = useState<"all" | "error" | "warn">("all");

  const visible = issues.filter((issue) => {
    if (filter === "error") {
      return issue.level === "error" || issue.level === "fatal";
    }
    if (filter === "warn") return issue.level === "warn";
    return true;
  });

  if (issues.length === 0) {
    return (
      <div className="panel p-6 text-sm text-muted-foreground">
        No recurring message groups were found. Use the log lines section below
        to inspect the raw content.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 border-b px-5 py-3">
        {(
          [
            ["all", `All ${issues.length}`],
            ["error", "Errors"],
            ["warn", "Warnings"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-md px-3 py-1 text-xs transition-colors",
              filter === value
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="divide-y">
        {visible.slice(0, 40).map((issue) => {
          const open = expanded === issue.id;
          return (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : issue.id)}
                className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
              >
                <span
                  className={cn(
                    "mt-0.5 w-20 shrink-0 rounded border px-2 py-0.5 text-center text-[10px] uppercase tracking-wide",
                    LEVEL_TONE[issue.level],
                  )}
                >
                  {LEVEL_LABEL[issue.level]}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm">
                    {issue.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>
                      lines {issue.firstIndex + 1}–{issue.lastIndex + 1}
                    </span>
                    {issue.loggers.length > 0 ? <span>{issue.loggers.join(", ")}</span> : null}
                    {issue.frames.length > 0 ? (
                      <span className="font-mono">
                        {issue.frames[0]?.file}
                        {issue.frames[0]?.line ? `:${issue.frames[0].line}` : ""}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full", LEVEL_BG[issue.level])}
                      style={{
                        width: `${totalLines ? Math.max(2, (issue.count / totalLines) * 100) : 2}%`,
                      }}
                    />
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm">
                    {issue.count.toLocaleString()}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {(issue.share * 100).toFixed(1)}%
                  </span>
                </span>
              </button>

              {open ? (
                <div className="space-y-4 border-t bg-muted/20 px-5 py-4">
                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Normalised pattern
                    </p>
                    <pre className="overflow-x-auto rounded-md border bg-background/60 p-2.5 font-mono text-[11px] text-muted-foreground">
                      {issue.pattern}
                    </pre>
                  </div>

                  {issue.frames.length > 0 ? (
                    <div>
                      <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Stack trace
                      </p>
                      <ol className="space-y-1">
                        {issue.frames.map((frame, index) => (
                          <li
                            key={`${frame.raw}-${index}`}
                            className="font-mono text-[11px] leading-relaxed"
                          >
                            <span className="text-muted-foreground">
                              {String(index).padStart(2, "0")}
                            </span>{" "}
                            {frame.functionName ? (
                              <span className="text-severity-info">
                                {frame.functionName}
                              </span>
                            ) : null}
                            {frame.file ? (
                              <span className="text-muted-foreground">
                                {" "}
                                ({frame.file}
                                {frame.line ? `:${frame.line}` : ""})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Example lines
                    </p>
                    <pre className="overflow-x-auto rounded-md border bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {issue.samples.map((sample) => sample.raw).join("\n")}
                    </pre>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {visible.length > 40 ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Showing the top 40 of {visible.length} groups. The full breakdown is in
          the report JSON.
        </p>
      ) : null}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatSpan(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
