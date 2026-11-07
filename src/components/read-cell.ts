import type { ReadStatus } from '../state.ts';
import { orDash } from '../util.ts';

export interface ReadCell {
  text: string;
  /** Empty when the cell needs no status styling. */
  className: string;
}

const readCells: Record<ReadStatus, (value: string) => ReadCell> = {
  pending: () => ({ text: 'reading…', className: 'cell-pending' }),
  failed: () => ({ text: 'read failed', className: 'cell-failed' }),
  skipped: () => ({ text: '', className: '' }),
  read: (value) => ({ text: orDash(value), className: '' }),
};

/** Table cell for a value read from the device, which shows the read's progress until it completes. */
export function describeReadCell(value: string, status: ReadStatus): ReadCell {
  return readCells[status](value);
}

export function joinClassNames(...classNames: string[]): string {
  return classNames.filter((className) => className !== '').join(' ');
}
