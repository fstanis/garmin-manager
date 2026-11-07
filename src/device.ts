import {
  mtpDeviceFilters,
  requestMtpFileSystem,
  MtpDeviceDisconnectedError,
  MtpFileReadError,
  MtpObjectNotFoundError,
  MtpSessionClosedError,
  MtpWriteError,
  type MtpFileSystem,
} from 'libmtp-web';
import bundledWasmUrl from 'libmtp-web/dist/mtp.wasm' with { type: 'file' };
import { fileExtension } from './util.ts';

/** Sentinel folder id under which MTP lists a storage's root-level contents. */
const ROOT_FOLDER_ID = 0xffffffff;

export type Category = 'Music' | 'Podcasts' | 'Audiobooks';

const targetFolders = new Map<string, Category>([
  ['music', 'Music'],
  ['podcasts', 'Podcasts'],
  ['audiobooks', 'Audiobooks'],
]);

/** Upload categories in section-display order. */
export const categories: Category[] = [...targetFolders.values()];

/** Garmin watches put the audio folders at the storage root or under Garmin/, so a shallow search suffices. */
const maxTargetSearchDepth = 4;

const retryAttempts = 3;
const retryBaseDelayMs = 500;

const closeTimeoutMs = 5_000;

export const deviceScanTimeoutMs = 120_000;

/** Matches libmtp-web's read window cadence; a healthy device answers ranges in a second or two. */
export const readTimeoutMs = 15_000;

/**
 * WebUSB bulk transfers fail transiently (transferIn NetworkError); re-running
 * the whole operation recovers because MTP reads and replaces-writes restart
 * from the first byte.
 */
export async function withTransferRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retryAttempts || !isTransientTransferError(error)) {
        throw error;
      }
      await delay(retryBaseDelayMs * attempt);
    }
  }
}

function isTransientTransferError(error: unknown): boolean {
  if (
    error instanceof MtpSessionClosedError ||
    error instanceof MtpDeviceDisconnectedError ||
    error instanceof MtpObjectNotFoundError
  ) {
    return false;
  }
  if (error instanceof MtpFileReadError || error instanceof MtpWriteError) {
    return true;
  }
  return error instanceof DOMException && error.name === 'NetworkError';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export interface DeviceFile {
  id: number;
  name: string;
  size: number;
  path: string;
  folderName: Category;
}

export interface StoredFile {
  id: number;
  name: string;
  size: number;
  path: string;
}

export type MapFile = StoredFile;

const deviceDescriptorName = 'garmindevice.xml';
const mapImageExtension = 'img';
/** Map images and their activation files sit directly in Garmin/; search indexes live in Garmin/SID/. */
const garminFolderMapExtensions = new Set([mapImageExtension, 'gma']);
const searchIndexFolderName = 'SID';
const searchIndexExtension = 'sid';
export const mapFileExtensions = new Set([...garminFolderMapExtensions, searchIndexExtension]);

/** An MTP folder (by object id) the app can upload into; folderPath mirrors the device-side path. */
export interface UploadFolder {
  storageId: number;
  folderId: number;
  folderPath: string;
}

export interface DeviceFolderIndex {
  uploads: Map<Category, UploadFolder>;
  /** Sibling location under which categories missing on the device are created. */
  anchor: UploadFolder;
  /** The device's Garmin/ folder holding map images; created at the storage root when missing. */
  mapFolder: UploadFolder | null;
  /** Garmin/SID/ holding search indexes; created under mapFolder when missing. */
  searchIndexFolder: UploadFolder | null;
}

export interface DeviceScan {
  files: DeviceFile[];
  maps: MapFile[];
  /** Garmin/GarminDevice.xml; null when the device has none. */
  descriptor: StoredFile | null;
  folders: DeviceFolderIndex;
}

export interface UploadRequest {
  category: Category;
  file: File;
  onProgress?: (uploadedBytes: number) => void;
}

export interface UploadResult {
  objectId: number;
  folder: UploadFolder;
  path: string;
}

interface SearchFolder {
  folderId: number;
  path: string;
  depth: number;
}

/** A storage on the device, bundling what every recursive folder read needs. */
interface DeviceStorage {
  fileSystem: MtpFileSystem;
  storageId: number;
}

/** Loads the wasm ahead of the click so requestDevice keeps its user activation. */
export async function preloadMtpRuntime(): Promise<void> {
  await mtpDeviceFilters({ wasmUrl: bundledWasmUrl });
}

/** Opening is deadline-bounded by libmtp-web's openTimeoutMs (default 30s). */
export async function connectToDevice(): Promise<MtpFileSystem> {
  const filters = await mtpDeviceFilters({ wasmUrl: bundledWasmUrl });
  await navigator.usb.requestDevice({ filters });
  return requestMtpFileSystem({ wasmUrl: bundledWasmUrl });
}

/**
 * The wasm close can hang on a wedged transport; abandoning it after a short
 * grace period keeps the UI responsive. Returns false when the close did not
 * complete, meaning the watch must be replugged.
 */
export async function closeQuietly(fileSystem: MtpFileSystem): Promise<boolean> {
  try {
    await withTimeout(
      () => fileSystem.close(),
      closeTimeoutMs,
      () => new MtpSessionClosedError('Closing the device did not finish in time.'),
    );
    return true;
  } catch (error) {
    console.warn('[mtp] session close after a failure did not complete:', error);
    return false;
  }
}

export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, createError: () => Error): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(createError()), timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** A device read made no progress within readTimeoutMs. */
export class ReadStalledError extends Error {
  constructor(source: string) {
    super(`No data for ${readTimeoutMs / 1000}s while reading ${source}`);
    this.name = 'ReadStalledError';
  }
}

export interface StorageSpace {
  /** Bytes, summed across every storage on the device. */
  freeBytes: number;
  /** Bytes, summed across every storage on the device. */
  capacityBytes: number;
}

/** Totals the storage figures the session read when it opened; they go stale after writes and deletes. */
export function openedStorageSpace(fileSystem: MtpFileSystem): StorageSpace {
  return totalStorageSpace(fileSystem.session.storages);
}

export async function readStorageSpace(fileSystem: MtpFileSystem): Promise<StorageSpace> {
  return totalStorageSpace(await withTransferRetry(() => fileSystem.session.refreshStorages()));
}

function totalStorageSpace(storages: { freeBytes: number; capacityBytes: number }[]): StorageSpace {
  return {
    freeBytes: storages.reduce((sum, storage) => sum + storage.freeBytes, 0),
    capacityBytes: storages.reduce((sum, storage) => sum + storage.capacityBytes, 0),
  };
}

export async function scanDevice(fileSystem: MtpFileSystem): Promise<DeviceScan> {
  const filesByPath = new Map<string, DeviceFile>();
  const uploads = new Map<Category, UploadFolder>();
  const maps: MapFile[] = [];
  const anchors: UploadFolder[] = [];
  let mapFolder: UploadFolder | null = null;
  let searchIndexFolder: UploadFolder | null = null;
  let descriptor: StoredFile | null = null;
  for (const storage of fileSystem.session.storages) {
    const storageScan = await scanStorage({ fileSystem, storageId: storage.storageId });
    for (const file of storageScan.files) {
      filesByPath.set(file.path, file);
    }
    for (const [category, folder] of storageScan.uploads) {
      uploads.set(category, folder);
    }
    maps.push(...storageScan.maps);
    if (storageScan.anchor) {
      anchors.push(storageScan.anchor);
    }
    mapFolder = mapFolder ?? storageScan.mapFolder ?? null;
    searchIndexFolder ??= storageScan.searchIndexFolder;
    descriptor ??= storageScan.descriptor;
  }
  const primaryStorageId = fileSystem.session.storages[0]?.storageId ?? 0;
  return {
    files: [...filesByPath.values()],
    maps,
    descriptor,
    folders: {
      uploads,
      anchor: anchors[0] ?? { storageId: primaryStorageId, folderId: ROOT_FOLDER_ID, folderPath: '' },
      mapFolder,
      searchIndexFolder,
    },
  };
}

export async function uploadFile(
  fileSystem: MtpFileSystem,
  folders: DeviceFolderIndex,
  request: UploadRequest,
): Promise<UploadResult> {
  const folder = folders.uploads.get(request.category) ?? (await createChildFolder(fileSystem, folders.anchor, request.category));
  return writeFileToFolder(fileSystem, folder, request.file, request.onProgress);
}

export interface MapUploadRequest {
  file: File;
  onProgress?: (uploadedBytes: number) => void;
}

export interface MapUploadResult extends UploadResult {
  /** The input index plus any Garmin/ or Garmin/SID/ folder the upload created. */
  folders: DeviceFolderIndex;
}

/** Search indexes go to Garmin/SID/; images and activation files to Garmin/. */
export async function uploadMapFile(
  fileSystem: MtpFileSystem,
  folders: DeviceFolderIndex,
  request: MapUploadRequest,
): Promise<MapUploadResult> {
  const mapFolder = folders.mapFolder ?? (await createMapFolder(fileSystem, folders.anchor));
  if (fileExtension(request.file.name) !== searchIndexExtension) {
    const upload = await writeFileToFolder(fileSystem, mapFolder, request.file, request.onProgress);
    return { ...upload, folders: { ...folders, mapFolder } };
  }
  const searchIndexFolder = folders.searchIndexFolder ?? (await createChildFolder(fileSystem, mapFolder, searchIndexFolderName));
  const upload = await writeFileToFolder(fileSystem, searchIndexFolder, request.file, request.onProgress);
  return { ...upload, folders: { ...folders, mapFolder, searchIndexFolder } };
}

export async function deleteDeviceFile(fileSystem: MtpFileSystem, file: { id: number; name: string }): Promise<void> {
  await withTransferRetry(() => fileSystem.session.deleteObject(file.id, file.name));
}

/** One range read, retried on transient transfer errors; the device must support range reads. */
export async function readDeviceFileRange(fileSystem: MtpFileSystem, file: StoredFile, range: { offset: number; length: number }): Promise<Uint8Array> {
  return withTransferRetry(() =>
    withTimeout(
      () => fileSystem.session.readFileRange(file, range.offset, range.length),
      readTimeoutMs,
      () => new ReadStalledError(file.path),
    ),
  );
}

/** Buffers the whole file in memory, so only use it for small files; the whole read must finish within readTimeoutMs. */
export async function readSmallDeviceFile(fileSystem: MtpFileSystem, file: StoredFile): Promise<Blob> {
  return withTransferRetry(() =>
    withTimeout(
      async () => new Response(await fileSystem.session.readFileStream(file)).blob(),
      readTimeoutMs,
      () => new ReadStalledError(file.path),
    ),
  );
}

async function writeFileToFolder(
  fileSystem: MtpFileSystem,
  folder: UploadFolder,
  file: File,
  onProgress?: (uploadedBytes: number) => void,
): Promise<UploadResult> {
  const objectId = await withTransferRetry(() =>
    fileSystem.session.writeFileStream(
      folder.storageId,
      folder.folderId,
      file.name,
      file.size,
      countBytes(file.stream(), onProgress),
    ),
  );
  return { objectId, folder, path: joinPath(folder.folderPath, file.name) };
}

async function createMapFolder(fileSystem: MtpFileSystem, anchor: UploadFolder): Promise<UploadFolder> {
  const folderId = await withTransferRetry(() =>
    fileSystem.session.createFolder(anchor.storageId, ROOT_FOLDER_ID, 'Garmin'),
  );
  return { storageId: anchor.storageId, folderId, folderPath: 'Garmin' };
}

function countBytes(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (uploadedBytes: number) => void,
): ReadableStream<Uint8Array> {
  if (!onProgress) {
    return stream;
  }
  let uploadedBytes = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        uploadedBytes += chunk.byteLength;
        onProgress(uploadedBytes);
        controller.enqueue(chunk);
      },
    }),
  );
}

async function createChildFolder(fileSystem: MtpFileSystem, parent: UploadFolder, name: string): Promise<UploadFolder> {
  const folderId = await withTransferRetry(() =>
    fileSystem.session.createFolder(parent.storageId, parent.folderId, name),
  );
  return { storageId: parent.storageId, folderId, folderPath: joinPath(parent.folderPath, name) };
}

interface StorageScan {
  files: DeviceFile[];
  uploads: Map<Category, UploadFolder>;
  maps: MapFile[];
  anchor?: UploadFolder;
  mapFolder?: UploadFolder;
  searchIndexFolder: UploadFolder | null;
  descriptor: StoredFile | null;
}

function readFolderEntries(storage: DeviceStorage, folderId: number) {
  return withTransferRetry(() => storage.fileSystem.session.listChildren(storage.storageId, folderId));
}

type FolderEntry = Awaited<ReturnType<typeof readFolderEntries>>[number];

async function scanStorage(storage: DeviceStorage): Promise<StorageScan> {
  const scan: StorageScan = { files: [], uploads: new Map(), maps: [], searchIndexFolder: null, descriptor: null };
  const searchQueue: SearchFolder[] = [{ folderId: ROOT_FOLDER_ID, path: '', depth: 0 }];
  while (searchQueue.length > 0) {
    const searchFolder = searchQueue.shift();
    if (!searchFolder) {
      break;
    }
    const entries = await readFolderEntries(storage, searchFolder.folderId);
    for (const entry of entries) {
      if (!entry.isFolder) {
        continue;
      }
      const childFolder: UploadFolder = {
        storageId: storage.storageId,
        folderId: entry.id,
        folderPath: joinPath(searchFolder.path, entry.name),
      };
      const category = targetFolders.get(entry.name.toLowerCase());
      if (category !== undefined) {
        scan.uploads.set(category, childFolder);
        scan.anchor ??= { storageId: storage.storageId, folderId: searchFolder.folderId, folderPath: searchFolder.path };
        scan.files.push(...await collectAllFiles(storage, childFolder, category));
        continue;
      }
      if (entry.name.toLowerCase() === 'garmin') {
        const garminFiles = await collectGarminFiles(storage, childFolder);
        scan.mapFolder ??= childFolder;
        scan.maps.push(...garminFiles.maps);
        scan.searchIndexFolder ??= garminFiles.searchIndexFolder;
        scan.descriptor ??= garminFiles.descriptor;
      }
      if (searchFolder.depth + 1 < maxTargetSearchDepth) {
        searchQueue.push({ folderId: entry.id, path: childFolder.folderPath, depth: searchFolder.depth + 1 });
      }
    }
  }
  return scan;
}

interface GarminFiles {
  maps: MapFile[];
  searchIndexFolder: UploadFolder | null;
  descriptor: StoredFile | null;
}

async function collectGarminFiles(storage: DeviceStorage, folder: UploadFolder): Promise<GarminFiles> {
  const entries = await readFolderEntries(storage, folder.folderId);
  const garminFiles: GarminFiles = { maps: [], searchIndexFolder: null, descriptor: null };
  for (const entry of entries) {
    if (entry.isFolder) {
      if (entry.name.toLowerCase() === searchIndexFolderName.toLowerCase()) {
        garminFiles.searchIndexFolder = toChildFolder(storage, folder, entry);
        garminFiles.maps.push(...await collectSearchIndexes(storage, garminFiles.searchIndexFolder));
      }
      continue;
    }
    const file = toStoredFile(entry, folder.folderPath);
    if (garminFolderMapExtensions.has(fileExtension(entry.name))) {
      garminFiles.maps.push(file);
    } else if (entry.name.toLowerCase() === deviceDescriptorName) {
      garminFiles.descriptor = file;
    }
  }
  return garminFiles;
}

async function collectSearchIndexes(storage: DeviceStorage, folder: UploadFolder): Promise<MapFile[]> {
  const entries = await readFolderEntries(storage, folder.folderId);
  return entries
    .filter((entry) => !entry.isFolder && fileExtension(entry.name) === searchIndexExtension)
    .map((entry) => toStoredFile(entry, folder.folderPath));
}

function toChildFolder(storage: DeviceStorage, parent: UploadFolder, entry: FolderEntry): UploadFolder {
  return { storageId: storage.storageId, folderId: entry.id, folderPath: joinPath(parent.folderPath, entry.name) };
}

function toStoredFile(entry: FolderEntry, folderPath: string): StoredFile {
  return { id: entry.id, name: entry.name, size: entry.size, path: joinPath(folderPath, entry.name) };
}

export function hasMapImageExtension(name: string): boolean {
  return fileExtension(name) === mapImageExtension;
}

/** Map images, their activation files and search indexes. */
export function hasMapFileExtension(name: string): boolean {
  return mapFileExtensions.has(fileExtension(name));
}

async function collectAllFiles(storage: DeviceStorage, folder: UploadFolder, category: Category): Promise<DeviceFile[]> {
  const entries = await readFolderEntries(storage, folder.folderId);
  const files: DeviceFile[] = [];
  for (const entry of entries) {
    const childPath = joinPath(folder.folderPath, entry.name);
    if (entry.isFolder) {
      files.push(...await collectAllFiles(
        storage,
        { storageId: storage.storageId, folderId: entry.id, folderPath: childPath },
        category,
      ));
      continue;
    }
    files.push({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      path: childPath,
      folderName: category,
    });
  }
  return files;
}

function joinPath(parent: string, name: string): string {
  if (parent === '') {
    return name;
  }
  return `${parent}/${name}`;
}
