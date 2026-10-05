import { Link } from "react-router-dom";

import { SiteHeader } from "@/components/SiteHeader";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ERROR_CATALOG, CATEGORY_LABEL } from "@/lib/error-catalog";
import { CHECK_COUNT } from "@/lib/analyzer";

const FORMATS = [
  {
    name: "JSON / JSON Lines",
    detail: "Pino, Winston, Serilog, ECS, Loki",
    sample: '{"level":"error","msg":"db timeout","logger":"db.pool"}',
  },
  {
    name: "Nginx / Apache access",
    detail: "Combined and common log formats",
    sample: '10.0.0.1 - - [01/May/2024:10:00:00 +0000] "GET /api/x HTTP/1.1" 500 512',
  },
  {
    name: "Java / Spring / Logback",
    detail: "Log4j, Logback, Tomcat, JBoss layouts",
    sample: "2024-05-01 10:00:02,530 ERROR [http-nio-8080] c.f.Orders - Failed",
  },
  {
    name: "Python",
    detail: "logging module, Gunicorn, Celery",
    sample: "2024-05-01 10:00:01,200 ERROR worker - job failed",
  },
  {
    name: "Node.js",
    detail: "Error traces with async frames",
    sample: "Error: connect ECONNREFUSED 127.0.0.1:5432",
  },
  {
    name: "Go",
    detail: "Panics with goroutine dumps",
    sample: "panic: runtime error: index out of range [3]",
  },
  {
    name: ".NET / C#",
    detail: "ASP.NET Core and worker services",
    sample: "System.NullReferenceException: Object reference not set",
  },
  {
    name: "Syslog",
    detail: "RFC 3164 / RFC 5424, journald, Docker",
    sample: "May  1 10:00:02 myhost kernel: Out of memory: Kill process",
  },
];

const FEATURES = [
  {
    title: "Automatic format detection",
    body: "LogLens samples the file first, then picks the right parser — JSON, access logs, syslog, or delimited text. No configuration, no per-app setup.",
  },
  {
    title: "Errors grouped by fingerprint",
    body: "Two messages that differ only by an id, a duration or a hex pointer collapse into one group, so 20,000 identical failures read as a single problem with a count.",
  },
  {
    title: "Stack traces, decoded",
    body: "Java, JavaScript, Python, Go, .NET and Ruby frames are parsed into function, file and line, and chained causes are attached to the right error.",
  },
  {
    title: "Timeline and throughput",
    body: "Activity is bucketed automatically into seconds, minutes or hours so you can see exactly when an incident started and how fast it grew.",
  },
  {
    title: "HTTP breakdown",
    body: "Access logs are turned into status-class distributions and per-endpoint error rates, with numeric ids parameterised so routes group correctly.",
  },
  {
    title: "Actionable insights",
    body: "Built-in detectors recognise memory exhaustion, timeouts, database failures, auth problems, retry storms and more — each with a concrete next step.",
  },
  {
    title: "Error directory built in",
    body: "Every grouped error is matched against a catalogue of known failure modes, so the report explains why it happened and how to fix it — not just what it was.",
  },
  {
    title: "Latency percentiles and slow operations",
    body: "Durations are recovered from `took 1.2s`, `(12ms)`, `$request_time` or a `durationMs` field, then reported as p50/p90/p95/p99, budget overruns and a ranked list of the slowest operations.",
  },
  {
    title: `${CHECK_COUNT} automated diagnostic checks`,
    body: "Every file is run against a fixed list of checks — crashes, pools, locks, queues, TLS, secrets, migrations, probes — and the report shows each one, passed or not, not only the failures.",
  },
  {
    title: "Download the report",
    body: "Export any report as JSON, CSV, Markdown or a standalone HTML page, and download the error directory itself. Everything is generated in your browser.",
  },
  {
    title: "No account, no upload",
    body: "There is no sign-up. Parsing happens in your browser and reports are saved in this browser only, so nothing about your logs leaves the machine.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Drop the file in",
    body: "Drag a log onto the dashboard, pick one from disk, or start from a bundled sample. Multiple files are analysed one after another.",
  },
  {
    n: "02",
    title: "Parsing runs locally",
    body: "Your log is parsed in the browser — nothing is uploaded. Multi-gigabyte files stream through a bounded aggregator that keeps only samples.",
  },
  {
    n: "03",
    title: "Triage the report",
    body: "Severity mix, grouped issues, stack traces, timeline and recommendations. Save the run to keep the history.",
  },
];

const FAQ = [
  {
    q: "Do I need an account?",
    a: "No. There is no sign-up and no sign-in. Open the dashboard, drop a file in, and the report opens straight away.",
  },
  {
    q: "Is my log file uploaded to a server?",
    a: "No. LogLens has no backend at all. Parsing happens in your browser tab and the finished report is saved in this browser's local storage, so nothing about your logs leaves the machine. Clearing browser data clears the history.",
  },
  {
    q: "Which operating systems does it run on?",
    a: "Anywhere you can run a browser: macOS, Windows and Linux, plus ChromeOS, iPadOS and mobile browsers. It is a normal web app, so there is nothing platform-specific to install.",
  },
  {
    q: "How large a file can it handle?",
    a: "Measured throughput is roughly 6 MB/s: a 100k-line, 12 MB file parses in about two seconds, and a few hundred megabytes takes a minute or so. The parser never holds the file as parsed objects — it folds each line into bounded counters — and it yields to the UI so the page stays responsive.",
  },
  {
    q: "Do I need to configure my log format?",
    a: "Usually not. Format detection recognises the common layouts on its own. You can always paste a sample and inspect the detected format and confidence in the report header.",
  },
  {
    q: "Why are some lines shown as unclassified?",
    a: "Logs that carry no severity marker at all are classified from their wording. The report shows how many lines had no explicit severity so you can judge the result.",
  },
];

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* ---------------------------------------------------------------- hero */}
        <section className="relative overflow-hidden border-b">
          <div className="log-grid log-grid-fade absolute inset-0" aria-hidden />
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[34rem] w-[68rem] -translate-x-1/2 rounded-full bg-primary/12 blur-[120px]"
            aria-hidden
          />
          <div className="container relative grid gap-14 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
            <div className="animate-fade-up">                <Badge variant="outline" className="mb-6 gap-2 border-primary/40 bg-primary/10 text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                No sign-up · runs in your browser · macOS, Windows, Linux
              </Badge>

              <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                Read your logs like the person who has to{" "}
                <span className="text-primary">fix them at 2am</span>.
              </h1>                <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Upload any log file and get a real triage report: severity
                breakdown, identical errors grouped by fingerprint, decoded stack
                traces, why each known error happened and what fixes it, a
                timeline and the next things to check — in about two seconds.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link to="/app">Analyze a log file</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/errors">Browse the error directory</Link>
                </Button>
              </div>

              <dl className="mt-12 grid max-w-xl grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
                {[
                  ["8+", "log layouts detected"],
                  ["0", "bytes uploaded"],
                  [ERROR_CATALOG.length, "documented error causes"],
                  [CHECK_COUNT, "diagnostic checks per file"],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="font-mono text-xl font-semibold text-foreground">
                      {value}
                    </dt>
                    <dd className="mt-1 text-xs leading-snug text-muted-foreground">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <HeroPreview />
          </div>
        </section>

        {/* ------------------------------------------------------------ formats */}
        <section id="formats" className="border-b py-20">
          <div className="container">
            <SectionHeading
              eyebrow="Format support"
              title="Point it at whatever your stack writes"
              body="Detection is automatic and reported with a confidence score, so you always know how the file was interpreted."
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FORMATS.map((format) => (
                <div
                  key={format.name}
                  className="panel group p-5 transition-colors hover:border-primary/50"
                >
                  <h3 className="font-medium">{format.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{format.detail}</p>
                  <pre className="mt-4 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {format.sample}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- features */}
        <section id="features" className="border-b py-20">
          <div className="container">
            <SectionHeading
              eyebrow="What you get"
              title="Everything between “this log is broken” and “here is the fix”"
              body="Not a grep wrapper. LogLens understands structure, severity, causality and repetition."
            />
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="bg-card p-6 transition-colors hover:bg-card/70">
                  <h3 className="font-medium">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {feature.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- how it works */}
        <section id="how" className="border-b py-20">
          <div className="container">
            <SectionHeading
              eyebrow="How it works"
              title="Three steps, no setup"
            />
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.n} className="panel p-6">
                  <span className="font-mono text-sm text-primary">{step.n}</span>
                  <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------ sample report */}
        <section className="border-b py-20">
          <div className="container">
            <SectionHeading
              eyebrow="Example report"
              title="This is what a 40k-line orders-service log produces"
              body="Severity mix, grouped failures with stack frames, and the insights worth acting on."
            />
            <div className="mt-12">
              <StaticReportPreview />
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- error directory */}
        <section id="directory" className="border-b py-20">
          <div className="container">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading
                eyebrow="Error directory"
                title="A catalogue of why errors happen — wired into every report"
                body={`${ERROR_CATALOG.length} documented failure modes, each with the reasons behind it and the fixes that work. Every analysed file is matched against them, so the report tells you what to do, not just what broke.`}
              />
              <Button asChild variant="outline">
                <Link to="/errors">Browse all {ERROR_CATALOG.length} entries</Link>
              </Button>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ERROR_CATALOG.slice(0, 6).map((entry) => (
                <div key={entry.id} className="panel flex flex-col p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">{entry.title}</h3>
                    <Badge variant="outline">{CATEGORY_LABEL[entry.category]}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    <span className="text-foreground">Why: </span>
                    {entry.reasons[0]}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    <span className="text-primary">Fix: </span>
                    {entry.fixes[0]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- faq */}
        <section id="faq" className="py-20">
          <div className="container">
            <SectionHeading eyebrow="FAQ" title="Straight answers" />
            <div className="mx-auto mt-12 max-w-3xl divide-y rounded-xl border bg-card">
              {FAQ.map((item) => (
                <details key={item.q} className="group px-6 py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {item.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------------- cta */}
        <section className="border-t py-20">
          <div className="container">
            <div className="panel log-grid relative overflow-hidden px-6 py-14 text-center">
              <div className="relative mx-auto max-w-2xl">
                <Logo className="mx-auto h-10 w-10" />
                <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Your next incident deserves a real report
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                  No account, no upload, no setup — drop in a log file and get
                  the same view you see above for your own services.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3">
                  <Button asChild size="lg">
                    <Link to="/app">Analyze a log file</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link to="/errors">Error directory</Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-10">
        <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Logo className="h-5 w-5" />
            <span className="font-mono">loglens</span>
            <span>· log analysis for developers</span>
          </div>
          <p>
            Runs entirely in your browser · built with{" "}
            <a
              href="https://react.dev"
              className="underline underline-offset-4 hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              React
            </a>{" "}
            and{" "}
            <a
              href="https://vitejs.dev"
              className="underline underline-offset-4 hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Vite
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {body ? (
        <p className="mt-4 text-muted-foreground">{body}</p>
      ) : null}
    </div>
  );
}

/** Static, hand-drawn preview of the report UI shown in the hero. */
function HeroPreview() {
  const bars = [
    { label: "INFO", value: 62, color: "bg-severity-info" },
    { label: "DEBUG", value: 24, color: "bg-severity-debug" },
    { label: "WARN", value: 9, color: "bg-severity-warn" },
    { label: "ERROR", value: 5, color: "bg-severity-error" },
  ];

  return (
    <div className="relative animate-fade-up [animation-delay:120ms]">
      <div className="scanlines panel relative overflow-hidden shadow-2xl">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-severity-error/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-severity-warn/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-severity-info/70" />
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
            orders-service.log · 41,318 lines
          </span>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Errors", "2,068", "text-severity-error"],
              ["Warnings", "3,714", "text-severity-warn"],
              ["Groups", "7", "text-foreground"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-md border bg-background/60 p-3">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={`font-mono text-lg font-semibold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {bars.map((bar) => (
              <div key={bar.label} className="flex items-center gap-3">
                <span className="w-14 font-mono text-[11px] text-muted-foreground">
                  {bar.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${bar.color}`}
                    style={{ width: `${bar.value}%` }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">
                  {bar.value}%
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-md border bg-background/60 p-3">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              Top issue · 248 occurrences
            </p>
            <p className="font-mono text-xs text-severity-error">
              java.lang.NullPointerException: order is null
            </p>
            <pre className="mt-2 overflow-hidden font-mono text-[11px] leading-relaxed text-muted-foreground">
              {`at com.foo.orders.OrderService.process(OrderService.java:88)\n`}
              {`at com.foo.orders.OrderController.submit(OrderController.java:41)`}
            </pre>
          </div>

          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="text-primary">›</span>
            Null dereferences are the top defect class here — guard order before
            processing.
          </p>
        </div>
      </div>
    </div>
  );
}

function StaticReportPreview() {
  const groups = [
    {
      level: "error",
      count: 248,
      title: "java.lang.NullPointerException: order is null",
      where: "OrderService.java:88",
    },
    {
      level: "error",
      count: 96,
      title: "TimeoutError: ETIMEDOUT connecting to payments.internal:8443",
      where: "PaymentClient.ts:112",
    },
    {
      level: "warn",
      count: 91,
      title: "Falling back to legacy pricing for order",
      where: "PricingFacade.java:64",
    },
  ];

  const colorFor = (level: string) =>
    level === "error" ? "text-severity-error" : "text-severity-warn";

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-muted/30 px-5 py-4">
        <div>
          <p className="font-mono text-sm">orders-service.log</p>
          <p className="text-xs text-muted-foreground">
            Delimited text · 41,318 lines · 18.4 MB · health score 62
          </p>
        </div>
        <Badge variant="destructive">2 critical insights</Badge>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            Grouped issues
          </p>
          <ul className="space-y-2">
            {groups.map((group) => (
              <li key={group.title} className="rounded-md border bg-background/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className={`font-mono text-xs ${colorFor(group.level)}`}>
                    {group.title}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    ×{group.count}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                  {group.where}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            Insights
          </p>
          <ul className="space-y-2 text-sm">
            <li className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="font-medium text-destructive">
                Null / undefined dereferences
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                248 lines are null dereferences, all rooted in OrderService.java:88.
              </p>
            </li>
            <li className="rounded-md border border-severity-warn/40 bg-severity-warn/5 p-3">
              <p className="font-medium text-severity-warn">
                Timeouts and deadline overruns
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                96 lines timed out against payments.internal — likely upstream
                latency.
              </p>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}