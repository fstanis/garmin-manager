import { formatCalendarDate } from './util.ts';

export interface SidHeader {
  versionMajor: number;
  versionMinor: number;
  creationYear: number;
  creationMonth: number;
  creationDay: number;
  /** Empty for shared search tables (e.g. the ETYP files used by every TopoActive region). */
  description: string;
  partNumber: string;
}

/** Covers the string block of every observed search index; descriptions run under 100 bytes. */
export const sidHeaderLength = 512;

const signature = 'GARMIN SID';

export class SidFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidFormatError';
  }
}

export function parseSidHeader(bytes: Uint8Array): SidHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readText(bytes, 0, signature.length) !== signature) {
    throw new SidFormatError('Missing "GARMIN SID" signature.');
  }
  const stringBlockOffset = view.getUint32(0x10, true);
  const description = readLengthPrefixedString(bytes, view, stringBlockOffset);
  const partNumber = readLengthPrefixedString(bytes, view, description.endOffset);
  return {
    versionMajor: view.getUint8(0x18),
    versionMinor: view.getUint8(0x19),
    creationYear: view.getUint16(0x1f, true),
    creationMonth: view.getUint8(0x21),
    creationDay: view.getUint8(0x22),
    description: description.text,
    partNumber: partNumber.text,
  };
}

export function sidDisplayName(header: SidHeader): string {
  if (header.description !== '') {
    return header.description;
  }
  const version = `${header.versionMajor}.${String(header.versionMinor).padStart(2, '0')}`;
  return `Search data ${header.partNumber} v${version}`;
}

export function sidCreatedOn(header: SidHeader): string {
  return formatCalendarDate({ year: header.creationYear, month: header.creationMonth, day: header.creationDay });
}

function readLengthPrefixedString(bytes: Uint8Array, view: DataView, offset: number): { text: string; endOffset: number } {
  const length = view.getUint32(offset, true);
  const textOffset = offset + 4;
  const endOffset = textOffset + length;
  if (endOffset > bytes.length) {
    throw new SidFormatError(`String at offset ${offset} (${length} bytes) runs past the ${bytes.length}-byte header.`);
  }
  return { text: readText(bytes, textOffset, length), endOffset };
}

function readText(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder('latin1').decode(bytes.subarray(start, start + length));
}
