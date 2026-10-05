import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { UploadIcon } from "@radix-ui/react-icons";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/analyzer";

/** Files above this size are still accepted, but the user gets a heads-up. */
const LARGE_FILE_WARNING = 120 * 1024 * 1024;

export interface PickedFile {
  name: string;
  file: File;
}

export function LogDropzone({
  onFiles,
  disabled,
}: {
  onFiles: (files: PickedFile[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list).filter((file) => file.size > 0);
      if (files.length === 0) {
        toast.error("That file is empty");
        return;
      }
      const large = files.filter((file) => file.size > LARGE_FILE_WARNING);
      if (large.length > 0) {
        toast.warning(
          `${large.map((file) => formatBytes(file.size)).join(", ")} — large files can take a while, so the tab will stay busy.`,
        );
      }
      if (files.length > 10) {
        toast.warning("Analyzing the first 10 files.");
      }
      onFiles(files.slice(0, 10).map((file) => ({ name: file.name, file })));
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        "panel relative flex flex-col items-center justify-center gap-4 border-dashed px-6 py-14 text-center transition-colors",
        dragging && "border-primary bg-primary/5",
        disabled && "opacity-60",
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/50">
        <UploadIcon className="h-5 w-5 text-primary" />
      </div>

      <div>
        <p className="text-lg font-medium">Drop log files here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Any format: JSON lines, access logs, Java, Python, Node, Go, .NET,
          syslog — parsed locally in this tab.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Choose files
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => folderRef.current?.click()}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          Choose a folder
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        // Non-standard but supported in Chromium, Firefox and Safari.
        {...{ webkitdirectory: "", directory: "" }}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}