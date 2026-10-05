import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { LEVEL_BG, type LogLevel, type TimelineBucket } from "@/lib/analyzer";

/** Donut gauge used for the health score. */
export function HealthGauge({
  score,
  size = 96,
}: {
  score: number;
  size?: number;
}) {
  const stroke = size / 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  const tone =
    score >= 75
      ? "stroke-primary"
      : score >= 50
        ? "stroke-severity-warn"
        : "stroke-severity-error";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Health score ${score}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="fill-none stroke-muted"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={cn("fill-none transition-[stroke-dashoffset] duration-700", tone)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-xl font-semibold">{score}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          health
        </span>
      </div>
    </div>
  );
}

export interface SeveritySlice {
  level: LogLevel;
  count: number;
}

/** Single stacked bar describing the severity mix of a file. */
export function SeverityBar({ slices }: { slices: SeveritySlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const visible = slices.filter((slice) => slice.count > 0);

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {total === 0 ? null : visible.map((slice) => (
          <div
            key={slice.level}
            className={cn(LEVEL_BG[slice.level], "transition-[width] duration-500")}
            style={{ width: `${(slice.count / total) * 100}%` }}
            title={`${slice.level}: ${slice.count.toLocaleString()}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {visible.map((slice) => (
          <div key={slice.level} className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 rounded-full", LEVEL_BG[slice.level])} />
            <span className="uppercase tracking-wide text-muted-foreground">
              {slice.level}
            </span>
            <span className="font-mono">
              {slice.count.toLocaleString()}
              <span className="ml-1 text-muted-foreground">
                {total ? `${((slice.count / total) * 100).toFixed(1)}%` : "0%"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Label / bar / value row used for loggers, endpoints and source files. */
export function BarList({
  items,
  emptyLabel = "No data",
  formatValue,
}: {
  items: { label: string; value: number; secondary?: string; tone?: string }[];
  emptyLabel?: string;
  formatValue?: (value: number) => string;
}) {
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1">
          <span className="truncate font-mono text-xs" title={item.label}>
            {item.label}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {formatValue ? formatValue(item.value) : item.value.toLocaleString()}
            {item.secondary ? ` · ${item.secondary}` : ""}
          </span>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", item.tone ?? "bg-primary/70")}
              style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Activity over time. Buckets arrive pre-computed from the engine, so this only
 * has to pick sensible bar widths and keep the hover readout accurate.
 */
export function TimelineChart({ buckets }: { buckets: TimelineBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(
    () => buckets.reduce((peak, bucket) => Math.max(peak, bucket.total), 0),
    [buckets],
  );

  if (buckets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No timestamps were found in this file, so there is nothing to plot over
        time.
      </p>
    );
  }

  const width = 1000;
  const height = 220;
  const slot = width / buckets.length;
  const barWidth = Math.max(1, slot * 0.72);
  const baseline = height - 26;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Activity over time"
      >
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line
            key={ratio}
            x1={0}
            x2={width}
            y1={baseline - baseline * ratio}
            y2={baseline - baseline * ratio}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}

        {buckets.map((bucket, index) => {
          const scale = max > 0 ? baseline / max : 0;
          const segments = [
            { value: bucket.other, className: "fill-severity-trace" },
            { value: bucket.info, className: "fill-severity-info" },
            { value: bucket.warn, className: "fill-severity-warn" },
            { value: bucket.error, className: "fill-severity-error" },
          ];
          let cursor = baseline;

          return (
            <g key={bucket.t}>
              <rect
                x={index * slot + (slot - barWidth) / 2}
                y={0}
                width={barWidth}
                height={baseline}
                className={cn(
                  "fill-transparent",
                  hover === index ? "fill-foreground/5" : "",
                )}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              />
              {segments.map((segment, position) => {
                const segmentHeight = segment.value * scale;
                cursor -= segmentHeight;
                return (
                  <rect
                    key={position}
                    x={index * slot + (slot - barWidth) / 2}
                    y={cursor}
                    width={barWidth}
                    height={segmentHeight}
                    className={segment.className}
                    pointerEvents="none"
                  />
                );
              })}
            </g>
          );
        })}

        <line
          x1={0}
          x2={width}
          y1={baseline}
          y2={baseline}
          className="stroke-border"
          strokeWidth={1}
        />
      </svg>

      <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{new Date(buckets[0].t).toLocaleString()}</span>
        <span>
          {new Date(buckets[buckets.length - 1].t).toLocaleTimeString()}
        </span>
      </div>

      {hover !== null ? (
        <div className="pointer-events-none absolute right-2 top-2 rounded-md border bg-popover/95 px-3 py-2 font-mono text-[11px] shadow-lg">
          <p className="text-muted-foreground">
            {new Date(buckets[hover].t).toLocaleString()}
          </p>
          <p className="mt-1 text-severity-error">
            error {buckets[hover].error.toLocaleString()}
          </p>
          <p className="text-severity-warn">warn {buckets[hover].warn.toLocaleString()}</p>
          <p className="text-severity-info">info {buckets[hover].info.toLocaleString()}</p>
          <p className="text-muted-foreground">
            other {buckets[hover].other.toLocaleString()}
          </p>
        </div>
      ) : null}
    </div>
  );
}
