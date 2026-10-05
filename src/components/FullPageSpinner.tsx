import { Logo } from "@/components/Logo";

/** Centered loading state used while a report is read from local storage. */
export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-3">
      <Logo className="h-9 w-9 animate-pulse" />
      {label ? <p className="text-sm text-muted-foreground">{label}</p> : null}
    </div>
  );
}
