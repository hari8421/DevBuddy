import { Link, useParams } from "react-router-dom";
import { useState } from "react";
import { toast, Toaster } from "sonner";

import { SiteHeader } from "@/components/SiteHeader";
import { ReportView } from "@/components/report/ReportView";
import { DownloadMenu } from "@/components/DownloadMenu";
import { Button } from "@/components/ui/button";
import { useAnalysis } from "@/lib/useAnalyses";
import { copyText, reportToSummary } from "@/lib/export";

export function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const analysis = useAnalysis(id);
  const [copied, setCopied] = useState(false);

  const copySummary = async () => {
    if (!analysis) return;
    const ok = await copyText(reportToSummary(analysis.report));
    if (ok) {
      setCopied(true);
      toast.success("Summary copied to the clipboard");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Clipboard is not available");
    }
  };

  if (!id || !analysis) {
    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="container flex-1 py-24 text-center">
          <h1 className="text-2xl font-semibold">Report not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reports live in the browser that created them, so this link does not
            resolve here. Analyse the file again on this device.
          </p>
          <Button asChild className="mt-6">
            <Link to="/app">Back to the dashboard</Link>
          </Button>
        </main>
      </div>
    );
  }

  const { report } = analysis;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="container flex-1 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/app"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Dashboard
          </Link>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void copySummary()}>
              {copied ? "Copied" : "Copy summary"}
            </Button>
            <DownloadMenu report={report} />
          </div>
        </div>

        <ReportView report={report} />
      </main>

      <Toaster position="bottom-right" />
    </div>
  );
}
