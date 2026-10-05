# LogLens

**Drop in any log file, get a real triage report.** LogLens parses application,
server and system logs in your browser and turns them into something you can act
on: a severity breakdown, identical errors grouped by fingerprint, decoded stack
traces, a timeline, HTTP statistics — and, for every error it recognises, an
explanation of **why it happens** and **how to fix it** from a built-in error
directory.

- **No sign-up, no sign-in, no backend.** Nothing is uploaded; reports are saved
  in your own browser.
- **Runs anywhere a browser runs** — macOS, Windows and Linux.

---

## What it does

| | |
| --- | --- |
| **Format detection** | Samples the file first and picks a parser: JSON Lines, Apache/Nginx access logs, syslog (RFC 3164/5424), delimited text, or generic. The report shows the detected format and a confidence score. |
| **Severity detection** | Reads `[ERROR]`, `ERROR:`, `level=warn`, `WARNING:root:`, Log4j/Logback layouts, syslog priorities and numeric severities. Lines with no marker are classified from their wording, and the report tells you how many those were. |
| **Fingerprint grouping** | Messages that differ only by an id, duration, hex pointer, path or quoted payload collapse into one group with a count, so 20,000 identical failures read as one problem. |
| **Stack traces** | Java/Kotlin, JavaScript/Node, Python, Go, .NET and Ruby frames are parsed into function, file and line. `Caused by:` chains and Python tracebacks attach to the right error. |
| **Error directory** | A catalogue of **102 failure modes across 19 categories** — each with the reasons behind it and the fixes that work. Every report is matched against it and shows which entries your file contains, how often, with a real example line. |
| **Latency analysis** | Durations are recovered from `took 1.2s`, `duration=340ms`, `(12ms)`, `$request_time` or a `durationMs` field, then reported as p50/p90/p95/p99, budget overruns and a ranked list of the slowest operations. |
| **Diagnostic checks** | Every file is run against **53 fixed checks** (crashes, pools, locks, queues, TLS, secrets, migrations, probes, logging hygiene …). The report shows each one — passed, warned or failed — so "nothing found" is never confused with "nothing checked". |
| **Timeline** | Activity is bucketed automatically (seconds → weeks) with error/warn/info lanes, plus throughput and the observed time range. |
| **HTTP breakdown** | Access logs become status-class distributions and per-endpoint error rates, with numeric ids parameterised (`/api/orders/12` → `/api/orders/:id`). |
| **Insights** | Built-in detectors recognise memory exhaustion, timeouts, connection failures, database problems, crashes, auth failures, rate limiting, retry storms, DNS/TLS issues, corruption, GC pressure, lock waits, circuit breakers, container restarts and slow paths — each with a next step. |
| **Download** | Any report exports as **JSON, CSV, Markdown or a standalone HTML page**, plus a short chat/ticket summary; the error directory itself exports as CSV/JSON. All generated in the browser. |
| **Raw viewer** | Search and filter the retained log lines by severity, with line numbers. |
| **Local by design** | Parsing happens in the browser tab and the report is saved to local storage. There is no server component at all. |

## Screens

- **Landing page** (`/`) — what LogLens does, supported formats, an example report and FAQ.
- **Error directory** (`/errors`) — every documented failure mode, searchable and filterable by category and severity, each with reasons and fixes.
- **Dashboard** (`/app`) — drag-and-drop upload, folder upload, bundled samples and the reports saved in this browser.
- **Report** (`/app/analysis/:id`) — KPIs, severity mix, timeline, **known problems with causes and fixes**, insights, recommendations, grouped issues, HTTP panel, latency section, diagnostics, noisiest components, hot source locations and raw lines, plus a copy-summary button and a download menu (JSON, CSV, Markdown, HTML).

## Quick start

### Requirements

**Node.js 18.17+ or newer** (20+ recommended) — or [Bun](https://bun.sh).

There is no backend to install, no account to create and no environment variable
to set. Clone, install, run.

### macOS / Linux

```bash
git clone <your-repo-url> loglens
cd loglens
bun install          # or: npm install
bun run dev          # or: npm run dev
```

### Windows (PowerShell or cmd)

```powershell
git clone <your-repo-url> loglens
cd loglens
bun install          # or: npm install
bun run dev          # or: npm run dev
```

Vite prints a local URL (default <http://localhost:5173>). The same command
works identically on macOS, Windows (PowerShell, cmd and Git Bash) and Linux; it
binds to `0.0.0.0` so it also works in containers and WSL.

> The dev server reads `PORT` when it is set and falls back to `5173`.

### Everyday scripts

| Command | What it does |
| --- | --- |
| `bun run dev` (or `npm run dev`) | Start the dev server on `0.0.0.0` |
| `bun run test` | Run the unit and rendering tests once |
| `bun run test:watch` | Run the tests in watch mode |
| `bun run typecheck` | TypeScript project check (`tsc -b`) |
| `bun run lint` | ESLint |
| `bun run build` | Production build into `dist/` |
| `bun run preview` | Serve the production build |

Every script has an `npm` equivalent — nothing here depends on Bun.

## How it works

```
log file ──▶ format detection ──▶ per-line parser ──▶ streaming aggregator ──▶ error directory ──▶ report
                (first 400          (timestamp,        (groups, timeline,        (matches each        (KPIs, charts,
                 lines)              level, logger,     loggers, HTTP stats,     group, attaches     latency, checks,
                                     stack frames)      latency percentiles,      reasons + fixes)    causes, fixes)
                                     request lines)     bounded samples)
```

1. **Detection** reads the first 400 non-empty lines and picks a strategy.
2. **Parsing** turns each line into a `ParsedLine`: timestamp, level, message,
   logger, thread, HTTP fields, exception type and whether it continues the
   previous stack trace.
3. **Aggregation** folds lines into counters, issue groups, a timeline and HTTP
   statistics. It never keeps the file as parsed objects — lines are sliced off
   the raw text one at a time — which is what makes large files (200 MB was the
   measured target) viable in a browser.
4. **Error directory** matching runs the grouped issues against the catalogue in
   `src/lib/error-catalog.ts` (plus the `error-catalog-extended*.ts` files that
   widen it to 102 entries). Matching is two-phase: the fingerprint, title and
   exception type are tried first, and the raw example lines are only consulted
   when nothing matched — which is how JSON logs whose stack trace lives in an
   `error` field are still matched. The report stores only identities and
   counts (catalog id, title, category, severity, occurrences), and the UI
   resolves reasons and fixes from the catalogue at render time — so reports
   stay small and always show the current wording of an entry.
5. **Latency** runs inside the same streaming pass: `LatencyCollector` keeps a
   bounded reservoir of durations (counts, totals and maxima stay exact) so
   p50/p90/p95/p99, budget overruns and a per-operation ranking are available
   even for a 100 MB file.
6. **Checks** run last, over the finished report, so they can compare the level
   mix, the timeline and the latency percentiles. Every check always returns a
   status, which is why a clean file still lists what was verified.
7. **Saving** writes the report to local storage, trimmed to stay well inside
   the browser's quota, newest 30 runs.

### The error directory

`src/lib/error-catalog.ts` holds the entry shape, the categories and the
matcher; the entries themselves live in `src/lib/error-catalog.ts` (base) and
`src/lib/error-catalog-extended{,2,3,4}.ts`, merged into one `ERROR_CATALOG`.

The 19 categories are `runtime-crash`, `memory`, `concurrency`, `network`,
`database`, `http-api`, `security`, `data-integrity`, `configuration`,
`performance`, `dependencies`, `queue-backlog`, `caching`, `external-services`,
`container-runtime`, `business-rules`, `i18n-encoding`, `scheduling` and
`observability`.

One entry looks like this:

```ts
{
  id: "timeout",
  title: "Timeout / deadline exceeded",
  category: "network",
  severity: "critical",
  languages: ["any"],
  patterns: [/timed out/i, /etimedout/i, /deadlineexceeded/i],
  reasons: ["An upstream dependency is slow, overloaded, or its queue is backed up.", …],
  fixes: ["Measure the dependency's real latency distribution and set the budget above p99…", …],
}
```

Adding an entry is one object: give it a unique `id`, at least one `pattern`
that matches the normalised issue text, and honest `reasons` and `fixes`. It then
appears in `/errors`, in the search, and in every future report.

### Latency analysis

Most log formats carry timing only in the message text, so LogLens looks for
`took 1.5s`, `elapsed time: 2.50s`, `duration=340ms`, `(12ms)`, nginx's
`$request_time`, application request lines (`GET /api/orders/12 -> 200 (12ms)`)
and a JSON `durationMs`/`responseTimeMs` field. Everything found is folded into
one bounded reservoir:

- overall p50/p90/p95/p99/max and how many timings crossed the 1s budget,
- a per-operation breakdown ranked by p95 (operation names come from the message
  prefix, a `operation=` field, the method + path, or the HTTP path),
- HTTP timing coverage — because a log with no response-time field cannot
  measure endpoint latency at all, and the report says so.

Findings are raised when p95 is over budget, when the max is far above p95 (an
outlier usually means a retry, a cold cache or a GC pause), or when the slowest
named operations exceed the budget.

### Diagnostic checks

`src/lib/analyzer/checks.ts` contains 53 checks across nine groups:
availability/crashes, resources, concurrency, latency/HTTP, throughput, data
quality, security, configuration and logging hygiene. Each is a small function
returning `pass`, `warn`, `fail` or `unknown` plus a sentence and, where
possible, a real line of evidence. They include the ones people forget to run by
hand: leaked credentials in the log, pool exhaustion, clock skew, missing
correlation ids, unparsable payload share, port conflicts, secret management,
duplicate work, and a drop in log volume at the end of a file.

### Exporting a report

`src/lib/export.ts` is pure functions plus one browser helper:

| Format | File | Contents |
| --- | --- | --- |
| JSON | `orders-service.report.json` | The whole report object, for scripts. |
| CSV | `orders-service.issues.csv` | One row per grouped issue: level, count, share, first/last occurrence, loggers, top frame, matched directory entry, sample line. |
| Markdown | `orders-service.report.md` | A triage write-up for a ticket or PR. |
| HTML | `orders-service.report.html` | A self-contained page (inline CSS, no scripts, no external requests) you can attach to an incident. |

The same module exports `reportToSummary` (a short chat message), `copyText`,
`downloadCatalog` and `downloadText`. Nothing is uploaded: the file is produced
as a blob in the page.

### Measured performance

Throughput is roughly **5 MB/s** including latency extraction, and memory stays
flat because the aggregator keeps bounded samples rather than every parsed line,
and lines are sliced off the text one at a time instead of splitting the whole
file into an array first.

| File | Size | Parse time |
| --- | --- | --- |
| 100k lines | 12 MB | ~2.6 s |
| 500k lines | 61 MB | ~12 s |
| 1M lines | 121 MB | ~23 s |
| 1.65M lines | 200 MB | ~39 s |

A 200 MB file was measured end to end: 39 s, ~1.73 M lines parsed, and a JS
heap of ~65 MB beyond the file text itself — the report stays the same size
whatever the input. The dropzone warns above 120 MB that large files take a
while; there is no hard size limit.

## Supported log formats

| Format | Examples |
| --- | --- |
| JSON / JSON Lines | Pino, Winston, Serilog JSON, ECS, Loki, Cloudflare |
| Apache / Nginx access | common and combined layouts |
| Java / Spring | Logback, Log4j (with and without thread ids), Tomcat |
| Python | `logging` module, Gunicorn, Celery, full tracebacks |
| Node.js | error traces with async frames, npm/pnpm output |
| Go | panics and goroutine dumps |
| .NET / C# | ASP.NET Core and worker service layouts |
| Syslog | RFC 3164, RFC 5424, journald, Docker |
| Docker / Compose | stdout logs with or without timestamps |
| Anything else | generic parsing still extracts timestamps, severities, exceptions and stack frames |

Timestamps understood: ISO 8601, `yyyy-MM-dd HH:mm:ss,SSS`, Apache
`[01/May/2024:10:00:00 +0000]`, syslog `May  1 10:00:00`, `MM/DD/YYYY`,
`YYYY/MM/DD` and epoch milliseconds.

Bundled demo files live in [`public/samples`](./public/samples) and are one click
away on the dashboard.

## Project structure

```
src/
  lib/
    analyzer/         the analysis engine (pure TypeScript, no dependencies)
      index.ts        analyzeLog() — the entry point
      detect.ts       format detection
      parse.ts        per-line parsing for every supported format
      levels.ts       severity detection and inference
      timestamps.ts   timestamp extraction and formatting
      stack.ts        exception headers and stack frames
      normalize.ts    message normalisation and fingerprints
      aggregate.ts    streaming aggregation
      latency.ts      duration extraction, percentiles, per-operation stats
      checks.ts       the 53 always-run diagnostic checks
      insights.ts     failure detectors and recommendations
      types.ts        shared report model
    error-catalog.ts  directory entry shape, categories and the matcher
    error-catalog-extended*.ts  the wider entry set (102 entries in total)
    export.ts         report/directory serializers and the download helper
    history.ts        local-storage report history
    useAnalyses.ts    React bindings for the history store
    samples.ts        bundled demo logs
  components/
    report/           report UI: charts, known problems, raw log viewer
    DownloadMenu.tsx  JSON / CSV / Markdown / HTML export menu
    icons.tsx         small inline SVG icons (no icon-library dependency)
    ui/               UI primitives (shadcn-style)
  pages/
    LandingPage.tsx       marketing + product page
    ErrorDirectoryPage.tsx the error directory
    DashboardPage.tsx     upload + saved reports
    AnalysisPage.tsx      one report
  App.tsx              routes (all public)
public/samples/        bundled demo logs
```

The engine is deliberately framework-free: the same code runs in the browser or
in Node.js, which is how the tests exercise it.

## Testing

```bash
bun run test      # or: npm test
```

96 tests cover the engine (format detection, severity rules, fingerprints,
timestamps, stack frames, request-line parsing, HTTP aggregation, latency
extraction and percentiles, the 53 diagnostic checks, insight detectors and
error-directory matching), the catalog's own integrity rules (unique ids, every
category populated, no false positive on a timestamp that looks like a status),
the export serializers and the real download/clipboard side effects, the error
directory page, and full rendering of the landing page, the directory and a
report built from the bundled sample logs.

## Data and privacy

- **Nothing is uploaded.** LogLens has no backend, so there is nowhere for a log
  to go.
- Parsing, fingerprinting, directory matching and insight detection all run in
  the browser tab.
- The finished report is saved in this browser's local storage so you can come
  back to it. Clearing site data clears the history; the dashboard can also clear
  it with one click. Reports contain a bounded sample of lines, so treat the
  browser as holding your log data.

## Deploying

```bash
bun run build      # outputs static files to dist/
```

`dist/` is a plain static bundle — serve it from any static host, CDN or object
store. There are no environment variables and no server runtime, because there is
no server.

## Tech stack

TypeScript · React 18 · Vite 5 · React Router · Tailwind CSS · shadcn-style
components · Vitest + Testing Library. No backend, no auth provider.

## License

MIT
