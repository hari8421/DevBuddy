/**
 * Extended error directory entries.
 *
 * The base directory lives in `error-catalog.ts`; these are the additional
 * failure modes that were added to widen coverage. They are split into files
 * only to keep each one reviewable — `ERROR_CATALOG` concatenates both sets, so
 * consumers (the directory page, the analyzer, the report) see a single list.
 *
 * Every entry keeps the same shape: patterns that identify it in a log, why it
 * normally happens, and the fixes that work.
 */

import type { ErrorCatalogEntry } from "./error-catalog";

export const EXTENDED_ERROR_CATALOG: ErrorCatalogEntry[] = [
  // ------------------------------------------------------------ runtime crash
  {
    id: "stack-overflow",
    title: "Stack overflow / runaway recursion",
    category: "runtime-crash",
    severity: "critical",
    languages: ["java", "javascript", "python", "c#", "go", "rust"],
    patterns: [
      /stack ?overflow/i,
      /stackoverflowerror/i,
      /maximum call stack size exceeded/i,
      /recursion (error|limit)/i,
    ],
    reasons: [
      "A recursive function has no base case for the new input, or the base case was moved but one call site was not updated.",
      "Two objects reference each other, so a tree walk (JSON, ORM, expression evaluator) never terminates.",
      "A retry inside a retry wrapper re-enters the same call instead of waiting.",
    ],
    fixes: [
      "Read the trace: the repeating frame pair at the bottom names the recursion that never ends.",
      "Add a depth or cycle guard, and make the base case explicit and tested.",
      "Rewrite deep recursion as an explicit work list or a loop when the depth is data-driven.",
    ],
  },
  {
    id: "class-cast",
    title: "Class cast / type mismatch",
    category: "runtime-crash",
    severity: "critical",
    languages: ["java", "c#", "python"],
    patterns: [
      /class ?cast ?exception/i,
      /cannot be cast to/i,
      /invalidcastexception/i,
      /is not an instance of/i,
      /expected .* got .*/i,
    ],
    reasons: [
      "An interface has several implementations and the code assumed the concrete type it used to receive.",
      "A column, JSON field or cache entry is polymorphic, but the read path was written for one type only.",
      "A dependency upgraded and returned a subclass or a different container type.",
    ],
    fixes: [
      "Handle the declared type at the boundary and convert once, explicitly, where the concrete type is known.",
      "Log the runtime class on failure so the offending row or key is identifiable.",
      "Cover each implementation with a test — polymorphism that is only exercised by one type will break.",
    ],
  },
  {
    id: "illegal-argument",
    title: "Illegal argument / precondition failed",
    category: "runtime-crash",
    severity: "warning",
    languages: ["java", "rust", "python", "go", "c"],
    patterns: [
      /illegalargument/i,
      /illegal argument/i,
      /argument(?:s)? (?:must|should|has to) be/i,
      /precondition (?:failed|not met)/i,
      /value out of (?:range|domain)/i,
      /invalid (?:argument|parameter) .*:/i,
    ],
    reasons: [
      "A caller violated the documented contract; the callee checks it but the caller was never fixed.",
      "Input from outside the system (config, request, queue message) reached the domain unchecked.",
      "Units or scale differ between producer and consumer (seconds vs milliseconds, cents vs euros).",
    ],
    fixes: [
      "Validate at the boundary and return a 4xx with the offending field, not an exception from deep code.",
      "State units in names and types (`durationMs`, `sizeBytes`) so the mismatch is a compile error.",
      "Turn the failing assertion into a test that reproduces the caller's mistake.",
    ],
  },
  {
    id: "arithmetic-error",
    title: "Division by zero / arithmetic failure",
    category: "runtime-crash",
    severity: "warning",
    languages: ["java", "python", "go", "c", "rust", "javascript"],
    patterns: [
      /division by zero/i,
      /zerodivisionerror/i,
      /arithmetic ?exception/i,
      /divide by zero/i,
      /modulo by zero/i,
    ],
    reasons: [
      "A denominator can legitimately be zero: no rows yet, an empty time bucket, a percentage of an empty set.",
      "Integer division truncates to zero where floating point was assumed.",
      "A null/optional became zero during deserialization instead of staying absent.",
    ],
    fixes: [
      "Guard the divisor and decide explicitly what a zero denominator means (return 0, skip, or fail).",
      "Aggregate in floating point and round only at the presentation edge.",
      "Keep missing values as absent rather than defaulting them to zero.",
    ],
  },
  {
    id: "resource-closed",
    title: "Use after close / released resource",
    category: "runtime-crash",
    severity: "critical",
    languages: ["java", "c#", "python", "go"],
    patterns: [
      /stream is closed/i,
      /closed channel/i,
      /connection is closed/i,
      /object has been closed/i,
      /use after (close|free|dispose)/i,
      /i\/o exception.*closed/i,
    ],
    reasons: [
      "The resource is closed in a `finally` block while a caller still holds and uses it.",
      "A shared cache, pool or session client was closed by one request while another was still using it.",
      "Cleanup ran twice (double close) and the second close tore down a reused object.",
    ],
    fixes: [
      "Make ownership explicit: the code that opens a resource closes it, and nobody else calls close.",
      "Return pooled objects through `finally` blocks so a connection is never abandoned on an exception.",
      "Guard close with an idempotent flag when several code paths can trigger it.",
    ],
  },

  // ------------------------------------------------------------------- memory
  {
    id: "memory-leak",
    title: "Memory leak / unbounded growth",
    category: "memory",
    severity: "warning",
    languages: ["java", "javascript", "python", "go", "c#", "ruby"],
    patterns: [
      /memory leak/i,
      /heap (?:is )?(?:growing|growth)/i,
      /retained (?:size|memory)/i,
      /cache (?:size|entries) (?:grew|exceeded|limit)/i,
      /memory usage (?:grew|is growing|increased)/i,
      /evicted \d+ entries/i,
    ],
    reasons: [
      "A collection keyed by request id, user id or url grows forever because nothing evicts entries.",
      "Listeners, subscriptions, timers or contexts are registered per request and never removed.",
      "Objects stay reachable through a static registry, an event bus or a long-lived closure.",
    ],
    fixes: [
      "Put every cache behind a size or TTL bound, and log its size so growth is visible.",
      "Use try-with-resources / weak references for anything whose lifetime is shorter than the process.",
      "Compare heap histograms across time: a steadily growing class is the leak, not the log line.",
    ],
  },
  {
    id: "metaspace",
    title: "Metaspace / class-loading exhaustion",
    category: "memory",
    severity: "warning",
    languages: ["java", "jvm"],
    patterns: [
      /metaspace/i,
      /class ?loader.*(leak|error)/i,
      /outofmemoryerror: metaspace/i,
      /unable to load class/i,
      /classnotfoundexception/i,
    ],
    reasons: [
      "A class loader is referenced from a static field, a JDBC driver or a thread, so its classes can never unload.",
      "Redeploying in a container leaks a class loader per deploy until metaspace runs out.",
      "Dynamic proxies or generated classes are created per request instead of per type.",
    ],
    fixes: [
      "Cache dynamic classes instead of generating them per call, and reuse class loaders.",
      "Restart the JVM (or the pod) after a redeploy if the container cannot unload the loader.",
      "Track metaspace usage as a metric and alert before the OOM, not after.",
    ],
  },
  {
    id: "buffer-overflow",
    title: "Buffer overrun / native bounds violation",
    category: "memory",
    severity: "critical",
    languages: ["c", "c++", "rust", "go", "native"],
    patterns: [
      /buffer (?:overflow|overrun)/i,
      /stack smashing detected/i,
      /heap-buffer-overflow/i,
      /out of bounds (?:write|read)/i,
      /corrupted (?:size|top|double linked)/i,
    ],
    reasons: [
      "A C extension or driver wrote past an allocated buffer.",
      "A length field in a binary payload was trusted without validating it against the buffer size.",
      "Memory was freed and then reused while another thread still held a pointer to it.",
    ],
    fixes: [
      "Build with AddressSanitizer/UBSan and reproduce; the report names the exact write.",
      "Validate every length and offset read from the wire before using it.",
      "Move the parsing into memory-safe code and keep the native surface as small as possible.",
    ],
  },

  // -------------------------------------------------------------- concurrency
  {
    id: "thread-interrupted",
    title: "Thread interrupted / cancelled mid-work",
    category: "concurrency",
    severity: "warning",
    languages: ["java", "python", "go", "c#"],
    patterns: [
      /interruptedexception/i,
      /thread interrupted/i,
      /task (?:was )?cancel(?:led|ed)/i,
      /operation (?:was )?cancell?ed/i,
      /context canceled/i,
      /execution (?:was )?interrupted/i,
    ],
    reasons: [
      "The caller timed out and cancelled the child work, which is normal — but the child logs it as an error.",
      "A shutdown signal interrupts in-flight work, which then reports as a failure in the metrics.",
      "A future was cancelled before it started, and the waiting code treats cancellation as failure.",
    ],
    fixes: [
      "Handle cancellation as its own outcome: log at info/warn and do not count it as an error.",
      "Propagate the interrupt instead of swallowing it, and stop promptly rather than unwinding deep.",
      "Separate client disconnects from server faults in both logs and error budgets.",
    ],
  },
  {
    id: "atomicity-violation",
    title: "Lost update / non-atomic read-modify-write",
    category: "concurrency",
    severity: "critical",
    languages: ["java", "python", "go", "c#", "javascript", "node"],
    patterns: [
      /lost update/i,
      /concurrent modification/i,
      /atomicity/i,
      /read-?modify-?write/i,
      /optimistic lock.*(fail|exception)/i,
      /version mismatch.*update/i,
    ],
    reasons: [
      "A counter or balance is read, modified and written back without a compare-and-set or a lock.",
      "Two workers processed the same entity because the claim step was not atomic.",
      "An in-memory cache was updated without invalidating the copy other instances hold.",
    ],
    fixes: [
      "Use an atomic update (`SET x = x + 1`, `UPDATE … SET v = v + 1 WHERE v = ?`) or a version column.",
      "Claim work with a conditional write (`UPDATE … WHERE status = 'new'`) instead of read-then-write.",
      "Add a concurrency test that runs the same operation from many threads and asserts the total.",
    ],
  },
  {
    id: "semaphore-permit",
    title: "Permit / capacity limit reached",
    category: "concurrency",
    severity: "warning",
    languages: ["java", "go", "c#", "node"],
    patterns: [
      /no permits available/i,
      /semaphore/i,
      /acquire\(\) (?:failed|interrupted)/i,
      /concurrency limit/i,
      /max concurrency/i,
      /too many concurrent/i,
    ],
    reasons: [
      "The downstream dependency can only serve a limited number of calls at once and the client does not queue.",
      "A bulk job fans out without a global cap and exceeds the quota of the API it calls.",
      "Callers hold the permit for the whole request instead of only for the call that needs it.",
    ],
    fixes: [
      "Bound fan-out with a bulkhead and let callers wait or degrade instead of failing.",
      "Hold the permit for the shortest possible window and release it in a `finally`.",
      "Add a queue in front of the limiter so bursts are smoothed rather than dropped.",
    ],
  },

  // ------------------------------------------------------------------ network
  {
    id: "proxy-failure",
    title: "Proxy or gateway failure",
    category: "network",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /proxy (?:error|failed|failure)/i,
      /bad gateway/i,
      /gateway timeout/i,
      /upstream (?:sent invalid|prematurely closed|reset)/i,
      /no route to host through proxy/i,
      /tunneling socket could not be established/i,
    ],
    reasons: [
      "An HTTP proxy or service mesh sidecar is misconfigured (wrong upstream, wrong port, auth).",
      "The proxy has an idle or request timeout shorter than the slowest legitimate request.",
      "The proxy cannot reach the backend because DNS inside the proxy differs from the app's.",
    ],
    fixes: [
      "Check the proxy status page/configuration and compare its timeout with the application's budget.",
      "Keep connection pools per upstream so one failing route does not starve the others.",
      "Alert on proxy-generated 502/503 separately from origin 5xx — the fix is in different places.",
    ],
  },
  {
    id: "url-parse-error",
    title: "Malformed URL or host",
    category: "network",
    severity: "warning",
    languages: ["any"],
    patterns: [
      /malformed ?url/i,
      /invalid ?url/i,
      /url ?parse/i,
      /unknown url ?scheme|unsupported ?scheme/i,
      /no host ?(given|specified)/i,
      /illegal character in (?:url|host)/i,
    ],
    reasons: [
      "A configured base URL is missing a scheme, has a trailing slash duplicated, or has whitespace in it.",
      "User input is interpolated into a url without encoding, so a space or `{}` breaks parsing.",
      "A templated url was filled with an empty variable (`https:///orders`).",
    ],
    fixes: [
      "Validate urls once at startup so a bad configuration fails fast and loudly.",
      "Build urls with a url builder rather than string concatenation.",
      "Encode path segments and reject control characters at the boundary.",
    ],
  },
  {
    id: "http2-protocol",
    title: "HTTP/2 or protocol-level stream error",
    category: "network",
    severity: "warning",
    languages: ["java", "go", "node", "c#"],
    patterns: [
      /goaway/i,
      /stream (?:error|closed|reset)/i,
      /rst_stream/i,
      /http2 protocol error/i,
      /connection error.*http\/2/i,
      /refused stream/i,
    ],
    reasons: [
      "The server sends GOAWAY during a rolling deploy and in-flight streams are reset.",
      "One client's streams are multiplexed behind a single connection, so a lost TCP connection kills all of them.",
      "The client opens more concurrent streams than the server's SETTINGS allows.",
    ],
    fixes: [
      "Treat a GOAWAY/reset as retryable and retry on a fresh connection, not the dead one.",
      "Respect SETTINGS_MAX_CONCURRENT_STREAMS instead of assuming one request per connection.",
      "Log the stream id and connection id so a client-side reset can be traced to one request.",
    ],
  },
];