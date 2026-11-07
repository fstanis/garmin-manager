import type { MtpFileSystem } from 'libmtp-web';
import { Reader } from 'jsmediatags';
import MediaFileReader from 'jsmediatags/build2/MediaFileReader';
import {
  canReadRanges,
  openDeviceFileStream,
  readDeviceFileRangeOnce,
  ReadStalledError,
  readTimeoutMs,
  withTimeout,
  withTransferRetry,
  type DeviceFile,
} from './device.ts';
import { formatBytes } from './util.ts';

/** Devices without range reads buffer the whole file; beyond this the metadata pass is skipped. */
const bufferedReadCapBytes = 32 * 1024 * 1024;

/** Audio tag values; an empty string means the tag is absent from the file. */
export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  track: string;
  genre: string;
}

export const emptyAudioMetadata: AudioMetadata = { title: '', artist: '', album: '', track: '', genre: '' };

/** Random-access byte source; offsets are absolute. */
export interface RangeSource {
  size: number;
  readRange(offset: number, length: number): Promise<Uint8Array>;
}

/** Marks failures from our own byte source so genuine I/O errors are not mistaken for untagged files. */
class RangeReadFailureError extends Error {
  constructor(override readonly cause: unknown) {
    super('range source failed');
  }
}

export async function readLocalFileMetadata(file: File): Promise<AudioMetadata> {
  return readMetadata({
    size: file.size,
    readRange: (offset, length) =>
      file.slice(offset, offset + length).arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  }, file.name);
}

export async function readDeviceFileMetadata(
  fileSystem: MtpFileSystem,
  file: DeviceFile,
): Promise<AudioMetadata> {
  return withTransferRetry(async () => {
    const source = canReadRanges(fileSystem)
      ? deviceRangeSource(fileSystem, file)
      : await bufferedRangeSource(fileSystem, file);
    if (source === null) {
      return emptyAudioMetadata;
    }
    return readMetadata(source, file.path);
  });
}

function deviceRangeSource(fileSystem: MtpFileSystem, file: DeviceFile): RangeSource {
  return {
    size: file.size,
    readRange: (offset, length) =>
      readDeviceFileRangeOnce(fileSystem, file, { offset, length }).catch((error: unknown) => {
        throw new RangeReadFailureError(error);
      }),
  };
}

async function bufferedRangeSource(
  fileSystem: MtpFileSystem,
  file: DeviceFile,
): Promise<RangeSource | null> {
  if (file.size > bufferedReadCapBytes) {
    console.info(`[meta] "${file.path}" skipped: ${formatBytes(file.size)} exceeds the ${formatBytes(bufferedReadCapBytes)} buffered-read limit on this device`);
    return null;
  }
  const stream = await openDeviceFileStream(fileSystem, file);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await withTimeout(
        () => reader.read(),
        readTimeoutMs,
        () => new ReadStalledError(file.path),
      );
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch((cancelError: unknown) => {
      console.warn(`[meta] cancelling the read of "${file.path}" failed:`, cancelError);
    });
    throw new RangeReadFailureError(error);
  }
  const contents = new Uint8Array(file.size);
  let offset = 0;
  for (const chunk of chunks) {
    contents.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    size: contents.byteLength,
    readRange: (start, length) =>
      Promise.resolve(contents.slice(start, start + length)),
  };
}

interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  track?: string | number;
  genre?: string;
}

async function readMetadata(source: RangeSource, sourceLabel: string): Promise<AudioMetadata> {
  const tags = await readTags(source, sourceLabel);
  return {
    title: tags.title ?? '',
    artist: tags.artist ?? '',
    album: tags.album ?? '',
    track: tags.track === undefined ? '' : String(tags.track),
    genre: tags.genre ?? '',
  };
}

function readTags(source: RangeSource, sourceLabel: string): Promise<Tags> {
  return new Promise((resolve, reject) => {
    new Reader(source)
      .setFileReader(RangeSourceMediaFileReader)
      .setTagsToRead(['title', 'artist', 'album', 'track', 'genre'])
      .read({
        onSuccess: (tag) => {
          resolve((tag.tags ?? {}) as Tags);
        },
        onError: (error) => {
          if (error instanceof RangeReadFailureError) {
            reject(error.cause);
            return;
          }
          console.info(`[meta] "${sourceLabel}" has no readable tags: ${JSON.stringify(error)}`);
          resolve({});
        },
      });
  });
}

class RangeSourceMediaFileReader extends MediaFileReader {
  private readonly source: RangeSource;
  private readonly loadedChunks = new Map<number, Uint8Array>();

  constructor(source: RangeSource) {
    super(source);
    this.source = source;
  }

  public override _init(callbacks: { onSuccess: () => void }): void {
    this._size = this.source.size;
    callbacks.onSuccess();
  }

  public override loadRange(range: [number, number], callbacks: { onSuccess: () => void; onError: (error: unknown) => void }): void {
    const offset = range[0];
    const length = range[1] - range[0] + 1;
    this.source
      .readRange(offset, length)
      .then((chunk) => {
        this.loadedChunks.set(offset, chunk);
        callbacks.onSuccess();
      })
      .catch((error: unknown) => {
        callbacks.onError(new RangeReadFailureError(error));
      });
  }

  public override getByteAt(offset: number): number {
    for (const [chunkOffset, chunk] of this.loadedChunks) {
      if (offset >= chunkOffset && offset < chunkOffset + chunk.byteLength) {
        return chunk[offset - chunkOffset] ?? 0;
      }
    }
    throw new Error(`byte ${offset} outside loaded ranges`);
  }
}
