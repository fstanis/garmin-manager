import { useRef } from 'preact/hooks';
import { categories } from '../device.ts';
import { acceptedFileExtensions, handleConnectToggle, handleDescriptorDownload, routeFiles } from '../flows.ts';
import { deviceDescriptor, deviceName, isBusy, storageSpace } from '../state.ts';
import { formatBytes } from '../util.ts';
import type { StorageSpace } from '../device.ts';
import { AudioSection } from './AudioSection.tsx';
import { MapsSection } from './MapsSection.tsx';

export function DeviceSection() {
  const disconnectLabel = isBusy.value ? 'Loading…' : 'Disconnect device';
  return (
    <section class="device">
      <h2>{deviceName.value}</h2>
      {storageSpace.value !== null && <StorageMeter space={storageSpace.value} />}
      <div class="device-actions">
        <AddFileButton />
        <button class="button-outline" onClick={() => void handleConnectToggle()} disabled={isBusy.value}>
          {disconnectLabel}
        </button>
        {deviceDescriptor.value !== null && (
          <button class="button-outline" onClick={() => void handleDescriptorDownload()} disabled={isBusy.value}>
            Download GarminDevice.xml
          </button>
        )}
      </div>
      <p class="drop-hint muted">Or you can drag and drop audio or map files anywhere on this page.</p>
      {categories.map((category) => (
        <AudioSection key={category} category={category} />
      ))}
      <MapsSection />
    </section>
  );
}

function AddFileButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    routeFiles([...(input.files ?? [])]);
    input.value = '';
  };
  return (
    <>
      <button onClick={() => inputRef.current?.click()}>Add file</button>
      <input ref={inputRef} type="file" multiple accept={acceptedFileExtensions.join(',')} hidden onChange={handleChange} />
    </>
  );
}

function StorageMeter({ space }: { space: StorageSpace }) {
  const usedBytes = space.capacityBytes - space.freeBytes;
  return (
    <div class="storage">
      <meter min={0} max={space.capacityBytes} value={usedBytes} />
      <span class="muted">{formatBytes(space.freeBytes)} free of {formatBytes(space.capacityBytes)}</span>
    </div>
  );
}
