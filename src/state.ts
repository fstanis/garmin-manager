import { computed, signal } from '@preact/signals';
import type { MtpFileSystem } from 'libmtp-web';
import type { DeviceFile, DeviceFolderIndex, MapFile, StorageSpace, StoredFile } from './device.ts';
import type { AudioMetadata } from './metadata.ts';
import type { StagedFile, StagedMap } from './staging.ts';

export type ReadStatus = 'pending' | 'read' | 'failed' | 'skipped';

export interface FileRow {
  file: DeviceFile;
  /** Empty until metadataStatus is 'read'. */
  metadata: AudioMetadata;
  metadataStatus: ReadStatus;
}

export interface MapRow {
  map: MapFile;
  /** Map name from the device header; empty while unread or when unreadable. */
  displayName: string;
  /** Creation date from the device header; empty while unread or when unreadable. */
  createdOn: string;
  headerStatus: Exclude<ReadStatus, 'skipped'>;
}

/** Troubleshooting steps the status line can offer behind a Help button. */
export type HelpTopic = 'none' | 'device-busy';

export const statusMessage = signal('');
export const statusHelpTopic = signal<HelpTopic>('none');
export const statusKind = signal<'none' | 'notice' | 'error'>('none');
export const statusClassName = computed(() => statusKind.value === 'none' ? 'status' : `status ${statusKind.value}`);
export const isBusy = signal(false);
export const isDisconnecting = signal(false);
/** Completed-vs-total row counts for the running device read pass; null while the total is unknown. */
export const scanProgress = signal<{ completed: number; total: number } | null>(null);
export const connection = signal<MtpFileSystem | null>(null);
export const deviceName = signal('');
export const folders = signal<DeviceFolderIndex | null>(null);
export const deviceTitles = signal(new Map<string, string>());
export const deviceFiles = signal<FileRow[]>([]);
export const deviceMaps = signal<MapRow[]>([]);
export const deviceDescriptor = signal<StoredFile | null>(null);
/** Null while no device is connected. */
export const storageSpace = signal<StorageSpace | null>(null);
export const stagedFiles = signal<StagedFile[]>([]);
export const stagedMaps = signal<StagedMap[]>([]);

export function setStatus(message: string, kind: 'none' | 'notice' | 'error' = 'none'): void {
  statusMessage.value = message;
  statusKind.value = kind;
  statusHelpTopic.value = 'none';
}

export function setErrorStatusWithHelp(message: string, helpTopic: HelpTopic): void {
  setStatus(message, 'error');
  statusHelpTopic.value = helpTopic;
}

export function setScanProgress(completed: number, total: number): void {
  if (total === 0) {
    return;
  }
  scanProgress.value = { completed, total };
}

export function clearScanProgress(): void {
  scanProgress.value = null;
}

export function setFileRow(row: FileRow, patch: Partial<FileRow>): void {
  deviceFiles.value = deviceFiles.value.map((candidate) => (candidate === row ? { ...candidate, ...patch } : candidate));
}

export function setMapRow(row: MapRow, patch: Partial<MapRow>): void {
  deviceMaps.value = deviceMaps.value.map((candidate) => (candidate === row ? { ...candidate, ...patch } : candidate));
}

/** Matches by file identity so in-flight progress closures holding an older row object still update the live one. */
export function updateStaged(staged: StagedFile, patch: Partial<StagedFile>): void {
  stagedFiles.value = stagedFiles.value.map((candidate) => (candidate.file === staged.file ? { ...candidate, ...patch } : candidate));
}

export function updateStagedMap(staged: StagedMap, patch: Partial<StagedMap>): void {
  stagedMaps.value = stagedMaps.value.map((candidate) => (candidate.file === staged.file ? { ...candidate, ...patch } : candidate));
}

const progressWriteIntervalMs = 100;

function createThrottle(intervalMs: number): (action: () => void) => void {
  let lastRunAtMs = 0;
  return (action: () => void) => {
    const now = Date.now();
    if (now - lastRunAtMs < intervalMs) {
      return;
    }
    lastRunAtMs = now;
    action();
  };
}

const throttleStagedProgress = createThrottle(progressWriteIntervalMs);
const throttleStagedMapProgress = createThrottle(progressWriteIntervalMs);

export function updateStagedThrottled(staged: StagedFile, patch: Partial<StagedFile>): void {
  throttleStagedProgress(() => updateStaged(staged, patch));
}

export function updateStagedMapThrottled(staged: StagedMap, patch: Partial<StagedMap>): void {
  throttleStagedMapProgress(() => updateStagedMap(staged, patch));
}

export function rememberDeviceTitle(title: string, path: string): void {
  deviceTitles.value = new Map(deviceTitles.value).set(title.toLowerCase(), path);
}

export function forgetDeviceTitle(path: string): void {
  const titles = new Map(deviceTitles.value);
  for (const [title, titlePath] of titles) {
    if (titlePath === path) {
      titles.delete(title);
    }
  }
  deviceTitles.value = titles;
}

export function deviceAudioFileNames(): Map<string, string> {
  return new Map(deviceFiles.value.map((row) => [row.file.name.toLowerCase(), row.file.path]));
}

export function deviceMapFileNames(): Map<string, string> {
  return new Map(deviceMaps.value.map((row) => [row.map.name.toLowerCase(), row.map.path]));
}
