/**
 * Download / export menu for a finished report.
 *
 * The menu lists every supported export format with a one-line description of
 * what it contains, plus copy-to-clipboard for the JSON payload and the short
 * chat summary. All of it happens in the browser: no report data is uploaded.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  GlobeIcon,
  MessageIcon,
  TableIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EXPORT_FORMATS,
  copyText,
  downloadReport,
  exportLabel,
  reportToJson,
  reportToMarkdown,
  reportToSummary,
  type ReportExportFormat,
} from "@/lib/export";
import type { LogReport } from "@/lib/analyzer";

const FORMAT_ICON: Record<ReportExportFormat, typeof FileIcon> = {
  json: FileIcon,
  csv: TableIcon,
  markdown: FileIcon,
  html: GlobeIcon,
};

export function DownloadMenu({ report }: { report: LogReport }) {
  const [busy, setBusy] = useState<string | null>(null);

  const handleDownload = (format: ReportExportFormat) => {
    setBusy(format);
    try {
      const fileName = downloadReport(report, format);
      toast.success(`Downloaded ${fileName}`);
    } catch {
      toast.error("The download could not be started in this browser");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async (label: string, value: () => string) => {
    const ok = await copyText(value());
    if (ok) toast.success(`${label} copied to the clipboard`);
    else toast.error("Clipboard is not available in this browser");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={Boolean(busy)}>
          <DownloadIcon className="mr-2 h-3.5 w-3.5" />
          {busy ? "Preparing…" : "Download"}
          <ChevronDownIcon className="ml-2 h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Download report</DropdownMenuLabel>
        {EXPORT_FORMATS.map((format) => {
          const Icon = FORMAT_ICON[format.id];
          return (
            <DropdownMenuItem
              key={format.id}
              onSelect={() => handleDownload(format.id)}
              className="items-start gap-2 py-2"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {exportLabel(format.id)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {format.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Copy instead</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => void handleCopy("Report JSON", () => reportToJson(report))}
          className="gap-2"
        >
          <CopyIcon className="h-4 w-4 text-muted-foreground" />
          Report JSON
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void handleCopy("Summary", () => reportToSummary(report))}
          className="gap-2"
        >
          <MessageIcon className="h-4 w-4 text-muted-foreground" />
          Chat / ticket summary
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void handleCopy("Markdown", () => reportToMarkdown(report))
          }
          className="gap-2"
        >
          <FileIcon className="h-4 w-4 text-muted-foreground" />
          Markdown write-up
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <CheckIcon className="mr-1 inline h-3 w-3" />
          Files are generated in your browser. Nothing is uploaded.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}