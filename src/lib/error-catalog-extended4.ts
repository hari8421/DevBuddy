/**
 * Extended error directory entries, part 4.
 *
 * Observability hygiene, configuration and dependency problems — the failures
 * that make every other investigation harder.
 */

import type { ErrorCatalogEntry } from "./error-catalog";

export const EXTENDED_ERROR_CATALOG_4: ErrorCatalogEntry[] = [
  // ---------------------------------------------------------- observability
  {
    id: "log-flooding",
    title: "Log flooding / runaway logging",
    category: "observability",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /log(?:ging)? (?:flood|volume|saturation)/i,
      /too many log (?:lines|messages|entries)/i,
      /high log volume/i,
      /logger.*(?:disabled|suppressed).*volume/i,
      /dropping log/i,
      /sampling/i,
    ],
    reasons: [
      "An error path logs the full payload (or a stack trace) on every request.",
      "A loop logs per iteration and the loop itself is unexpectedly large.",
      "A dependency failure makes every request log the same error, multiplying volume by traffic.",
    ],
    fixes: [
      "Log once per failure cause, then count — a counter with a single representative sample.",
      "Truncate payloads and stack traces in the formatter, not in the call site.",
      "Rate-limit per key (user, endpoint) and sample the rest.",
    ],
  },
  {
    id: "error-swallowed",
    title: "Error swallowed / handled silently",
    category: "observability",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /(?:catch|except)\s*(?:\([^)]*\))?\s*:\s*(?:pass|continue|return)\b/,
      /ignored?\b.*exception/i,
      /suppressing? (?:the )?(?:error|exception)/i,
      /error (?:was )?(?:ignored|discarded|dropped)/i,
      /best effort.*(?:ignore|skip)/i,
      /catchall/i,
    ],
    reasons: [
      "A broad `catch` handles an error the caller needed to see.",
      "The error is logged at debug, so it disappears in production.",
      "The exception object is discarded, so the stack trace is lost.",
    ],
    fixes: [
      "Never leave an empty catch: log with context, re-throw, or return a typed failure.",
      "Failures handled deliberately should still be counted as failures in a metric.",
      "Review bare catches in code review with a lint rule.",
    ],
  },
  {
    id: "sampling-loss",
    title: "Log sampling / truncated output",
    category: "observability",
    severity: "info",
    languages: ["any"],
    patterns: [
      /sampl(?:ing|ed) rate/i,
      /sampled (?:out|logs)/i,
      /truncat(?:ed|ing) (?:log|message|output)/i,
      /\.\.\. \(\d+ more\)/i,
      /log rotation|rotated log/i,
      /buffer (?:flushed|full).*drop/i,
    ],
    reasons: [
      "Sampling was turned up to control cost, so rare errors may never be logged.",
      "The agent truncated long lines or payloads to fit a buffer.",
      "Log rotation removed lines before anybody read them.",
    ],
    fixes: [
      "Sample by a rule that always keeps errors, never by uniform probability.",
      "Raise the truncation limit or move large payloads to an external store.",
      "Align retention with the incident process, and ship to a searchable store rather than files.",
    ],
  },
  {
    id: "log-truncation",
    title: "Incomplete log entry",
    category: "observability",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /entry (?:was )?truncated/i,
      /message truncated|truncated entry/i,
      /max(?:imum)? (?:line|entry) (?:length|size)/i,
      /line too long/i,
      /payload too large to log/i,
    ],
    reasons: [
      "A formatter caps the message length, so the interesting end is missing.",
      "Multi-line values are printed raw, breaking the line-oriented format.",
      "A stack trace is cut off after N frames, hiding the root cause.",
    ],
    fixes: [
      "Keep the first and last frames of a trace and mark the elision explicitly.",
      "Escape newlines in values so one entry stays one line.",
      "Log large payloads as a reference (id + link) instead of inline content.",
    ],
  },

  // --------------------------------------------------------- configuration
  {
    id: "injection-failure",
    title: "Dependency injection / bean wiring failure",
    category: "configuration",
    severity: "critical",
    languages: ["java", "spring", "dotnet"],
    patterns: [
      /no qualifying bean of type/i,
      /no such bean definition/i,
      /bean creation (?:failed|exception)/i,
      /unsatisfied dependency/i,
      /cannot resolve (?:parameter|dependency)/i,
      /dependency (?:resolution )?failed/i,
      /autowire/i,
    ],
    reasons: [
      "A bean was removed or renamed while something still injects it.",
      "A conditional bean was not created because the property controlling it is missing.",
      "A component scan no longer covers the package after a refactor.",
    ],
    fixes: [
      "Fail at startup with a clear message — this must never be caught and ignored.",
      "Keep constructors explicit so wiring errors surface at compile time.",
      "Add a context-load smoke test so a broken graph fails in CI, not in production.",
    ],
  },
  {
    id: "circular-dependency",
    title: "Circular dependency between modules",
    category: "configuration",
    severity: "critical",
    languages: ["java", "spring", "python", "go", "node"],
    patterns: [
      /circular (?:dependency|reference|initialization)/i,
      /bean is not eligible for getting processed by all bean post-processors/i,
      /cyclic (?:dependency|reference)/i,
      /requires? bean .* which is currently in creation/i,
      /circular import/i,
      /partially initialized/i,
    ],
    reasons: [
      "Two modules call each other, usually after a feature was added to both sides.",
      "A lazy proxy hid the cycle until a specific code path needed both beans.",
      "An import cycle in a package graph makes initialisation order non-deterministic.",
    ],
    fixes: [
      "Extract the shared part into a third module that both depend on.",
      "Pass an event/callback instead of calling back into the other module.",
      "Break the import cycle at the package level so initialisation is ordered.",
    ],
  },
  {
    id: "invalid-binding",
    title: "Configuration property cannot be bound",
    category: "configuration",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /cannot bind (?:property|value)/i,
      /failed to bind (?:property|properties)/i,
      /unbound configuration/i,
      /placeholder .* (?:not|has no) value/i,
      /conversion failed.*(?:property|configuration)/i,
      /type mismatch.*(?:property|config)/i,
      /no setter found for property/i,
    ],
    reasons: [
      "A property name changed (prefix, nesting, kebab vs camel case) and the old key is silently ignored.",
      "The value has the wrong type (`true` for an int, `1_000` with an underscore).",
      "An environment variable overrides a file value in an unexpected way.",
    ],
    fixes: [
      "Enable validation at startup so unknown or unbindable keys fail the boot.",
      "Print the effective configuration source per key when debugging.",
      "Keep property names mechanical and generated from one definition.",
    ],
  },
  {
    id: "missing-secret",
    title: "Secret or API key missing",
    category: "configuration",
    severity: "critical",
    languages: ["any"],
    patterns: [
      /(?:secret|token|api[_-]?key|credential) .*(?:not (?:set|found|configured)|is (?:missing|required|empty))/i,
      /could not find (?:credentials|api key|secret)/i,
      /credentials not found/i,
      /unauthenticated(?: request)?/i,
      /401 unauthorized.*config/i,
    ],
    reasons: [
      "The deployment did not mount the secret, or it is mounted under a different key.",
      "The secret was rotated in the store but the application was not restarted.",
      "A local `.env` file is gitignored and missing on the new machine.",
    ],
    fixes: [
      "Fail at startup when a required secret is absent — never on the first API call.",
      "Verify which secret store and key the process is actually using, and log the name (not the value).",
      "Keep secret rotation automatic and alert when a secret changes.",
    ],
  },

  // ----------------------------------------------------------- dependencies
  {
    id: "linkage-error",
    title: "Class/ABI incompatibility",
    category: "dependencies",
    severity: "critical",
    languages: ["java", "jvm", "dotnet", "native"],
    patterns: [
      /unsupportedclassversionerror/i,
      /noclassdeffounderror/i,
      /nosuchmethoderror/i,
      /nosuchfielderror/i,
      /nocuchymethoderror|absent method/i,
      /incompatible class change/i,
      /classnotfound(?:exception)?/i,
      /dlopen failed/i,
    ],
    reasons: [
      "A dependency was upgraded but a transitive one was not, so the ABI no longer matches.",
      "The runtime version is older than the bytecode the library was compiled for.",
      "Two artifacts provide the same class and one wins on the classpath.",
    ],
    fixes: [
      "Use the dependency lock file and run `dependency:tree` to find the conflict.",
      "Align the runtime version with what the libraries need and pin it in the base image.",
      "Exclude the conflicting transitive artifact explicitly rather than hoping for the best order.",
    ],
  },
  {
    id: "missing-transitive",
    title: "Missing transitive dependency",
    category: "dependencies",
    severity: "critical",
    languages: ["java", "node", "python", "dotnet", "go"],
    patterns: [
      /no module named/i,
      /cannot find module|module not found/i,
      /modulenotfounderror/i,
      /could not find artifact/i,
      /package .* is not (?:installed|on the)/i,
      /requires? .* but it is (?:not|missing)/i,
      /unresolved dependency/i,
    ],
    reasons: [
      "A dependency was declared with `provided`/`optional` scope and is missing at runtime.",
      "A build cache or a pruned image dropped packages that the app assumes are there.",
      "A transitive dependency changed its own dependencies without a major version bump.",
    ],
    fixes: [
      "Declare what you import, not what you happen to get transitively.",
      "Run the app in CI with a clean install so missing pieces fail before a deploy.",
      "Pin and verify the exact set of runtime artifacts in the shipped image.",
    ],
  },
  {
    id: "service-discovery",
    title: "Service discovery / registry failure",
    category: "dependencies",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /service (?:not )?found in (?:registry|eureka|consul)/i,
      /no instances available/i,
      /no healthy instances/i,
      /registry (?:unavailable|down)/i,
      /discovery client/i,
      /dns[- ]?srv/i,
    ],
    reasons: [
      "The registry is unreachable, so the client falls back to an empty instance list.",
      "The service deregistered itself after a failed health check and never re-registered.",
      "The service name differs by environment (staging vs production) or by namespace.",
    ],
    fixes: [
      "Keep the last known instance list and retry, rather than resolving to nothing.",
      "Watch the instance count per service: zero instances should page someone.",
      "Alert when discovery returns an empty list, not only when a call fails.",
    ],
  },
  {
    id: "api-deprecation",
    title: "Deprecated API in use",
    category: "dependencies",
    severity: "info",
    languages: ["any"],
    patterns: [
      /deprecat(?:ed|ion)/i,
      /will be removed in/i,
      /no longer supported/i,
      /end of life|eol/i,
      /sunset date/i,
      /legacy (?:endpoint|version|api)/i,
    ],
    reasons: [
      "A dependency's API is scheduled for removal and the call site was never migrated.",
      "A provider retired a version and warns before blocking it.",
      "The code calls a feature flagged deprecated inside the language or SDK.",
    ],
    fixes: [
      "Track each warning to a call site and fix it before the removal date, not after.",
      "Pin the dependency version so the warning and the deadline are visible in the build.",
      "Add a migration ticket with the deprecation warning as its evidence.",
    ],
  },
];