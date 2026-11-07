import { formatCalendarDate } from './util.ts';

export interface ImgHeader {
  mapDescription: string;
  mapName: string;
  creationYear: number;
  creationMonth: number;
  creationDay: number;
}

/** Map files are gigabyte-scale; only this prefix — through the end of the name field — is ever read. */
export const imgHeaderLength = 0x84;

export function parseImgHeader(bytes: Uint8Array): ImgHeader {
  if (bytes.length < imgHeaderLength) {
    throw new Error(`Buffer size (${bytes.length} bytes) is smaller than required header size (${imgHeaderLength} bytes).`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    mapDescription: readNullTerminatedString(bytes, 0x49, 20),
    mapName: readNullTerminatedString(bytes, 0x65, 31),
    creationYear: view.getUint16(0x39, true),
    creationMonth: view.getUint8(0x3b),
    creationDay: view.getUint8(0x3c),
  };
}

/**
 * Garmin writes one title split across the two fields — description holds the
 * first 20 characters, name the next 31 — padded with spaces and a trailing
 * soft hyphen (U+00AD), which trim() alone does not remove.
 */
export function mapDisplayName(header: ImgHeader): string {
  return `${header.mapDescription}${header.mapName}`.replace(/^[\s\u00AD]+|[\s\u00AD]+$/g, '');
}

export function mapCreatedOn(header: ImgHeader): string {
  return formatCalendarDate({ year: header.creationYear, month: header.creationMonth, day: header.creationDay });
}

function readNullTerminatedString(bytes: Uint8Array, start: number, length: number): string {
  let end = start + length;
  for (let index = start; index < start + length; index += 1) {
    if (bytes[index] === 0) {
      end = index;
      break;
    }
  }
  let text = '';
  for (let index = start; index < end; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }
  return text.trim();
}
