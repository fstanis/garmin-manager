import type { Category } from './device.ts';
import { readLocalFileMetadata, type AudioMetadata } from './metadata.ts';
import { fileExtension } from './util.ts';

export const supportedAudioExtensions = new Set(['mp4', 'm4a', 'm4b', 'mp3', 'aac']);

/** Garmin sorts by genre, so the genre tag alone picks the destination folder. */
const genreCategories = new Map<string, Category>([
  ['podcast', 'Podcasts'],
  ['podcasts', 'Podcasts'],
  ['audiobook', 'Audiobooks'],
  ['audiobooks', 'Audiobooks'],
]);

export type StagedStatus = 'verifying' | 'ready' | 'rejected' | 'uploading' | 'failed';

export interface StagedFile {
  file: File;
  /** Empty until a title has been read; kept on duplicate-rejected files for display. */
  title: string;
  /** Empty until the artist has been read; the author/podcaster for spoken audio. */
  artist: string;
  /** Empty until the album has been read; the book/podcast name for spoken audio. */
  album: string;
  /** Empty until the track number has been read; chapter/episode number for spoken audio. */
  track: string;
  /** Empty until the genre has been read; drives the category bucket. */
  genre: string;
  status: StagedStatus;
  /** Rejection or upload-failure reason; empty otherwise. */
  reason: string;
  /** Inferred from the genre tag; never picked by the user. */
  category: Category;
  /** Bytes sent during an in-flight upload; displayed as a percentage. */
  uploadedBytes: number;
}

export function hasSupportedAudioExtension(name: string): boolean {
  return supportedAudioExtensions.has(fileExtension(name));
}

export function createStagedFile(file: File): StagedFile {
  return {
    file,
    title: '',
    artist: '',
    album: '',
    track: '',
    genre: '',
    status: 'verifying',
    reason: '',
    category: 'Music',
    uploadedBytes: 0,
  };
}

/** Reads the file's tags with jsmediatags; rejects missing titles and on-device duplicates. Callers pre-filter extensions. */
export async function verifyStagedFile(
  staged: StagedFile,
  deviceTitles: Map<string, string>,
  deviceFileNames: Map<string, string>,
): Promise<StagedFile> {
  let metadata: AudioMetadata;
  try {
    metadata = await readLocalFileMetadata(staged.file);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return withRejection(staged, `Could not read metadata: ${reason}`);
  }
  if (metadata.title === '') {
    return withRejection(staged, 'No title metadata found');
  }
  const verified: StagedFile = {
    ...staged,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    track: metadata.track,
    genre: metadata.genre,
  };
  const duplicatePath = findDuplicatePath(verified.title, deviceTitles) ?? deviceFileNames.get(staged.file.name.toLowerCase());
  if (duplicatePath !== undefined) {
    return { ...verified, status: 'rejected', reason: `Already on the device: ${duplicatePath}` };
  }
  return { ...verified, category: categoryForGenre(verified.genre), status: 'ready', reason: '' };
}

/** The genre tag is the only category signal: Podcast/Audiobook genres pick their folder, anything else is Music. */
function categoryForGenre(genre: string): Category {
  return genreCategories.get(normalizeGenre(genre).toLowerCase()) ?? 'Music';
}

/** Strips ID3v2.3 numeric-genre prefixes like "(17)Podcast" before comparing. */
function normalizeGenre(genre: string): string {
  return genre.replace(/^\(\d+\)/, '').trim();
}

/** Re-checks a verified file against titles and names discovered since; used after a device scan completes. */
export function reverifyDuplicate(
  staged: StagedFile,
  deviceTitles: Map<string, string>,
  deviceFileNames: Map<string, string>,
): StagedFile {
  const duplicatePath = findDuplicatePath(staged.title, deviceTitles) ?? deviceFileNames.get(staged.file.name.toLowerCase());
  if (!duplicatePath) {
    return staged;
  }
  return withRejection(staged, `Already on the device: ${duplicatePath}`);
}

export type StagedMapStatus = 'rejected' | 'ready' | 'uploading' | 'failed';

export interface StagedMap {
  file: File;
  status: StagedMapStatus;
  /** Rejection or upload-failure reason; empty otherwise. */
  reason: string;
  /** Bytes sent during an in-flight upload; displayed as a percentage. */
  uploadedBytes: number;
  /** Map name from the local file header; empty until parsed or when unreadable. */
  displayName: string;
  /** Creation date from the local file header; empty until parsed or when unreadable. */
  createdOn: string;
}

export function createStagedMap(file: File): StagedMap {
  return {
    file,
    status: 'ready',
    reason: '',
    uploadedBytes: 0,
    displayName: '',
    createdOn: '',
  };
}

/** Rejects map files whose name already exists in the device's Garmin folder. */
export function verifyStagedMap(staged: StagedMap, deviceMapNames: Map<string, string>): StagedMap {
  if (staged.status === 'rejected') {
    return staged;
  }
  const duplicatePath = deviceMapNames.get(staged.file.name.toLowerCase());
  if (!duplicatePath) {
    return staged;
  }
  return { ...staged, status: 'rejected', reason: `Already on the device: ${duplicatePath}` };
}

function findDuplicatePath(title: string, deviceTitles: Map<string, string>): string | undefined {
  return deviceTitles.get(title.toLowerCase());
}

function withRejection(staged: StagedFile, reason: string): StagedFile {
  return { ...staged, status: 'rejected', reason };
}
