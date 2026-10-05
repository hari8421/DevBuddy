/**
 * Report export.
 *
 * Every serializer is a pure function from `LogReport` to a string, which keeps
 * them unit-testable and lets the same output be downloaded, copied or shown in
 * a preview. Nothing here touches the network or the file system — the only
 * side effect lives in `downloadReport`, which hands the string to the browser
 * as a blob so the report never leaves the device.
 */

import { CATALOG_BY_ID, CATEGORY_LABEL, ERROR_CATALOG } from "@/lib/error-catalog";
import {
  FORMAT_LABEL,
  LEVEL_LABEL,
  type Insight,
  type LogReport,
} from "@/lib/analyzer";

export type ReportExportFormat = "json" | "csv" | "markdown" | "html";

export interface ExportFormatInfo {
  id: ReportExportFormat;
  label: string;
  extension: string;
  mime: string;
  description: string;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  {
    id: "json",
    label: "JSON",
    extension: "report.json",
    mime: "application/json",
    description: "The complete report object, ready for scripts and dashboards.",
  },
  {
    id: "csv",
    label: "CSV",
    extension: "issues.csv",
    mime: "text/csv",
    description: "One row per grouped issue, with counts, shares and matching directory entries.",
  },
  {
    id: "markdown",
    label: "Markdown",
    extension: "report.md",
    mime: "text/markdown",
    description: "A readable triage write-up for a ticket, PR description or chat.",
  },
  {
    id: "html",
    label: "Standalone HTML",
    extension: "report.html",
    mime: "text/html",
    description: "A self-contained report page you can email or attach to an incident.",
  },
];

export function formatInfo(format: ReportExportFormat): ExportFormatInfo {
  return (
    EXPORT_FORMATS.find((info) => info.id === format) ?? EXPORT_FORMATS[0]
  );
}

/* ------------------------------------------------------------------ helpers */

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function ms(value: number): string {
  if (value >= 60_000) return `${(value / 60_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function stamp(value: number): string {
  return new Date(value).toISOString().replace("T", " ").replace("Z", " UTC");
}



function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Directory entry attached to each grouped issue. `knownProblems.issueIds` is
 * the only link between a report issue group and the directory, so the map is
 * rebuilt here rather than duplicated in the report itself.
 */
function directoryLabels(report: LogReport): Map<string, string> {
  const labels = new Map<string, string>();
  for (const problem of report.knownProblems) {
    for (const issueId of problem.issueIds) {
      labels.set(issueId, `${problem.category}: ${problem.title}`);
    }
  }
  return labels;
}

/* -------------------------------------------------------------------- JSON */

export function reportToJson(report: LogReport): string {
  return JSON.stringify(report, null, 2);
}

/* --------------------------------------------------------------------- CSV */

const CSV_HEADER = [
  "level",
  "count",
  "share",
  "title",
  "exception_type",
  "first_line",
  "last_line",
  "first_seen",
  "last_seen",
  "duration_in_file",
  "loggers",
  "top_frame",
  "directory_entry",
  "sample_line",
];

/** One row per grouped issue, ranked exactly as the report shows them. */
export function reportToCsv(report: LogReport): string {
  const rows = [csvRow(CSV_HEADER)];
  const labels = directoryLabels(report);

  for (const issue of report.issues) {
    rows.push(
      csvRow([
        LEVEL_LABEL[issue.level],
        issue.count,
        issue.share.toFixed(5),
        issue.title,
        issue.exceptionType ?? "",
        issue.firstIndex + 1,
        issue.lastIndex + 1,
        issue.firstSeen ? new Date(issue.firstSeen).toISOString() : "",
        issue.lastSeen ? new Date(issue.lastSeen).toISOString() : "",
        issue.firstSeen && issue.lastSeen ? ms(issue.lastSeen - issue.firstSeen) : "",
        issue.loggers.join(" | "),
        issue.frames[0]?.raw ?? "",
        labels.get(issue.id) ?? "",
        issue.samples[0]?.raw ?? "",
      ]),
    );
  }

  return `${rows.join("\n")}\n`;
}

/* ---------------------------------------------------------------- Markdown */

function markdownInsight(insight: Insight, index: number): string {
  const lines = [
    `${index + 1}. **${insight.title}** (${insight.severity}, ${insight.occurrences} line${insight.occurrences === 1 ? "" : "s"})`,
    `   ${insight.detail}`,
    `   _Fix:_ ${insight.recommendation}`,
  ];
  if (insight.example) lines.push(`   _Example:_ \`${insight.example.slice(0, 300)}\``);
  return lines.join("\n");
}

export function reportToMarkdown(report: LogReport): string {
  const errors = report.levels.error + report.levels.fatal;
  const out: string[] = [];

  out.push(`# LogLens report — ${report.fileName}`);
  out.push("");
  out.push(`Generated ${stamp(report.analyzedAt)} · LogLens`);
  out.push("");

  out.push("## Summary");
  out.push("");
  out.push("| Metric | Value |");
  out.push("| --- | --- |");
  out.push(`| File size | ${(report.sizeBytes / 1024).toFixed(1)} KiB |`);
  out.push(`| Lines | ${report.lineCount.toLocaleString()} |`);
  out.push(`| Detected format | ${FORMAT_LABEL[report.format]} (${pct(report.formatConfidence, 0)} confidence) |`);
  out.push(`| Errors / fatals | ${errors.toLocaleString()} (${pct(report.errorRate, 2)}) |`);
  out.push(`| Warnings | ${report.levels.warn.toLocaleString()} (${pct(report.warningRate, 2)}) |`);
  out.push(`| Distinct issue groups | ${report.issues.length} |`);
  out.push(`| Directory matches | ${report.knownProblems.length} |`);
  out.push(`| Health score | ${report.healthScore}/100 |`);
  if (report.timeRange) {
    out.push(
      `| Time range | ${stamp(report.timeRange.start)} → ${stamp(report.timeRange.end)} (${ms(report.timeRange.durationMs)}) |`,
    );
  }
  if (report.throughputPerSecond) {
    out.push(`| Throughput | ${report.throughputPerSecond.toFixed(1)} lines/s |`);
  }
  out.push("");

  if (report.latency) {
    const { latency } = report;
    out.push("## Latency");
    out.push("");
    out.push(`- Timings found: **${latency.samples}** across **${latency.operations.length}** operations`);
    out.push(
      `- Median **${ms(latency.p50)}** · p95 **${ms(latency.p95)}** · p99 **${ms(latency.p99)}** · max **${ms(latency.max)}**`,
    );
    out.push(`- Over the 1s budget: **${latency.overBudget}** samples (${pct(latency.overBudgetRate)})`);
    if (latency.operations.length > 0) {
      out.push("");
      out.push("| Operation | Samples | Median | p95 | Max |");
      out.push("| --- | --- | --- | --- | --- |");
      for (const op of latency.operations) {
        out.push(
          `| ${op.name} | ${op.samples} | ${ms(op.p50)} | ${ms(op.p95)} | ${ms(op.max)} |`,
        );
      }
    }
    out.push("");
  }

  if (report.insights.length > 0) {
    out.push("## Findings");
    out.push("");
    report.insights.forEach((insight, index) => out.push(markdownInsight(insight, index)));
    out.push("");
  }

  if (report.recommendations.length > 0) {
    out.push("## Recommended order of work");
    out.push("");
    report.recommendations.forEach((text, index) => out.push(`${index + 1}. ${text}`));
    out.push("");
  }

  if (report.knownProblems.length > 0) {
    out.push("## Error directory matches");
    out.push("");
    for (const problem of report.knownProblems) {
      const entry = CATALOG_BY_ID.get(problem.catalogId);
      out.push(`### ${problem.title} — ${problem.occurrences} line(s)`);
      out.push("");
      if (problem.example) out.push(`> ${problem.example.slice(0, 300)}`);
      out.push("");
      if (entry) {
        if (entry.reasons.length > 0) {
          out.push("**Why it happens**");
          out.push("");
          entry.reasons.forEach((reason) => out.push(`- ${reason}`));
          out.push("");
        }
        if (entry.fixes.length > 0) {
          out.push("**How to fix it**");
          out.push("");
          entry.fixes.forEach((fix) => out.push(`- ${fix}`));
          out.push("");
        }
      }
    }
  }

  if (report.checks.length > 0) {
    out.push("## Diagnostic checks");
    out.push("");
    out.push("| Check | Status | Detail |");
    out.push("| --- | --- | --- |");
    for (const check of report.checks) {
      out.push(`| ${check.title} | ${check.status.toUpperCase()} | ${check.detail} |`);
    }
    out.push("");
  }

  out.push("## Top issue groups");
  out.push("");
  out.push("| # | Level | Count | Title | Exception |");
  out.push("| --- | --- | --- | --- | --- |");
  report.issues.slice(0, 25).forEach((issue, index) => {
    out.push(
      `| ${index + 1} | ${LEVEL_LABEL[issue.level]} | ${issue.count} | ${issue.title.replace(/\|/g, "\\|").slice(0, 140)} | ${issue.exceptionType ?? ""} |`,
    );
  });
  out.push("");

  if (report.http) {
    out.push("## HTTP");
    out.push("");
    out.push(
      `- ${report.http.total.toLocaleString()} requests · ${pct(report.http.errorRate, 2)} returned 5xx`,
    );
    out.push("");
    if (report.http.paths.length > 0) {
      out.push("| Path | Requests | 5xx | Avg | Max |");
      out.push("| --- | --- | --- | --- | --- |");
      for (const path of report.http.paths.slice(0, 15)) {
        out.push(
          `| ${path.path} | ${path.count} | ${path.errors} | ${path.avgDurationMs ? ms(path.avgDurationMs) : "—"} | ${path.maxDurationMs ? ms(path.maxDurationMs) : "—"} |`,
        );
      }
      out.push("");
    }
  }

  out.push("---");
  out.push("");
  out.push(
    "Produced locally by LogLens. The log file itself was never uploaded — only this summary left the browser.",
  );

  return `${out.join("\n")}\n`;
}

/* -------------------------------------------------------------------- HTML */

const HTML_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 2.5rem 1.5rem; font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; background: #f8fafc; }
main { max-width: 60rem; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.1rem; margin: 2.25rem 0 .75rem; padding-bottom: .35rem; border-bottom: 1px solid #e2e8f0; }
h3 { font-size: .95rem; margin: 1.25rem 0 .35rem; }
.sub { color: #64748b; font-size: .85rem; margin-bottom: 1.5rem; }
table { border-collapse: collapse; width: 100%; font-size: .85rem; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; }
.grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: .6rem; padding: .75rem .9rem; }
.card .k { font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
.card .v { font-size: 1.15rem; font-weight: 600; }
.tag { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.critical { background: #fee2e2; color: #991b1b; }
.warning { background: #fef3c7; color: #92400e; }
.info { background: #dbeafe; color: #1e40af; }
.pass { background: #dcfce7; color: #166534; }
.fail { background: #fee2e2; color: #991b1b; }
.unknown { background: #e2e8f0; color: #475569; }
.item { background: #fff; border: 1px solid #e2e8f0; border-radius: .6rem; padding: .9rem 1rem; margin-bottom: .6rem; }
.item h3 { margin: 0 0 .3rem; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
.item p { margin: .25rem 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem; }
pre { background: #0f172a; color: #e2e8f0; padding: .6rem .8rem; border-radius: .5rem; overflow-x: auto; }
ul { margin: .3rem 0; padding-left: 1.2rem; }
ol { margin: .3rem 0; padding-left: 1.3rem; }
footer { margin-top: 3rem; color: #64748b; font-size: .78rem; }
@media (prefers-color-scheme: dark) {
  body { background: #0b1120; color: #e2e8f0; }
  h2 { border-color: #1e293b; }
  th, td { border-color: #1e293b; }
  th { background: #111c33; }
  .card, .item { background: #0f172a; border-color: #1e293b; }
}
`;

/** A single self-contained page: no external requests, safe to attach anywhere. */
export function reportToHtml(report: LogReport): string {
  const errors = report.levels.error + report.levels.fatal;
  const card = (k: string, v: string) =>
    `<div class="card"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`;

  const cards = [
    card("Lines", report.lineCount.toLocaleString()),
    card("Errors", `${errors.toLocaleString()} (${pct(report.errorRate, 2)})`),
    card("Warnings", report.levels.warn.toLocaleString()),
    card("Issue groups", String(report.issues.length)),
    card("Directory matches", String(report.knownProblems.length)),
    card("Health score", `${report.healthScore}/100`),
  ].join("\n");

  const latency = report.latency
    ? `<h2>Latency</h2>
<p><strong>${report.latency.samples}</strong> timings across <strong>${report.latency.operations.length}</strong> operations — median <strong>${ms(report.latency.p50)}</strong>, p95 <strong>${ms(report.latency.p95)}</strong>, p99 <strong>${ms(report.latency.p99)}</strong>, max <strong>${ms(report.latency.max)}</strong>. ${report.latency.overBudget} samples (${pct(report.latency.overBudgetRate)}) exceeded 1s.</p>
${
  report.latency.operations.length > 0
    ? `<table><thead><tr><th>Operation</th><th>Samples</th><th>Median</th><th>p95</th><th>Max</th></tr></thead><tbody>${report.latency.operations
        .map(
          (op) =>
            `<tr><td>${escapeHtml(op.name)}</td><td>${op.samples}</td><td>${ms(op.p50)}</td><td>${ms(op.p95)}</td><td>${ms(op.max)}</td></tr>`,
        )
        .join("\n")}</tbody></table>`
    : ""
}`
    : "";

  const findings = report.insights.length
    ? `<h2>Findings</h2>\n${report.insights
        .map(
          (insight) =>
            `<div class="item"><h3><span class="tag ${insight.severity}">${insight.severity}</span> ${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.detail)}</p><p><strong>Fix:</strong> ${escapeHtml(insight.recommendation)}</p>${
              insight.example ? `<pre>${escapeHtml(insight.example.slice(0, 400))}</pre>` : ""
            }</div>`,
        )
        .join("\n")}`
    : "";

  const recommendations = report.recommendations.length
    ? `<h2>Recommended order of work</h2><ol>${report.recommendations
        .map((text) => `<li>${escapeHtml(text)}</li>`)
        .join("")}</ol>`
    : "";

  const problems = report.knownProblems.length
    ? `<h2>Error directory matches</h2>${report.knownProblems
        .map((problem) => {
          const entry = CATALOG_BY_ID.get(problem.catalogId);
          return `<div class="item"><h3><span class="tag ${problem.severity}">${problem.severity}</span> ${escapeHtml(
            problem.title,
          )} <span class="k">${problem.occurrences} line(s)</span></h3>${
            problem.example ? `<pre>${escapeHtml(problem.example.slice(0, 400))}</pre>` : ""
          }${
            entry?.reasons.length
              ? `<p><strong>Why it happens</strong></p><ul>${entry.reasons
                  .map((reason) => `<li>${escapeHtml(reason)}</li>`)
                  .join("")}</ul>`
              : ""
          }${
            entry?.fixes.length
              ? `<p><strong>How to fix it</strong></p><ul>${entry.fixes
                  .map((fix) => `<li>${escapeHtml(fix)}</li>`)
                  .join("")}</ul>`
              : ""
          }</div>`;
        })
        .join("\n")}`
    : "";

  const checks = report.checks.length
    ? `<h2>Diagnostic checks</h2><table><thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead><tbody>${report.checks
        .map(
          (check) =>
            `<tr><td>${escapeHtml(check.title)}</td><td><span class="tag ${check.status}">${check.status}</span></td><td>${escapeHtml(check.detail)}</td></tr>`,
        )
        .join("\n")}</tbody></table>`
    : "";

  const issues = report.issues.length
    ? `<h2>Top issue groups</h2><table><thead><tr><th>#</th><th>Level</th><th>Count</th><th>Title</th><th>Exception</th></tr></thead><tbody>${report.issues
        .slice(0, 30)
        .map(
          (issue, index) =>
            `<tr><td>${index + 1}</td><td>${LEVEL_LABEL[issue.level]}</td><td>${issue.count}</td><td>${escapeHtml(
              issue.title.slice(0, 160),
            )}</td><td>${escapeHtml(issue.exceptionType ?? "")}</td></tr>`,
        )
        .join("\n")}</tbody></table>`
    : "";

  const http = report.http
    ? `<h2>HTTP</h2><p>${report.http.total.toLocaleString()} requests · ${pct(
        report.http.errorRate,
        2,
      )} returned 5xx.</p><table><thead><tr><th>Path</th><th>Requests</th><th>5xx</th><th>Avg</th><th>Max</th></tr></thead><tbody>${report.http.paths
        .slice(0, 20)
        .map(
          (path) =>
            `<tr><td>${escapeHtml(path.path)}</td><td>${path.count}</td><td>${path.errors}</td><td>${
              path.avgDurationMs ? ms(path.avgDurationMs) : "—"
            }</td><td>${path.maxDurationMs ? ms(path.maxDurationMs) : "—"}</td></tr>`,
        )
        .join("\n")}</tbody></table>`
    : "";

  const range = report.timeRange
    ? `${stamp(report.timeRange.start)} → ${stamp(report.timeRange.end)} (${ms(report.timeRange.durationMs)})`
    : "no timestamps found";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LogLens report — ${escapeHtml(report.fileName)}</title>
<style>${HTML_CSS}</style>
</head>
<body>
<main>
<h1>LogLens report — ${escapeHtml(report.fileName)}</h1>
<p class="sub">${escapeHtml(FORMAT_LABEL[report.format])} · ${escapeHtml(range)} · generated ${escapeHtml(
    stamp(report.analyzedAt),
  )}</p>
<div class="grid">
${cards}
</div>
${latency}
${findings}
${recommendations}
${problems}
${checks}
${issues}
${http}
<footer>Produced locally by LogLens — the log file was analysed in the browser and never uploaded.</footer>
</main>
</body>
</html>
`;
}

/* ---------------------------------------------------------------- dispatch */

/** Serialize a report in any supported export format. */
export function serializeReport(
  report: LogReport,
  format: ReportExportFormat,
): string {
  switch (format) {
    case "csv":
      return reportToCsv(report);
    case "markdown":
      return reportToMarkdown(report);
    case "html":
      return reportToHtml(report);
    case "json":
    default:
      return reportToJson(report);
  }
}

/** `orders.log` → `orders.report.md`. */
export function exportFileName(
  report: LogReport,
  format: ReportExportFormat,
): string {
  const base = report.fileName.replace(/\.[^.]+$/, "") || "log";
  return `${base}.${formatInfo(format).extension}`;
}

/** Trigger a browser download of the serialized report. */
export function downloadReport(
  report: LogReport,
  format: ReportExportFormat,
): string {
  const info = formatInfo(format);
  const fileName = exportFileName(report, format);
  downloadText(fileName, serializeReport(report, format), info.mime);
  return fileName;
}

/** Copy text to the clipboard, falling back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A compact one-screen summary, handy for a chat message or a PR comment. */
export function reportToSummary(report: LogReport): string {
  const errors = report.levels.error + report.levels.fatal;
  const top = report.insights.slice(0, 3).map((insight) => `- ${insight.title}`);
  const lines = [
    `LogLens — ${report.fileName}`,
    `${report.lineCount.toLocaleString()} lines · ${errors.toLocaleString()} errors (${pct(report.errorRate, 2)}) · ${report.levels.warn.toLocaleString()} warnings · health ${report.healthScore}/100`,
  ];
  if (report.latency && report.latency.samples > 0) {
    lines.push(
      `Latency p50 ${ms(report.latency.p50)} · p95 ${ms(report.latency.p95)} · max ${ms(report.latency.max)} (${report.latency.samples} timings)`,
    );
  }
  if (report.http) {
    lines.push(
      `HTTP ${report.http.total.toLocaleString()} requests · ${pct(report.http.errorRate, 2)} 5xx`,
    );
  }
  if (top.length > 0) {
    lines.push("Top findings:", ...top);
  }
  if (report.knownProblems.length > 0) {
    lines.push(
      `Directory matches: ${report.knownProblems
        .slice(0, 4)
        .map((problem) => problem.title)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** Menu label for a format, e.g. `Markdown (report.md)`. */
export function exportLabel(format: ReportExportFormat): string {
  const found = EXPORT_FORMATS.find((info) => info.id === format);
  return found ? `${found.label} · ${found.extension}` : format;
}

/* -------------------------------------------------------- error directory */

export type CatalogExportFormat = "csv" | "json";

/** The whole error directory as a spreadsheet: one row per entry. */
export function catalogToCsv(): string {
  const rows = [
    csvRow(["id", "category", "severity", "title", "languages", "reasons", "fixes", "patterns"]),
  ];
  for (const entry of ERROR_CATALOG) {
    rows.push(
      csvRow([
        entry.id,
        CATEGORY_LABEL[entry.category],
        entry.severity,
        entry.title,
        entry.languages.join(" | "),
        entry.reasons.join(" | "),
        entry.fixes.join(" | "),
        entry.patterns.map((pattern) => pattern.source).join(" | "),
      ]),
    );
  }
  return `${rows.join("\n")}\n`;
}

/** The directory as JSON, for tooling that wants to embed or search it. */
export function catalogToJson(): string {
  return JSON.stringify(
    ERROR_CATALOG.map((entry) => ({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      categoryLabel: CATEGORY_LABEL[entry.category],
      severity: entry.severity,
      languages: entry.languages,
      reasons: entry.reasons,
      fixes: entry.fixes,
      patterns: entry.patterns.map((pattern) => pattern.source),
    })),
    null,
    2,
  );
}

/** Download the directory itself, for reading offline or importing elsewhere. */
export function downloadCatalog(format: CatalogExportFormat): string {
  const csv = format === "csv";
  const fileName = csv ? "loglens-error-directory.csv" : "loglens-error-directory.json";
  const content = csv ? catalogToCsv() : catalogToJson();
  downloadText(fileName, content, csv ? "text/csv" : "application/json");
  return fileName;
}

/** Save generated text as a file, entirely in the browser. */
export function downloadText(
  fileName: string,
  content: string,
  mime: string,
): string {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}