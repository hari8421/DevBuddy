import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast, Toaster } from "sonner";
import { TrashIcon } from "@radix-ui/react-icons";

import { SiteHeader } from "@/components/SiteHeader";
import { LogDropzone, type PickedFile } from "@/components/LogDropzone";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { SAMPLE_FILES, fetchSample } from "@/lib/samples";
import { analyzeLog, formatBytes } from "@/lib/analyzer";
import {
  clearAnalyses,
  deleteAnalysis,
  historySizeBytes,
  saveAnalysis,
} from "@/lib/history";
import { useAnalyses } from "@/lib/useAnalyses";

interface Job {
  label: string;
  percent: number;
  done: number;
  total: number;
}

/** One file to analyze; the text is only read when its turn comes. */
interface PendingFile {
  name: string;
  sizeBytes: number;
  text: () => Promise<string>;
}

export function DashboardPage() {
  const analyses = useAnalyses();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);

  const analyzeAndSave = useCallback(
    async (files: PendingFile[]) => {
      setJob({ label: files[0]?.name ?? "", percent: 0, done: 0, total: files.length });
      const savedIds: string[] = [];

      try {
        for (let index = 0; index < files.length; index++) {
          const file = files[index];
          setJob((current) =>
            current ? { ...current, label: file.name, done: index, percent: 0 } : current,
          );

          // Read and analyze one file at a time: the decoded text becomes
          // garbage as soon as the report exists, so a 200 MB log is never
          // held in memory alongside the rest of the batch.
          const text = await file.text();
          const report = await analyzeLog(text, {
            fileName: file.name,
            sizeBytes: file.sizeBytes,
            onProgress: ({ percent }) =>
              setJob((current) => (current ? { ...current, percent } : current)),
          });

          savedIds.push(saveAnalysis(report).id);

          setJob((current) =>
            current ? { ...current, done: index + 1, percent: 100 } : current,
          );
        }

        if (savedIds.length === 1) {
          void navigate(`/app/analysis/${savedIds[0]}`);
        } else {
          toast.success(`Analyzed ${savedIds.length} files`, {
            description: "Open one from the list below.",
          });
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Analysis failed unexpectedly",
        );
      } finally {
        setJob(null);
      }
    },
    [navigate],
  );

  const handlePicked = useCallback(
    async (picked: PickedFile[]) => {
      // `file.size` is the exact size on disk; decoding is deferred until the
      // file's turn, so nothing large is read up front.
      await analyzeAndSave(
        picked.map(({ name, file }) => ({
          name,
          sizeBytes: file.size,
          text: () => file.text(),
        })),
      );
    },
    [analyzeAndSave],
  );

  const handleSample = useCallback(
    async (path: string, name: string) => {
      try {
        const sample = await fetchSample({ name, path, description: "", badge: "" });
        await analyzeAndSave([
          {
            name: sample.name,
            sizeBytes: new Blob([sample.text]).size,
            text: () => Promise.resolve(sample.text),
          },
        ]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not load the sample",
        );
      }
    },
    [analyzeAndSave],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="container flex-1 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Log analyzer</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              No account needed. Files are parsed in this browser tab and the
              report is saved in this browser only.
            </p>
          </div>
          <ButtonLink />
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-6">
            <LogDropzone onFiles={(files) => void handlePicked(files)} disabled={job !== null} />

            {job ? (
              <div className="panel space-y-3 p-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono">{job.label}</span>
                  <span className="text-muted-foreground">
                    {job.total > 1
                      ? `file ${job.done + 1} of ${job.total}`
                      : `${job.percent}%`}
                  </span>
                </div>
                <Progress
                  value={job.total > 1 ? (job.done / job.total) * 100 : job.percent}
                />
                <p className="text-xs text-muted-foreground">
                  Parsing locally — the tab stays usable while this runs.
                </p>
              </div>
            ) : null}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Or start from a sample
                </h2>
                <Link
                  to="/errors"
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Browse the error directory →
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {SAMPLE_FILES.map((sample) => (
                  <button
                    key={sample.name}
                    type="button"
                    disabled={job !== null}
                    onClick={() => void handleSample(sample.path, sample.name)}
                    className="panel p-4 text-left transition-colors hover:border-primary/60 disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{sample.name}</span>
                      <Badge variant="outline">{sample.badge}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {sample.description}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="panel h-fit overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-medium">Saved reports</h2>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{analyses.length}</Badge>
                {analyses.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    onClick={() => {
                      clearAnalyses();
                      toast.success("History cleared");
                    }}
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
            </div>

            {analyses.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                Nothing yet. Upload a log or pick a sample above — reports stay
                in this browser.
              </p>
            ) : (
              <ul className="divide-y">
                {analyses.map((analysis) => (
                  <li key={analysis.id} className="flex items-center gap-3 px-5 py-3">
                    <Link
                      to={`/app/analysis/${analysis.id}`}
                      className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <p className="truncate font-mono text-sm">{analysis.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{analysis.format}</span>
                        <span>·</span>
                        <span>{analysis.lineCount.toLocaleString()} lines</span>
                        <span>·</span>
                        <span
                          className={
                            analysis.errorCount > 0 ? "text-severity-error" : ""
                          }
                        >
                          {analysis.errorCount} errors
                        </span>
                      </p>
                    </Link>
                    <Badge
                      variant={
                        analysis.healthScore >= 75
                          ? "default"
                          : analysis.healthScore >= 50
                            ? "outline"
                            : "destructive"
                      }
                    >
                      {analysis.healthScore}
                    </Badge>
                    <button
                      type="button"
                      aria-label={`Delete ${analysis.name}`}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        deleteAnalysis(analysis.id);
                        toast.success("Report deleted");
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t px-5 py-2.5 text-[11px] text-muted-foreground">
              Stored in this browser ·{" "}
              {formatBytes(historySizeBytes())} used · nothing is uploaded
            </p>
          </section>
        </div>
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}

function ButtonLink() {
  return (
    <Link
      to="/errors"
      className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      Error directory
    </Link>
  );
}
