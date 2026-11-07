import { MtpDeviceDisconnectedError, type MtpFileSystem } from 'libmtp-web';
import {
  closeQuietly,
  connectToDevice,
  deleteDeviceFile,
  deviceModelName,
  deviceScanTimeoutMs,
  hasMapFileExtension,
  hasMapImageExtension,
  mapFileExtensions,
  openedStorageSpace,
  readStorageSpace,
  readSmallDeviceFile,
  ReadStalledError,
  scanDevice,
  uploadFile,
  uploadMapFile,
  withTimeout,
  type DeviceFile,
  type DeviceFolderIndex,
  type DeviceScan,
  type MapUploadResult,
  type StoredFile,
  type UploadResult,
} from './device.ts';
import {
  createStagedFile,
  createStagedMap,
  hasSupportedAudioExtension,
  reverifyDuplicate,
  supportedAudioExtensions,
  verifyStagedFile,
  verifyStagedMap,
  type StagedFile,
  type StagedMap,
} from './staging.ts';
import { emptyAudioMetadata, readDeviceFileMetadata } from './metadata.ts';
import type { MapGroup } from './map-groups.ts';
import { activationDisplayName, fileStem, isActivationFile, readDeviceMapInfo, readLocalMapInfo } from './map-info.ts';
import { describeError, isDeviceSelectionCancelled } from './util.ts';
import {
  clearScanProgress,
  connection,
  deviceAudioFileNames,
  deviceDescriptor,
  deviceFiles,
  deviceMapFileNames,
  deviceMaps,
  deviceName,
  deviceTitles,
  folders,
  forgetDeviceTitle,
  isBusy,
  isDisconnecting,
  rememberDeviceTitle,
  setFileRow,
  setMapRow,
  setScanProgress,
  setStatus,
  stagedFiles,
  stagedMaps,
  storageSpace,
  updateStaged,
  updateStagedMap,
  updateStagedMapThrottled,
  updateStagedThrottled,
  type FileRow,
  type MapRow,
} from './state.ts';

/** Files removed during the current listing; the title and header passes must not read them. */
let deletedPaths = new Set<string>();

/** Dotted extensions, in the form a file input's `accept` attribute takes. */
export const acceptedFileExtensions = [...supportedAudioExtensions, ...mapFileExtensions].map((extension) => `.${extension}`);

export function routeFiles(files: File[]): void {
  if (connection.value === null) {
    setStatus('Connect a device before adding files.', 'error');
    return;
  }
  const audioFiles = files.filter((file) => hasSupportedAudioExtension(file.name));
  const mapFiles = files.filter((file) => hasMapFileExtension(file.name));
  const unsupportedCount = files.length - audioFiles.length - mapFiles.length;
  if (unsupportedCount > 0) {
    setStatus(`${unsupportedCount} file(s) skipped: only ${acceptedFileExtensions.join(', ')} files are supported`, 'error');
  }
  if (audioFiles.length > 0) {
    void stageFiles(audioFiles);
  }
  if (mapFiles.length > 0) {
    void stageMapFiles(mapFiles);
  }
}

export function handleConnectToggle(): Promise<void> {
  const activeFileSystem = connection.value;
  if (activeFileSystem !== null) {
    return handleDisconnect(activeFileSystem);
  }
  return handleConnect();
}

async function handleConnect(): Promise<void> {
  isBusy.value = true;
  isDisconnecting.value = false;
  clearDeviceState();
  setStatus('Waiting for device selection…');
  try {
    const fileSystem = await connectToDevice();
    connection.value = fileSystem;
    deviceName.value = deviceModelName(fileSystem);
    storageSpace.value = openedStorageSpace(fileSystem);
    await displayDeviceFiles(fileSystem);
  } catch (error) {
    clearDeviceState();
    if (isMtpInterfaceMissing(error)) {
      setStatus('Device is not in MTP mode — try again in a few seconds.', 'error');
    } else if (isDeviceSelectionCancelled(error)) {
      setStatus('No device was selected.');
    } else {
      setStatus(describeError(error), 'error');
    }
  } finally {
    isBusy.value = false;
  }
}

const cleanCloseStatus = { message: 'Device session closed — safe to unplug the watch.', kind: 'none' } as const;
const uncleanCloseStatus = {
  message: 'Device session did not close cleanly. Wait a few seconds before unplugging the watch.',
  kind: 'notice',
} as const;

async function handleDisconnect(activeFileSystem: MtpFileSystem): Promise<void> {
  isBusy.value = true;
  isDisconnecting.value = true;
  clearDeviceState();
  setStatus('Closing the device session…');
  const isClosedCleanly = await closeQuietly(activeFileSystem);
  const closeStatus = isClosedCleanly ? cleanCloseStatus : uncleanCloseStatus;
  setStatus(closeStatus.message, closeStatus.kind);
  isBusy.value = false;
}

function clearDeviceState(): void {
  connection.value = null;
  folders.value = null;
  deviceName.value = '';
  deviceTitles.value = new Map();
  deviceFiles.value = [];
  deviceMaps.value = [];
  deviceDescriptor.value = null;
  storageSpace.value = null;
  stagedFiles.value = [];
  stagedMaps.value = [];
  clearScanProgress();
  deletedPaths = new Set();
}

function isMtpInterfaceMissing(error: unknown): boolean {
  return error instanceof Error && error.message.includes('none presented an MTP interface');
}

async function displayDeviceFiles(activeFileSystem: MtpFileSystem): Promise<void> {
  const modelName = deviceModelName(activeFileSystem);
  setStatus(`Connected to ${modelName}. Listing Music, Podcasts, Audiobooks and Garmin…`);
  let scan: DeviceScan;
  try {
    scan = await withTimeout(
      () => scanDevice(activeFileSystem),
      deviceScanTimeoutMs,
      () => new Error(`Listing the device did not finish within ${deviceScanTimeoutMs / 1000}s.`),
    );
  } catch (error) {
    abandonSession(activeFileSystem, error, 'the folder scan');
    return;
  }
  folders.value = scan.folders;
  deviceDescriptor.value = scan.descriptor;
  const files = scan.files.toSorted((left, right) => left.path.localeCompare(right.path));
  deviceFiles.value = files.map((file) => ({
    file,
    metadata: emptyAudioMetadata,
    metadataStatus: hasSupportedAudioExtension(file.name) ? 'pending' : 'skipped',
  }));
  const maps = scan.maps;
  deviceMaps.value = maps.map((map) => ({ map, displayName: '', createdOn: '', headerStatus: 'pending' }));
  if (maps.length > 0) {
    setStatus(`Reading ${maps.length} map header(s)…`);
    const isMapPassStalled = await resolveMapHeaders(activeFileSystem, deviceMaps.value);
    if (isMapPassStalled) {
      return;
    }
    labelActivationFiles();
  }
  setStatus(`${files.length} file(s), ${maps.length} map(s) found. Reading titles and genres…`);
  const isStalled = await resolveTitles(activeFileSystem, deviceFiles.value);
  if (isStalled) {
    return;
  }
  reverifyStagedFiles();
  reverifyStagedMaps();
  clearScanProgress();
  setStatus(`Done: ${files.length} file(s), ${maps.length} map(s) from ${modelName}.`);
}

async function resolveTitles(activeFileSystem: MtpFileSystem, rows: FileRow[]): Promise<boolean> {
  return resolveRowPass(activeFileSystem, rows, {
    path: (row) => row.file.path,
    isSkipped: (row) => row.metadataStatus === 'skipped',
    markFailed: (row) => setFileRow(row, { metadataStatus: 'failed' }),
    resolveRow: async (fileSystem, row) => {
      const metadata = await readDeviceFileMetadata(fileSystem, row.file);
      if (metadata.title !== '') {
        rememberDeviceTitle(metadata.title, row.file.path);
      }
      setFileRow(row, { metadata, metadataStatus: 'read' });
    },
    failureLabel: 'Metadata read',
  });
}

async function resolveMapHeaders(activeFileSystem: MtpFileSystem, rows: MapRow[]): Promise<boolean> {
  return resolveRowPass(activeFileSystem, rows, {
    path: (row) => row.map.path,
    isSkipped: () => false,
    markFailed: (row) => setMapRow(row, { headerStatus: 'failed' }),
    resolveRow: async (fileSystem, row) => {
      const info = await readDeviceMapInfo(fileSystem, row.map);
      setMapRow(row, { ...info, headerStatus: 'read' });
    },
    failureLabel: 'Map header read',
  });
}

/** .gma files carry no readable name, so they borrow the name of the map image they activate. */
function labelActivationFiles(): void {
  const mapNamesByStem = new Map(
    deviceMaps.value
      .filter((row) => hasMapImageExtension(row.map.name))
      .map((row) => [fileStem(row.map.name), row.displayName]),
  );
  deviceMaps.value = deviceMaps.value.map((row) =>
    isActivationFile(row.map.name)
      ? { ...row, displayName: activationDisplayName(row.map.name, mapNamesByStem) }
      : row,
  );
}

interface RowReadPass<TRow> {
  path(row: TRow): string;
  isSkipped(row: TRow): boolean;
  markFailed(row: TRow): void;
  resolveRow(fileSystem: MtpFileSystem, row: TRow): Promise<void>;
  failureLabel: string;
}

/**
 * Sequential read pass shared by the title and map-header resolves. Returns
 * true when a stalled or disconnected read abandoned the session, false when
 * the pass ran to the end or the session was replaced mid-pass.
 */
async function resolveRowPass<TRow>(
  activeFileSystem: MtpFileSystem,
  rows: TRow[],
  pass: RowReadPass<TRow>,
): Promise<boolean> {
  for (const [index, row] of rows.entries()) {
    setScanProgress(index, rows.length);
    const rowPath = pass.path(row);
    if (pass.isSkipped(row) || deletedPaths.has(rowPath)) {
      continue;
    }
    if (connection.value !== activeFileSystem) {
      return false;
    }
    try {
      await pass.resolveRow(activeFileSystem, row);
    } catch (error) {
      if (connection.value !== activeFileSystem) {
        return false;
      }
      if (deletedPaths.has(rowPath)) {
        continue;
      }
      pass.markFailed(row);
      if (error instanceof ReadStalledError || error instanceof MtpDeviceDisconnectedError) {
        markRemainingRowsFailed(rows, index, pass);
        abandonSession(activeFileSystem, error, rowPath);
        return true;
      }
      setStatus(`${pass.failureLabel} failed for ${rowPath}: ${describeError(error)}`, 'error');
      continue;
    }
  }
  setScanProgress(rows.length, rows.length);
  return false;
}

function markRemainingRowsFailed<TRow>(rows: TRow[], failedAtIndex: number, pass: RowReadPass<TRow>): void {
  for (const [index, row] of rows.entries()) {
    if (index > failedAtIndex && !pass.isSkipped(row)) {
      pass.markFailed(row);
    }
  }
}

function describeDeviceError(error: unknown): string {
  return error instanceof MtpDeviceDisconnectedError ? 'the device was unplugged' : describeError(error);
}

/** A stalled or disconnected session is hard-released via abort(); a fresh connect recovers without replugging. */
function abandonSession(activeFileSystem: MtpFileSystem, error: unknown, activity: string): void {
  if (connection.value !== activeFileSystem) {
    return;
  }
  clearDeviceState();
  activeFileSystem.abort().catch((abortError: unknown) => {
    console.warn('[mtp] aborting the stalled session failed:', abortError);
  });
  setStatus(
    `Device stopped responding while reading ${activity} (${describeDeviceError(error)}). ` +
      'Connect again to recover; no replug should be needed.',
    'error',
  );
}

interface DeleteRequest<TFile extends StoredFile> {
  files: TFile[];
  /** Receives the files actually deleted, which stop short of the full list when a delete fails. */
  removeRows(deletedFiles: TFile[]): void;
}

/** Deletes in order and stops at the first failure, leaving the remaining files on the device. */
async function deleteFromDevice<TFile extends StoredFile>(request: DeleteRequest<TFile>): Promise<void> {
  const activeFileSystem = connection.value;
  if (!activeFileSystem) {
    setStatus('No device connection.', 'error');
    return;
  }
  const paths = request.files.map((file) => file.path).join(', ');
  if (!window.confirm(`Delete ${paths} from the device?`)) {
    return;
  }
  const deletedFiles: TFile[] = [];
  try {
    for (const file of request.files) {
      await deleteDeviceFile(activeFileSystem, file);
      deletedFiles.push(file);
      deletedPaths.add(file.path);
    }
    setStatus(`Deleted ${paths}.`);
  } catch (error) {
    const failedPath = request.files[deletedFiles.length]?.path ?? paths;
    setStatus(`Delete failed for ${failedPath}: ${describeError(error)}`, 'error');
  } finally {
    request.removeRows(deletedFiles);
  }
  if (deletedFiles.length > 0) {
    await refreshStorageSpace(activeFileSystem);
  }
}

/** A failed refresh keeps the previous figures, which are at worst one change stale. */
async function refreshStorageSpace(activeFileSystem: MtpFileSystem): Promise<void> {
  try {
    const space = await readStorageSpace(activeFileSystem);
    if (connection.value === activeFileSystem) {
      storageSpace.value = space;
    }
  } catch (error) {
    console.warn('[mtp] free space refresh failed:', error);
  }
}

export async function handleDescriptorDownload(): Promise<void> {
  const activeFileSystem = connection.value;
  const descriptor = deviceDescriptor.value;
  if (!activeFileSystem || !descriptor) {
    setStatus('No device connection.', 'error');
    return;
  }
  setStatus(`Reading ${descriptor.path}…`);
  try {
    saveBlob(await readSmallDeviceFile(activeFileSystem, descriptor), descriptor.name);
    setStatus(`Downloaded ${descriptor.path}.`);
  } catch (error) {
    setStatus(`Download failed for ${descriptor.path}: ${describeDeviceError(error)}`, 'error');
  }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function handleDelete(file: DeviceFile): Promise<void> {
  await deleteFromDevice({
    files: [file],
    removeRows: (deletedFiles) => {
      deviceFiles.value = deviceFiles.value.filter((row) => !deletedFiles.includes(row.file));
      for (const deletedFile of deletedFiles) {
        forgetDeviceTitle(deletedFile.path);
      }
    },
  });
}

/** Deletes the map image together with its related files, since those stop working without it. */
export async function handleMapGroupDelete(group: MapGroup): Promise<void> {
  await deleteFromDevice({
    files: [group.primary, ...group.related].map((row) => row.map),
    removeRows: (deletedFiles) => {
      deviceMaps.value = deviceMaps.value.filter((row) => !deletedFiles.includes(row.map));
    },
  });
}

async function stageFiles(files: File[]): Promise<void> {
  const deviceFileNames = deviceAudioFileNames();
  for (const file of files) {
    const verified = await verifyStagedFile(createStagedFile(file), deviceTitles.value, deviceFileNames);
    if (verified.status === 'rejected') {
      setStatus(`${file.name} was not added: ${verified.reason}`, 'error');
      continue;
    }
    stagedFiles.value = [...stagedFiles.value, verified];
  }
}

async function stageMapFiles(files: File[]): Promise<void> {
  const deviceMapNames = deviceMapFileNames();
  for (const file of files) {
    const verified = verifyStagedMap(createStagedMap(file), deviceMapNames);
    if (verified.status === 'rejected') {
      setStatus(`${file.name} was not added: ${verified.reason}`, 'error');
      continue;
    }
    const info = await readLocalMapInfo(file);
    stagedMaps.value = [...stagedMaps.value, { ...verified, ...info }];
  }
}

function reverifyStagedFiles(): void {
  const deviceFileNames = deviceAudioFileNames();
  stagedFiles.value = reverifyStaged(stagedFiles.value, (staged) =>
    reverifyDuplicate(staged, deviceTitles.value, deviceFileNames));
}

function reverifyStagedMaps(): void {
  const deviceMapNames = deviceMapFileNames();
  stagedMaps.value = reverifyStaged(stagedMaps.value, (staged) => verifyStagedMap(staged, deviceMapNames));
}

/** Drops staged rows that duplicate files discovered since they were staged. */
function reverifyStaged<TRow extends { file: File; status: string; reason: string }>(
  rows: TRow[],
  reverify: (row: TRow) => TRow,
): TRow[] {
  const retained: TRow[] = [];
  for (const row of rows) {
    if (row.status !== 'ready') {
      retained.push(row);
      continue;
    }
    const rechecked = reverify(row);
    if (rechecked.status === 'rejected') {
      setStatus(`${row.file.name} was removed from staging: ${rechecked.reason}`, 'error');
      continue;
    }
    retained.push(row);
  }
  return retained;
}

interface UploadContext {
  fileSystem: MtpFileSystem;
  folders: DeviceFolderIndex;
}

interface StagedUploadPlan<TResult extends UploadResult> {
  fileName: string;
  start(): void;
  upload(context: UploadContext, onProgress: (uploadedBytes: number) => void): Promise<TResult>;
  reportProgress(uploadedBytes: number): void;
  complete(result: TResult, context: UploadContext): void;
  fail(reason: string): void;
}

export async function handleUpload(staged: StagedFile): Promise<void> {
  await runStagedUpload({
    fileName: staged.file.name,
    start: () => updateStaged(staged, { status: 'uploading', reason: '', uploadedBytes: 0 }),
    upload: (context, onProgress) => uploadFile(context.fileSystem, context.folders, {
      category: staged.category,
      file: staged.file,
      onProgress,
    }),
    reportProgress: (uploadedBytes) => updateStagedThrottled(staged, { uploadedBytes }),
    complete: (result, context) => recordUploadedFile(staged, result, context.folders),
    fail: (reason) => updateStaged(staged, { status: 'failed', reason }),
  });
}

export async function handleMapUpload(staged: StagedMap): Promise<void> {
  await runStagedUpload({
    fileName: staged.file.name,
    start: () => updateStagedMap(staged, { status: 'uploading', reason: '', uploadedBytes: 0 }),
    upload: (context, onProgress) => uploadMapFile(context.fileSystem, context.folders, {
      file: staged.file,
      onProgress,
    }),
    reportProgress: (uploadedBytes) => updateStagedMapThrottled(staged, { uploadedBytes }),
    complete: (result) => recordUploadedMap(staged, result),
    fail: (reason) => updateStagedMap(staged, { status: 'failed', reason }),
  });
}

async function runStagedUpload<TResult extends UploadResult>(plan: StagedUploadPlan<TResult>): Promise<void> {
  const fileSystem = connection.value;
  const activeFolders = folders.value;
  if (fileSystem === null || activeFolders === null) {
    setStatus('Connect and scan a device before uploading.', 'error');
    return;
  }
  const context: UploadContext = { fileSystem, folders: activeFolders };
  plan.start();
  try {
    const result = await plan.upload(context, plan.reportProgress);
    plan.complete(result, context);
    setStatus(`Added ${plan.fileName} to ${result.path}.`);
    await refreshStorageSpace(fileSystem);
  } catch (error) {
    const reason = describeDeviceError(error);
    plan.fail(reason);
    setStatus(`Upload of ${plan.fileName} failed: ${reason}`, 'error');
  }
}

function recordUploadedFile(staged: StagedFile, result: UploadResult, uploadFolders: DeviceFolderIndex): void {
  const uploads = new Map(uploadFolders.uploads).set(staged.category, result.folder);
  folders.value = { ...uploadFolders, uploads };
  if (staged.metadata.title !== '') {
    rememberDeviceTitle(staged.metadata.title, result.path);
  }
  stagedFiles.value = stagedFiles.value.filter((candidate) => candidate.file !== staged.file);
  const file: DeviceFile = {
    id: result.objectId,
    name: staged.file.name,
    size: staged.file.size,
    path: result.path,
    category: staged.category,
  };
  deviceFiles.value = [...deviceFiles.value, { file, metadata: staged.metadata, metadataStatus: 'read' }];
}

function recordUploadedMap(staged: StagedMap, result: MapUploadResult): void {
  folders.value = result.folders;
  stagedMaps.value = stagedMaps.value.filter((candidate) => candidate.file !== staged.file);
  deviceMaps.value = [...deviceMaps.value, {
    map: { id: result.objectId, name: staged.file.name, size: staged.file.size, path: result.path },
    displayName: staged.displayName,
    createdOn: staged.createdOn,
    headerStatus: 'read',
  }];
  labelActivationFiles();
}
