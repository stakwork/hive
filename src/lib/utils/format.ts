
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "0";
  }
  
  return value.toLocaleString("en-US");
}

export function formatPercentage(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) {
    return "0.0%";
  }
  
  return `${value.toFixed(decimals)}%`;
}

export function formatMB(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1) + " MB";
}

/**
 * Human-readable byte size (binary units).
 *
 * Unknown values render as "unknown", never as "0 B" — a failed measurement
 * must never be mistaken for an empty disk. Negative and non-finite values are
 * treated as unknown too.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "unknown";
  }
  if (bytes === 0) {
    return "0 B";
  }
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
