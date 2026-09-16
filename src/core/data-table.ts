/** Tabular export helpers for snapshots, series, and resource waterfall rows. */

import type { MetricName, MetricPoint, SeriesMap, Snapshot } from "./types.js";
import { ALL_METRIC_NAMES } from "./types.js";
import type { ResourceTimingRow } from "./resources.js";
import { describeMetric } from "../components/metric-info.js";
import { zoneSafeSetTimeout } from "./zone-safe.js";

/** Cell value suitable for JSON/CSV tables. */
export type DataTableCell = string | number | boolean | null;

/** Generic tabular payload used by download helpers and the data-table UI. */
export interface DataTable {
  columns: string[];
  rows: Array<Record<string, DataTableCell>>;
}

export type DownloadFormat = "json" | "csv";

export interface DownloadOptions {
  format: DownloadFormat;
  /** Defaults to pagepulse-data.json / pagepulse-data.csv */
  filename?: string;
}

const GAUGE_COLUMNS = ["metric", "latest", "description", "pointCount", "series"] as const;

const SERIES_COLUMNS = ["metric", "t", "v"] as const;

const RESOURCE_COLUMNS = [
  "id",
  "name",
  "initiatorType",
  "startTime",
  "responseEnd",
  "duration",
  "transferSize",
  "encodedBodySize",
  "decodedBodySize",
  "firstParty",
  "cached",
  "recordedAt"
] as const;

function metricNamesInSnapshot(snapshot: Snapshot): MetricName[] {
  const seen = new Set<MetricName>();
  for (const name of ALL_METRIC_NAMES) {
    if (snapshot.latest[name] !== undefined || (snapshot.series[name]?.length ?? 0) > 0) {
      seen.add(name);
    }
  }
  // Include any unexpected keys present on the snapshot.
  for (const key of Object.keys(snapshot.latest) as MetricName[]) {
    seen.add(key);
  }
  for (const key of Object.keys(snapshot.series) as MetricName[]) {
    seen.add(key);
  }
  return ALL_METRIC_NAMES.filter((n) => seen.has(n)).concat(
    [...seen].filter((n) => !ALL_METRIC_NAMES.includes(n))
  );
}

/**
 * Latest gauges as a table: one row per metric with optional series JSON.
 */
export function snapshotToTable(snapshot: Snapshot): DataTable {
  const columns = [...GAUGE_COLUMNS];
  const rows: DataTable["rows"] = [];
  for (const metric of metricNamesInSnapshot(snapshot)) {
    const points: MetricPoint[] = snapshot.series[metric] ?? [];
    const latest = snapshot.latest[metric];
    rows.push({
      metric,
      latest: latest === undefined || Number.isNaN(latest) ? null : latest,
      description: describeMetric(metric),
      pointCount: points.length,
      series: points.length > 0 ? JSON.stringify(points) : null
    });
  }
  return { columns, rows };
}

/**
 * Full time-series flattened to long form: metric / t / v per point.
 * Metrics with only a latest gauge and no series emit a single row using
 * the snapshot timestamp when a latest value exists.
 */
export function seriesToTable(snapshot: Snapshot): DataTable {
  const columns = [...SERIES_COLUMNS];
  const rows: DataTable["rows"] = [];
  for (const metric of metricNamesInSnapshot(snapshot)) {
    const points: MetricPoint[] = snapshot.series[metric] ?? [];
    if (points.length > 0) {
      for (const p of points) {
        rows.push({ metric, t: p.t, v: p.v });
      }
      continue;
    }
    const latest = snapshot.latest[metric];
    if (latest !== undefined && !Number.isNaN(latest)) {
      rows.push({ metric, t: snapshot.timestamp, v: latest });
    }
  }
  return { columns, rows };
}

/** Resource Timing waterfall rows as a flat table. */
export function resourcesToTable(resources: ResourceTimingRow[]): DataTable {
  const columns = [...RESOURCE_COLUMNS];
  const rows: DataTable["rows"] = resources.map((r) => ({
    id: r.id,
    name: r.name,
    initiatorType: r.initiatorType,
    startTime: r.startTime,
    responseEnd: r.responseEnd,
    duration: r.duration,
    transferSize: r.transferSize,
    encodedBodySize: r.encodedBodySize,
    decodedBodySize: r.decodedBodySize,
    firstParty: r.firstParty,
    cached: r.cached,
    recordedAt: r.recordedAt
  }));
  return { columns, rows };
}

/** Escape a single CSV field (RFC 4180-ish). */
export function escapeCsvCell(value: DataTableCell): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Serialize a DataTable to CSV text (header + rows). */
export function tableToCsv(table: DataTable): string {
  const header = table.columns.map(escapeCsvCell).join(",");
  const lines = table.rows.map((row) =>
    table.columns.map((col) => escapeCsvCell(row[col] ?? null)).join(",")
  );
  return [header, ...lines].join("\n");
}

/** Serialize a DataTable (or any value) to pretty JSON. */
export function tableToJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function defaultFilename(format: DownloadFormat): string {
  return format === "csv" ? "pagepulse-data.csv" : "pagepulse-data.json";
}

function isDataTable(data: unknown): data is DataTable {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as DataTable).columns) &&
    Array.isArray((data as DataTable).rows)
  );
}

/**
 * Trigger a browser file download for tabular (or arbitrary) data.
 * Returns true when a download was started; false / soft-fails when
 * `document` / Blob / URL APIs are unavailable (e.g. Node).
 */
export function downloadData(data: unknown, options: DownloadOptions): boolean {
  const format = options.format;
  const filename = options.filename ?? defaultFilename(format);

  let body: string;
  let mime: string;
  if (format === "csv") {
    if (!isDataTable(data)) {
      throw new Error("downloadData: CSV format requires a DataTable ({ columns, rows })");
    }
    body = tableToCsv(data);
    mime = "text/csv;charset=utf-8";
  } else {
    body = tableToJson(data);
    mime = "application/json;charset=utf-8";
  }

  if (typeof document === "undefined" || typeof Blob === "undefined") {
    return false;
  }
  const urlApi = typeof URL !== "undefined" ? URL : undefined;
  if (!urlApi?.createObjectURL) {
    return false;
  }

  try {
    const blob = new Blob([body], { type: mime });
    const url = urlApi.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on next tick so the browser can start the download.
    zoneSafeSetTimeout(() => {
      try {
        urlApi.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 0);
    return true;
  } catch {
    return false;
  }
}

/** Convenience: build gauge table from a SeriesMap + latest map without a full Snapshot. */
export function gaugesToTable(
  latest: Partial<Record<MetricName, number>>,
  series: SeriesMap = {},
  timestamp = Date.now()
): DataTable {
  return snapshotToTable({ timestamp, series, latest });
}
