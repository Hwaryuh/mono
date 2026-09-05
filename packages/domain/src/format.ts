/** Formats bytes as a human-readable size: below 1MB shows KB (minimum 1KB), at or above shows MB with 1 decimal place. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
