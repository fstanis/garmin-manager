import type { MtpFileSystem } from 'libmtp-web';
import { canReadRanges, readDeviceFileRange, type MapFile } from './device.ts';
import { imgHeaderLength, mapCreatedOn, mapDisplayName, parseImgHeader } from './img.ts';
import { parseSidHeader, sidCreatedOn, sidDisplayName, sidHeaderLength } from './sid.ts';
import { describeError, fileExtension } from './util.ts';

/** Header-derived details of a file in the device's Garmin folder; empty strings when unread or unreadable. */
export interface MapInfo {
  displayName: string;
  createdOn: string;
}

interface HeaderFormat {
  /** Map files are gigabyte-scale; only this prefix is ever read. */
  prefixLength: number;
  describe(bytes: Uint8Array): MapInfo;
}

const emptyMapInfo: MapInfo = { displayName: '', createdOn: '' };

const headerFormats = new Map<string, HeaderFormat>([
  ['img', {
    prefixLength: imgHeaderLength,
    describe: (bytes) => {
      const header = parseImgHeader(bytes);
      return { displayName: mapDisplayName(header), createdOn: mapCreatedOn(header) };
    },
  }],
  ['sid', {
    prefixLength: sidHeaderLength,
    describe: (bytes) => {
      const header = parseSidHeader(bytes);
      return { displayName: sidDisplayName(header), createdOn: sidCreatedOn(header) };
    },
  }],
]);

/**
 * Reads the header prefix straight off the device; empty for files without a
 * known header (e.g. .gma) and when the device has no range reads, since map files are huge.
 */
export async function readDeviceMapInfo(fileSystem: MtpFileSystem, map: MapFile): Promise<MapInfo> {
  const format = headerFormats.get(fileExtension(map.name));
  if (format === undefined || !canReadRanges(fileSystem)) {
    return emptyMapInfo;
  }
  const bytes = await readDeviceFileRange(fileSystem, map, { offset: 0, length: Math.min(format.prefixLength, map.size) });
  return format.describe(bytes);
}

/** Parses a staged file's header locally; empty when the file has no readable header. */
export async function readLocalMapInfo(file: File): Promise<MapInfo> {
  const format = headerFormats.get(fileExtension(file.name));
  if (format === undefined) {
    return emptyMapInfo;
  }
  try {
    return format.describe(new Uint8Array(await file.slice(0, format.prefixLength).arrayBuffer()));
  } catch (error) {
    console.info(`[map] "${file.name}" has no readable header: ${describeError(error)}`);
    return emptyMapInfo;
  }
}

/** Garmin pairs each map image with an activation file of the same stem (D9486050A.img ↔ D9486050A.gma). */
export function activationDisplayName(activationFileName: string, mapNamesByStem: Map<string, string>): string {
  const imageFileName = activationFileName.replace(/\.gma$/i, '.img');
  const mapName = mapNamesByStem.get(fileStem(activationFileName)) || imageFileName;
  return `Activation for ${mapName}`;
}

export function isActivationFile(name: string): boolean {
  return fileExtension(name) === 'gma';
}

/** Lowercased so stems match across .img and .gma regardless of case. */
export function fileStem(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return (dotIndex === -1 ? name : name.slice(0, dotIndex)).toLowerCase();
}
