export function fileExtension(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/** Table-cell stand-in for values that are absent or have not been read yet. */
export function orDash(value: string): string {
  return value !== '' ? value : '—';
}

export function progressPercent(uploadedBytes: number, totalBytes: number): string {
  if (totalBytes === 0) {
    return '';
  }
  const percent = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100));
  return `${percent}%`;
}

export function pluralize(count: number, singularNoun: string): string {
  return `${count} ${singularNoun}${count === 1 ? '' : 's'}`;
}

/** Month is 1-based; formats as YYYY-MM-DD. */
export function formatCalendarDate(date: { year: number; month: number; day: number }): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ['KiB', 'MiB', 'GiB'];
  let scaled = size;
  let unitIndex = -1;
  do {
    scaled /= 1024;
    unitIndex += 1;
  } while (scaled >= 1024 && unitIndex < units.length - 1);
  return `${scaled.toFixed(1)} ${units[unitIndex]}`;
}

export function isDeviceSelectionCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
