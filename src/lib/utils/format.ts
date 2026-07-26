
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
