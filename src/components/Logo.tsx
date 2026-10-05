import { cn } from "@/lib/utils";

/** Terminal-window mark with a severity sweep inside it. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="LogLens"
      className={cn("h-7 w-7", className)}
    >
      <rect
        x="1.5"
        y="3.5"
        width="29"
        height="25"
        rx="5"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.5"
      />
      <path
        d="M7 11.5l4 4-4 4"
        className="stroke-primary"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect x="14.5" y="18.4" width="10" height="2.1" rx="1" className="fill-primary" />
      <circle cx="8" cy="24" r="1.4" className="fill-severity-error" />
      <circle cx="13" cy="24" r="1.4" className="fill-severity-warn" />
      <circle cx="18" cy="24" r="1.4" className="fill-severity-info" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-mono text-lg font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      log<span className="text-primary">lens</span>
    </span>
  );
}