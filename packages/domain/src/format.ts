/** 바이트를 사람이 읽는 크기로: 1MB 미만은 KB(최소 1KB), 이상은 소수 1자리 MB. */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
