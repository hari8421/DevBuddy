/**
 * LogLens error directory.
 *
 * A catalog of failure modes developers meet in logs, each with the reasons it
 * usually happens and the fixes that work. Two things consume it:
 *
 * 1. `/errors` — a browsable, searchable directory of every entry.
 * 2. The analyzer — every grouped issue is matched against these patterns, so a
 *    report explains *why* a known error happened, not just that it did.
 *
 * Patterns are matched against the normalised issue pattern, the issue title and
 * the exception type, so `NullPointerException: order is null` and
 * `java.lang.NullPointerException` both match the same entry.
 */

export const ERROR_CATEGORIES = [
  "runtime-crash",
  "memory",
  "concurrency",
  "network",
  "database",
  "http-api",
  "security",
  "data-integrity",
  "configuration",
  "performance",
  "dependencies",
  "queue-backlog",
  "caching",
  "external-services",
  "container-runtime",
  "business-rules",
  "i18n-encoding",
  "scheduling",
  "observability",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

import { EXTENDED_ERROR_CATALOG } from "./error-catalog-extended";
import { EXTENDED_ERROR_CATALOG_2 } from "./error-catalog-extended2";
import { EXTENDED_ERROR_CATALOG_3 } from "./error-catalog-extended3";
import { EXTENDED_ERROR_CATALOG_4 } from "./error-catalog-extended4";

export const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  "runtime-crash": "Runtime & crashes",
  memory: "Memory & resources",
  concurrency: "Concurrency & threading",
  network: "Network & connectivity",
  database: "Database",
  "http-api": "HTTP & API",
  security: "Security & auth",
  "data-integrity": "Data integrity",
  configuration: "Configuration & environment",
  performance: "Performance",
  dependencies: "Dependencies & versions",
  "queue-backlog": "Queues & backpressure",
  caching: "Caching",
  "external-services": "External services",
  "container-runtime": "Containers & orchestration",
  "business-rules": "Business rules",
  "i18n-encoding": "Encoding, locale & time zones",
  scheduling: "Scheduling & background jobs",
  observability: "Logging hygiene",
};

/** Tailwind tone per category, used by the directory and the report. */
export const CATEGORY_COLOR: Record<ErrorCategory, string> = {
  "runtime-crash": "text-severity-fatal",
  memory: "text-severity-fatal",
  concurrency: "text-severity-warn",
  network: "text-severity-warn",
  database: "text-severity-warn",
  "http-api": "text-severity-info",
  security: "text-severity-warn",
  "data-integrity": "text-severity-error",
  configuration: "text-severity-info",
  performance: "text-severity-warn",
  dependencies: "text-severity-info",
  "queue-backlog": "text-severity-warn",
  caching: "text-severity-info",
  "external-services": "text-severity-warn",
  "container-runtime": "text-severity-fatal",
  "business-rules": "text-severity-info",
  "i18n-encoding": "text-severity-info",
  scheduling: "text-severity-warn",
  observability: "text-severity-info",
};

export type CatalogSeverity = "critical" | "warning" | "info";

export interface ErrorCatalogEntry {
  id: string;
  title: string;
  category: ErrorCategory;
  severity: CatalogSeverity;
  /** Languages, runtimes or stacks the entry usually shows up in. */
  languages: string[];
  /** Matched against the normalised issue pattern, title and exception type. */
  patterns: RegExp[];
  /** Why this error normally happens. */
  reasons: string[];
  /** What actually fixes it. */
  fixes: string[];
}

const BASE_ERROR_CATALOG: ErrorCatalogEntry[] = [
  // ------------------------------------------------------------ runtime crash
  {
    id: "null-reference",
    title: "Null / undefined dereference",
    category: "runtime-crash",
    severity: "critical",
    languages: ["java", "kotlin", "javascript", "typescript", "python", "c#"],
    patterns: [
      /nullpointerexception/i,
      /nullreferenceexception/i,
      /cannot read propert|is not iterable|undefined is not|cannot access .* before initialization/i,
      /typeerror\b/i,
      /\bkeyerror\b/i,
      /segmentation fault/i,
    ],
    reasons: [
      "A lookup returned nothing (missing row, expired key, failed search) and the code used the result without checking it.",
      "A value was deleted or renamed by another process between the check and the use (a time-of-check/time-of-use gap).",
      "An optional field is absent on happy-path data but the code assumes it is always present.",
      "A promise or stream resolved to undefined because an earlier error was swallowed and execution continued.",
    ],
    fixes: [
      "Add an explicit guard at the failing line and fail with a message that names the missing value and its key.",
      "Validate input at the boundary (schema validation) so impossible shapes never reach business logic.",
      "Return a typed 'not found' instead of null/undefined and handle it explicitly at every call site.",
      "Turn on null-safety in the language if it is available, and stop using `!` assertions to silence the compiler.",
    ],
  },
  {
    id: "index-out-of-range",
    title: "Index out of range / off-by-one",
    category: "runtime-crash",
    severity: "critical",
    languages: ["go", "python", "java", "javascript", "c", "rust"],
    patterns: [/index out of range/i, /out of bounds/i, /indexerror/i, /arrayindexoutofboundsexception/i, /boundserror/i],
    reasons: [
      "A loop or slice assumed a fixed length while the collection was shorter.",
      "Data changed size between the bounds check and the access.",
      "Pagination or offset arithmetic is off by one at the boundary.",
    ],
    fixes: [
      "Check the length before indexing and return a clear error naming the expected and actual sizes.",
      "Write a property test for the boundary values (0, 1, n-1, n) around the failing code.",
      "Prefer iterator or slice helpers over raw indexes where the language allows it.",
    ],
  },
  {
    id: "panic-abort",
    title: "Process crash / panic / abort",
    category: "runtime-crash",
    severity: "critical",
    languages: ["go", "c", "c++", "rust", "native"],
    patterns: [/panic:/i, /fatal error/i, /core dumped/i, /sigsegv/i, /sigabrt/i, /abort\(\)/i, /assertionerror/i, /assertion failed/i],
    reasons: [
      "An invariant the runtime cannot check at compile time was violated and the runtime chose to abort.",
      "Unrecoverable memory corruption (use-after-free, buffer overflow) from unsafe code or a native dependency.",
      "A failed assertion in a debug build that is disabled in release, so the bad state escapes instead.",
    ],
    fixes: [
      "Reproduce from the top frame of the goroutine/trace and fix that line rather than the symptom logged before it.",
      "Add a recover/panic boundary (or a signal handler) so one bad request cannot take the whole process down.",
      "Rebuild with sanitizers (ASan/UBSan) or run with `-race` to surface memory and data races.",
    ],
  },
  {
    id: "unhandled-exception",
    title: "Unhandled exception escaping a handler",
    category: "runtime-crash",
    severity: "critical",
    languages: ["javascript", "typescript", "python", "java", "go"],
    patterns: [/unhandled ?(exception|rejection|promise)/i, /uncaught (exception|error)/i, /unhandledpromiserejection/i, /exception in thread/i],
    reasons: [
      "A callback throws and nothing catches it, so the error escapes the request/task boundary.",
      "An async promise rejects and nobody awaits it (fire-and-forget queue or event handler).",
      "A finally block itself throws and replaces the original error.",
    ],
    fixes: [
      "Wrap the throwing call sites in try/catch (or await them) and let them fail as normal error logs.",
      "Add a global handler that records the error, decides whether the process can continue, and keeps the exit code meaningful.",
      "Make queue consumers and event handlers total: catch, log with context, acknowledge or rethrow deliberately.",
    ],
  },

  // ------------------------------------------------------------------- memory
  {
    id: "out-of-memory",
    title: "Out of memory / heap exhaustion",
    category: "memory",
    severity: "critical",
    languages: ["java", "node", "python", "go", "dotnet"],
    patterns: [/out of memory/i, /outofmemoryerror/i, /heap space/i, /memoryerror/i, /javascript heap out of memory/i, /cannot allocate memory/i, /oom[- ]?kill/i],
    reasons: [
      "A collection grows without bound — logs, metrics, caches, or an in-memory queue nobody drains.",
      "A leak: long-lived objects keep references to short-lived ones (listeners, subscriptions, closures, DI scopes).",
      "The workload genuinely needs more memory than the container limit allows.",
      "A loop reads a whole file or dataset into memory instead of streaming it.",
    ],
    fixes: [
      "Raise the heap/container limit for the failing process as an immediate measure, then fix the growth.",
      "Profile allocations (heap dump, `-Xprof`, py-spy, pprof) and find what retains the most.",
      "Bound every cache with eviction (LRU/TTL) and every buffer with backpressure or dropping.",
      "Stream large inputs instead of loading them, and page through APIs.",
    ],
  },
  {
    id: "gc-pressure",
    title: "GC pressure / stop-the-world",
    category: "memory",
    severity: "warning",
    languages: ["java", "go", "dotnet", "node"],
    patterns: [/gc overhead limit/i, /pause.*full.*gc/i, /stop.the.world/i, /concurrent mode failure/i, /allocation failure/i],
    reasons: [
      "Allocation rate exceeds what the collector can keep up with, usually short-lived garbage in a hot loop.",
      "The heap is sized too small for the live set, so the collector runs constantly.",
      "Large objects are promoted repeatedly because they survive minor collections.",
    ],
    fixes: [
      "Reduce allocation in the hot path: reuse buffers, avoid boxing and closures per call, use value types.",
      "Right-size the heap and collector settings against measured live-set size, not guesswork.",
      "Move cold data out of the heap (files, database, object storage).",
    ],
  },
  {
    id: "resource-limits",
    title: "File descriptors, threads or quota exhausted",
    category: "memory",
    severity: "warning",
    languages: ["java", "node", "python", "unix"],
    patterns: [/too many open files/i, /emfile/i, /cannot allocate memory/i, /thread pool (exhausted|is full)/i, /rejectedexecutionexception/i, /quota exceeded/i, /no space left on device/i, /enospc/i, /resource temporarily unavailable/i],
    reasons: [
      "Handles are opened and never closed (missing finally/dispose), so the process leaks descriptors over time.",
      "Concurrency was raised beyond what the machine can host, and each worker holds several descriptors.",
      "Disk or quota limits were reached because logs, temp files or caches were never rotated.",
    ],
    fixes: [
      "Close handles deterministically (context managers, try-with-resources, `using`).",
      "Raise the soft limit knowingly, and pool clients instead of creating one per request.",
      "Rotate logs and cap cache directories; alert on disk usage before the limit is hit.",
    ],
  },

  // --------------------------------------------------------------- concurrency
  {
    id: "deadlock",
    title: "Deadlock / lock contention",
    category: "concurrency",
    severity: "critical",
    languages: ["java", "go", "sql", "dotnet"],
    patterns: [/deadlock/i, /lock wait timeout/i, /serializationfailure/i, /could not obtain lock/i],
    reasons: [
      "Two transactions acquire the same rows in different orders, so each waits on the other.",
      "A lock is held while a network call or user interaction happens, making the hold time unbounded.",
      "One slow transaction holds a lock long enough that everything behind it times out.",
    ],
    fixes: [
      "Always acquire locks in a single, documented order.",
      "Keep transactions short: no external calls, no user input, no file I/O inside a transaction.",
      "Retry serialization failures with backoff, and set a short lock timeout so failures surface fast.",
    ],
  },
  {
    id: "race-condition",
    title: "Race condition / thread safety",
    category: "concurrency",
    severity: "warning",
    languages: ["java", "go", "python", "javascript"],
    patterns: [/concurrentmodificationexception/i, /race (condition|detected)/i, /data race/i, /not thread.safe/i, /illegalstateexception/i],
    reasons: [
      "Shared mutable state is read and written from multiple threads without synchronisation.",
      "A collection is being iterated while another thread mutates it.",
      "A lazily initialised value is published before it is fully constructed.",
    ],
    fixes: [
      "Make the shared state immutable, or guard every access with the same lock.",
      "Replace shared collections with concurrent or copy-on-write equivalents.",
      "Enable the runtime race detector in CI and run the concurrent tests repeatedly.",
    ],
  },

  // ------------------------------------------------------------------ network
  {
    id: "timeout",
    title: "Timeout / deadline exceeded",
    category: "network",
    severity: "critical",
    languages: ["any"],
    patterns: [/timed out/i, /timeout/i, /etimedout/i, /esockettimedout/i, /deadlineexceeded/i, /read timed/i, /context deadline/i],
    reasons: [
      "An upstream dependency is slow, overloaded, or its queue is backed up.",
      "The timeout budget is shorter than the dependency's normal worst case, so normal latency looks like failure.",
      "Retries pile extra load onto an already struggling service, turning a slowdown into a timeout storm.",
      "Network partitions or DNS resolution delay consume the whole budget before the call starts.",
    ],
    fixes: [
      "Measure the dependency's real latency distribution and set the budget above p99, not above the average.",
      "Bound retries with exponential backoff and jitter, and make every retried operation idempotent.",
      "Add a circuit breaker so failures fail fast instead of piling up.",
      "Set explicit per-hop timeouts so one slow dependency cannot consume the entire request budget.",
    ],
  },
  {
    id: "connection-refused",
    title: "Connection refused / reset / broken pipe",
    category: "network",
    severity: "critical",
    languages: ["any"],
    patterns: [/econnrefused/i, /connection refused/i, /econnreset/i, /connection reset/i, /broken pipe/i, /\bepipe\b/i, /ehostunreach/i, /enetunreach/i, /no route to host/i],
    reasons: [
      "The target process is not listening, or it crashed and was restarted.",
      "The host/port is wrong in configuration — often after an environment or service rename.",
      "A load balancer or proxy dropped an idle connection, and the client used it again.",
      "A firewall or security group now blocks the path.",
    ],
    fixes: [
      "Check the service is actually up and listening on that address from the caller's network namespace.",
      "Verify configuration values against the deployment that is really running.",
      "Enable keep-alive tuning and idle-connection reaping on both ends.",
      "Add startup health checks and a readiness gate so traffic only reaches a ready instance.",
    ],
  },
  {
    id: "dns-tls",
    title: "DNS resolution and TLS failures",
    category: "network",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /enotfound/i,
      /eai_again/i,
      /getaddrinfo/i,
      /name resolution/i,
      /certificate (verify|has expired|is not valid|expired|not yet valid)/i,
      /cert(?:ificate)? verify/i,
      /self signed/i,
      /unable to verify/i,
      /ssl handshake/i,
      /\bcert_/i,
      /tlsv1 alert/i,
    ],
    reasons: [
      "DNS records changed, expired, or are being resolved by a stale resolver cache inside a container image.",
      "A certificate was rotated or expired and the trust store in the image is out of date.",
      "The system clock is wrong, which invalidates every certificate check.",
      "SNI/hostname mismatch because a service is called by a different name than it presents.",
    ],
    fixes: [
      "Verify DNS records from inside the failing environment, not from your laptop.",
      "Update the trust store as part of the base image build, never at runtime.",
      "Sync the clock (NTP) and alert on drift.",
      "Call services by the hostname they present in their certificate.",
    ],
  },

  // ----------------------------------------------------------------- database
  {
    id: "db-constraint",
    title: "Constraint and integrity violations",
    category: "database",
    severity: "critical",
    languages: ["sql", "any"],
    patterns: [/unique (constraint|key|violation)/i, /duplicate key/i, /foreign key/i, /integrityerror/i, /violates (foreign key|unique)/i, /not null constraint/i, /23505|23503/],
    reasons: [
      "Writes are not idempotent, so a retry duplicates data that already exists.",
      "Two code paths write the same logical record with different keys.",
      "Schema constraints are stricter than the application assumed (for example a length limit).",
      "Deletes were hard-deleted while other rows still reference them.",
    ],
    fixes: [
      "Make writes idempotent (upsert with a natural key, or an idempotency key per request).",
      "Translate constraint violations into domain errors rather than letting them surface as 500s.",
      "Align validation in the application with the constraints in the schema.",
    ],
  },
  {
    id: "db-timeout",
    title: "Database query timeout / slow query",
    category: "database",
    severity: "critical",
    languages: ["sql", "any"],
    patterns: [/statement cancelled due to (timeout|statement timeout)/i, /querytimeout/i, /lock wait timeout/i, /canceling statement/i, /too many connections/i, /connection pool/i, /connection is closed/i],
    reasons: [
      "A query scans a large table because the index it needs is missing or unused by the planner.",
      "Parameter sniffing: one plan cached for all values of a column and it is wrong for most of them.",
      "The connection pool is too small, so requests queue behind each other and time out while waiting.",
      "Long-running transactions or an open transaction in application code hold locks.",
    ],
    fixes: [
      "Read the query plan for the actual failing statement and add the missing index (or rewrite the query).",
      "Size the pool against the database's max connections and the number of instances.",
      "Set a statement timeout so failures surface fast, and always close transactions.",
      "Use the slow-query log and `pg_stat_statements`-style tooling to find the top offenders by total time, not by single call.",
    ],
  },
  {
    id: "db-unavailable",
    title: "Database unavailable or replication lag",
    category: "database",
    severity: "critical",
    languages: ["sql", "any"],
    patterns: [/database (is )?(unavailable|not available)/i, /could not connect to server/i, /server closed the connection/i, /read-only transaction/i, /replication/i, /failover/i],
    reasons: [
      "A failover, restart or network partition is in progress.",
      "The connection was dropped by the server or an idle-connection reaper.",
      "Writes hit a read replica because the connection string was changed or cached.",
      "Connection limits on the server side were exceeded during a traffic spike.",
    ],
    fixes: [
      "Retry idempotent operations with backoff across the failover window.",
      "Recreate connections on failure instead of reusing a dead one.",
      "Verify read/write routing explicitly and fail loudly when a write lands on a replica.",
    ],
  },

  // -------------------------------------------------------------- http & api
  {
    id: "http-5xx",
    title: "HTTP 5xx — server-side failures",
    category: "http-api",
    severity: "critical",
    languages: ["any"],
    patterns: [
      // A bare 500 matches timestamps (`,500 INFO`) and byte counts, so a
      // status must appear with context: an access log field, a `status=`
      // key, or the standard reason phrase.
      /(?:status(?:_?code)?|responded with|responde?d|http)\D{0,14}5\d\d\b/i,
      // Application request lines: `GET /api/orders/1 -> 503 (12ms)`
      /\b(?:get|post|put|patch|delete|head|options)\s+\S+\s*(?:->|=>)\s*5\d\d\b/i,
      /" 5\d\d(?: |$)/,
      / 5\d\d \d+ "/,
      /\b5\d\d\b (?:internal|error|server|bad|service|gateway)/i,
      /internal server error/i,
      /bad gateway/i,
      /service unavailable/i,
      /gateway time-?out/i,
    ],
    reasons: [
      "An unhandled exception in a handler turned into a 500.",
      "An upstream the service depends on is failing, producing 502/503/504.",
      "The service is shedding load on purpose (overload protection) — healthy behaviour, but it needs capacity.",
      "The response was generated before the request was fully authenticated, exposing an internal error path.",
    ],
    fixes: [
      "Find the top failing endpoint and reproduce it with the request id from the log to reach the throwing frame.",
      "Put a timeout and a fallback on every outbound call so one dependency cannot fail the whole request.",
      "Distinguish overload (scale or shed deliberately) from bugs (fix the handler) using the error rate per route.",
    ],
  },
  {
    id: "http-4xx",
    title: "HTTP 4xx — client errors",
    category: "http-api",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /(?:status(?:_?code)?|responded with|responde?d|http)\D{0,14}4\d\d\b/i,
      // Application request lines: `GET /api/orders/1 -> 404 (12ms)`
      /\b(?:get|post|put|patch|delete|head|options)\s+\S+\s*(?:->|=>)\s*4\d\d\b/i,
      /" 4\d\d(?: |$)/,
      / 4\d\d \d+ "/,
      /\b4\d\d\b (?:bad|not found|unauthorized|forbidden|unprocessable|conflict|client)/i,
      /not found/i,
      /unprocessable entity/i,
    ],
    reasons: [
      "A client sends parameters the API never accepted, or a required field is missing.",
      "A route was renamed or removed while old clients still call it.",
      "An identifier is wrong: stale id, wrong tenant, wrong environment.",
      "Authentication or authorisation fails because a token expired or the caller lacks permission.",
    ],
    fixes: [
      "Group 4xx by path and status to spot one broken client rather than a server problem.",
      "Return a machine-readable error code and message so clients can react without parsing prose.",
      "Version or deprecate routes instead of deleting them silently.",
    ],
  },
  {
    id: "rate-limit",
    title: "Rate limiting / throttling (429)",
    category: "http-api",
    severity: "warning",
    languages: ["any"],
    patterns: [/\b429\b/, /rate limit/i, /throttl/i, /too many requests/i, /quota exceeded/i, /retry-after/i],
    reasons: [
      "A client bursts above the configured limit, often because it retries aggressively.",
      "Many clients share one API key or one IP, so the limit hits the wrong tenant.",
      "The limit is global instead of per-endpoint, so cheap calls consume a budget meant for expensive ones.",
    ],
    fixes: [
      "Back off exponentially and honour `Retry-After` before retrying.",
      "Make limits per-customer and per-endpoint, and expose the remaining budget in a response header.",
      "Batch or debounce client calls that hit the limit.",
    ],
  },

  // ----------------------------------------------------------------- security
  {
    id: "auth-failure",
    title: "Authentication and authorization failures",
    category: "security",
    severity: "warning",
    languages: ["any"],
    patterns: [/unauthorized/i, /forbidden/i, /authentication fail/i, /invalid (credentials|password|token|user)/i, /token expired/i, /jwt/i, /signature has expired/i, /permission denied/i, /access denied/i, /failed password/i, /invalid user/i, /(?:status(?:_?code)?|responded with)\D{0,14}40[13]\b/i],
    reasons: [
      "Credentials expired and were not refreshed proactively.",
      "Clocks are out of sync, so valid tokens are rejected.",
      "A secret was rotated on one side only.",
      "A genuine attack: credential stuffing or brute force from many sources.",
      "A missing permission in the role mapping after a refactor.",
    ],
    fixes: [
      "Separate the two populations: a steady trickle is expiry, a sudden spike from many IPs is an attack.",
      "Refresh tokens before expiry and keep clocks in sync.",
      "Rate-limit and alert on failed auth per source; block repeated attempts rather than only logging them.",
    ],
  },
  {
    id: "injection",
    title: "Injection / path traversal / SSRF",
    category: "security",
    severity: "critical",
    languages: ["sql", "shell", "any"],
    patterns: [/sql injection/i, /\.\.\//, /path traversal/i, /ssrf/i, /command injection/i, /injection detected/i, /nosql injection/i],
    reasons: [
      "User input is concatenated into a query, shell command or file path instead of being parameterised.",
      "Validation exists but runs after the dangerous operation, or on the wrong value.",
      "An internal-only endpoint is reachable from user input (SSRF).",
    ],
    fixes: [
      "Use parameterised queries / prepared statements everywhere, including dynamically built filters.",
      "Resolve and validate paths against an allow-list before opening a file.",
      "Block outbound requests to private address ranges and require an explicit allow-list for external calls.",
    ],
  },

  // ------------------------------------------------------------ data integrity
  {
    id: "corruption",
    title: "Corruption, truncation or checksum mismatch",
    category: "data-integrity",
    severity: "critical",
    languages: ["any"],
    patterns: [/corrupt/i, /checksum mismatch/i, /unexpected eof/i, /truncated/i, /bad signature/i, /malformed/i, /invalid (json|utf-?8|packet)/i],
    reasons: [
      "A producer wrote a partial record and the reader did not handle short reads.",
      "Two processes wrote the same file concurrently without locking.",
      "An encoding mismatch (UTF-8 vs latin-1) breaks parsing mid-record.",
      "Data was transformed lossily in an ETL step.",
    ],
    fixes: [
      "Write to a temp file and atomically rename, so readers never observe a half-written record.",
      "Validate checksums or record framing on read and quarantine the bad record instead of crashing the job.",
      "Pin the encoding explicitly on both sides of every boundary.",
    ],
  },
  {
    id: "deserialization",
    title: "Deserialization failure / bad payload",
    category: "data-integrity",
    severity: "warning",
    languages: ["java", "python", "javascript"],
    patterns: [/cannot deserialize/i, /unexpected token/i, /jsonparseexception/i, /malformed (message|argument)/i, /invalidpayload/i, /typeerror:.*(object|property)/i],
    reasons: [
      "Producer and consumer are on different versions of the message schema.",
      "Optional fields were made required (or renamed) in one version only.",
      "The payload was double-encoded (a JSON string inside JSON).",
      "A default value or null was written where the schema expects a concrete type.",
    ],
    fixes: [
      "Version the payload and keep readers tolerant of unknown fields for at least one release.",
      "Validate against a schema at the boundary and reject with a clear message including the offending field.",
      "Add a contract test that round-trips a real payload between producer and consumer in CI.",
    ],
  },

  // ------------------------------------------------------------- configuration
  {
    id: "config-missing",
    title: "Missing or invalid configuration",
    category: "configuration",
    severity: "critical",
    languages: ["any"],
    patterns: [/config(uration)? (not )?(found|missing|invalid)/i, /missing required (environment )?variable/i, /unresolved placeholder/i, /could not resolve (host|url|address)/i, /unknown option/i, /invalid (value|option|argument)/i],
    reasons: [
      "A new required variable was added but not set in one environment.",
      "A secret was rotated and the old value is still deployed.",
      "Environment-specific values (URLs, buckets, DSNs) are hard-coded or inherited from the wrong stage.",
      "A placeholder like `${TOKEN}` was never substituted at deploy time.",
    ],
    fixes: [
      "Fail fast at startup on missing configuration instead of at first use.",
      "Validate and log the *shape* of the configuration (which keys are set) on boot, never the values.",
      "Keep environment differences in one reviewed file per environment, not scattered in code.",
    ],
  },
  {
    id: "env-drift",
    title: "Environment/version drift",
    category: "configuration",
    severity: "info",
    languages: ["any"],
    patterns: [/deprecat/i, /will be removed/i, /no longer supported/i, /end of life/i, /version mismatch/i, /legacy (api|endpoint|mode)/i],
    reasons: [
      "A dependency deprecated an API that the code still calls.",
      "Instances are running different versions, so behaviour differs between hosts behind one load balancer.",
      "A platform feature reached end of life and the old path still works but warns.",
    ],
    fixes: [
      "Track each deprecation warning to a ticket with the version that removes it.",
      "Assert a single version across instances at boot and in the health endpoint.",
      "Pin dependency versions and schedule upgrades before the removal release.",
    ],
  },

  // -------------------------------------------------------------- performance
  {
    id: "slow-operation",
    title: "Slow operation / latency overrun",
    category: "performance",
    severity: "warning",
    languages: ["any"],
    patterns: [/took \d+ ?ms/i, /elapsed/i, /slow (query|request|operation)/i, /latency exceeded/i, /degraded/i, /took \d+(\.\d+)? ?(seconds|sec|s)\b/i],
    reasons: [
      "N+1 access patterns: many small round-trips instead of one batched query.",
      "A cache miss storm after an eviction or restart.",
      "Lock contention or a slow neighbour sharing the same resources.",
      "Cold starts: JIT, lazy module loading, connection pools filling up.",
    ],
    fixes: [
      "Compare the slow path against its latency budget and instrument the phases to find where the time goes.",
      "Batch or cache the repeated work; warm caches and connection pools before taking traffic.",
      "Alert on latency percentiles (p95/p99), not averages, so tail problems are visible.",
    ],
  },
  {
    id: "cpu-hot",
    title: "CPU saturation / GC-bound loop",
    category: "performance",
    severity: "warning",
    languages: ["any"],
    patterns: [/high (cpu )?load/i, /cpu (usage|throttl)/i, /re-?executed.*loop/i, /busy loop/i, /throttled/i],
    reasons: [
      "A hot loop with no backoff spins waiting for a condition.",
      "Work is duplicated across instances because a lock or leader election failed.",
      "Regular expressions or serialisation run on every request with no caching.",
    ],
    fixes: [
      "Replace spin loops with events, sleeps with jitter, or bounded polling.",
      "Profile with a sampling profiler before optimising; the hot path is rarely the suspected one.",
      "Cap concurrency so a traffic spike cannot saturate the CPU.",
    ],
  },

  // ------------------------------------------------------------- dependencies
  {
    id: "dependency-conflict",
    title: "Dependency version conflict",
    category: "dependencies",
    severity: "warning",
    languages: ["node", "python", "java", "dotnet"],
    patterns: [/peer dep/i, /npm err/i, /requires a peer of/i, /incompatible (version|api)/i, /no matching (version|distribution)/i, /could not find a version/i, /dependency resolution/i],
    reasons: [
      "Two libraries pin different major versions of the same transitive dependency.",
      "A lockfile was regenerated or ignored, so installs are no longer reproducible.",
      "An install resolved a different platform-specific binary than the one tested.",
    ],
    fixes: [
      "Commit and enforce the lockfile; install with a frozen-lockfile mode in CI.",
      "Align the offending packages on compatible major versions, or override explicitly with a documented reason.",
      "Pin transitive versions in CI and re-test upgrades on a schedule rather than at deploy time.",
    ],
  },
  {
    id: "schema-mismatch",
    title: "Contract / schema mismatch",
    category: "dependencies",
    severity: "warning",
    languages: ["any"],
    patterns: [/unknown field/i, /unrecognized field/i, /additional propert/i, /missing required property/i, /invalid schema/i, /contract mismatch/i],
    reasons: [
      "The producer was deployed before the consumer (or the other way round).",
      "A field was renamed or its type changed without versioning.",
      "A generated client is out of date with the server definition.",
    ],
    fixes: [
      "Deploy in the order that keeps both sides compatible, then remove the old field in a later release.",
      "Version the contract and test producer/consumer pairs together in CI.",
      "Regenerate clients in the build so they cannot drift from the schema.",
    ],
  },
];

/**
 * The full directory. The base entries live in this file and the wider set in
 * `error-catalog-extended*.ts`; they are merged here so every consumer — the
 * directory page, the analyzer, the report and the exports — sees one list.
 */
export const ERROR_CATALOG: ErrorCatalogEntry[] = [
  ...BASE_ERROR_CATALOG,
  ...EXTENDED_ERROR_CATALOG,
  ...EXTENDED_ERROR_CATALOG_2,
  ...EXTENDED_ERROR_CATALOG_3,
  ...EXTENDED_ERROR_CATALOG_4,
];

export const CATALOG_BY_ID = new Map(ERROR_CATALOG.map((entry) => [entry.id, entry]));

/** Number of entries per category, used by the directory page filter chips. */
export const CATEGORY_COUNTS = ERROR_CATALOG.reduce<Record<ErrorCategory, number>>(
  (counts, entry) => {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
    return counts;
  },
  {} as Record<ErrorCategory, number>,
);

export interface CatalogMatchInput {
  /** Grouped issues from the report. */
  issues: { id: string; pattern: string; title: string; exceptionType?: string; count: number; samples?: { raw: string }[] }[];
  /** Exception types with their counts. */
  exceptionTypes: { type: string; count: number }[];
  /** Optional extra text (for example the file name) to match against. */
  extraText?: string;
}

export interface CatalogMatch {
  catalogId: string;
  title: string;
  category: ErrorCategory;
  severity: CatalogSeverity;
  /** Total number of log lines attributed to this entry. */
  occurrences: number;
  /** Grouped-issue ids that matched. */
  issueIds: string[];
  /** One real line from the log that triggered the match. */
  example?: string;
}

/**
 * Match grouped issues against the directory. Every line of a matching issue is
 * attributed to the entry, so occurrences add up to the real count in the file.
 */
export function matchCatalog(input: CatalogMatchInput): CatalogMatch[] {
  const matches = new Map<string, CatalogMatch>();

  /** Structured text of an issue: the fingerprint and the exception type. */
  const structured = (issue: CatalogMatchInput["issues"][number]) =>
    [issue.pattern, issue.title, issue.exceptionType ?? "", input.extraText ?? ""]
      .join(" ")
      .toLowerCase();

  /** Raw example lines, used only when the structured text says nothing. */
  const examples = (issue: CatalogMatchInput["issues"][number]) =>
    (issue.samples ?? []).map((sample) => sample.raw).join(" ").toLowerCase();

  for (const entry of ERROR_CATALOG) {
    for (const issue of input.issues) {
      // Two-phase matching keeps precision high: the fingerprint is tried
      // first, and the raw examples are only consulted when nothing matched.
      // That is what catches JSON logs whose stack trace lives in a field
      // rather than in the message.
      const hit =
        entry.patterns.some((pattern) => pattern.test(structured(issue))) ||
        entry.patterns.some((pattern) => pattern.test(examples(issue)));
      if (!hit) continue;

      const existing = matches.get(entry.id);
      if (existing) {
        existing.occurrences += issue.count;
        existing.issueIds.push(issue.id);
        existing.example ??= issue.samples?.[0]?.raw;
      } else {
        matches.set(entry.id, {
          catalogId: entry.id,
          title: entry.title,
          category: entry.category,
          severity: entry.severity,
          occurrences: issue.count,
          issueIds: [issue.id],
          example: issue.samples?.[0]?.raw,
        });
      }
    }
  }

  // Exception types can match on their own, e.g. a stack trace whose grouped
  // issue was a generic "failed" message.
  for (const { type, count } of input.exceptionTypes) {
    for (const entry of ERROR_CATALOG) {
      // Already attributed from a grouped issue: counting again would inflate it.
      if (matches.has(entry.id)) continue;
      if (!entry.patterns.some((pattern) => pattern.test(type.toLowerCase()))) continue;
      matches.set(entry.id, {
        catalogId: entry.id,
        title: entry.title,
        category: entry.category,
        severity: entry.severity,
        occurrences: count,
        issueIds: [],
        example: type,
      });
    }
  }

  const rank: Record<CatalogSeverity, number> = { critical: 3, warning: 2, info: 1 };
  return [...matches.values()].sort(
    (a, b) => rank[b.severity] - rank[a.severity] || b.occurrences - a.occurrences,
  );
}
