import type { ComponentChildren } from 'preact';
import { deviceMaps, folders, stagedMaps, type MapRow } from '../state.ts';
import { handleMapGroupDelete, handleMapUpload } from '../flows.ts';
import { groupMapRows, type MapGroup } from '../map-groups.ts';
import { formatBytes, orDash, pluralize } from '../util.ts';
import type { StagedMap } from '../staging.ts';
import { UploadControls } from './UploadControls.tsx';

export function MapsSection() {
  const isEmpty = deviceMaps.value.length === 0 && stagedMaps.value.length === 0;
  const totalBytes = deviceMaps.value.reduce((sum, row) => sum + row.map.size, 0);
  return (
    <section>
      <div class="section-header">
        <h3>Maps</h3>
        {!isEmpty && (
          <span class="section-meta muted">{pluralize(deviceMaps.value.length, 'file')} · {formatBytes(totalBytes)}</span>
        )}
      </div>
      {folders.value?.mapFolder === null && (
        <p class="warning"><strong>No Garmin folder found on this device — it may not be a Garmin.</strong></p>
      )}
      {isEmpty ? (
        <p class="empty muted">Nothing here — drop .img, .gma or .sid map files anywhere on the page to add them.</p>
      ) : (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th class="expand">Map</th>
                <th class="num">Created</th>
                <th class="num">Size</th>
                <th class="action"></th>
              </tr>
            </thead>
            {groupMapRows(deviceMaps.value).map((group) => <DeviceMapGroup key={group.primary.map.path} group={group} />)}
            {stagedMaps.value.length > 0 && (
              <tbody class="staged">
                {stagedMaps.value.map((staged, index) => <StagedMapRow key={`staged-${index}`} staged={staged} />)}
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

function DeviceMapGroup({ group }: { group: MapGroup }) {
  return (
    <tbody class="map-group">
      <DeviceMapRow row={group.primary} isRelated={false}>
        <button class="button-danger" onClick={() => void handleMapGroupDelete(group)}>Delete</button>
      </DeviceMapRow>
      {group.related.map((row) => <DeviceMapRow key={row.map.path} row={row} isRelated />)}
    </tbody>
  );
}

function DeviceMapRow({ row, isRelated, children }: { row: MapRow; isRelated: boolean; children?: ComponentChildren }) {
  const header = describeMapHeader(row);
  const nameClass = [header.cellClass, isRelated ? 'related' : undefined].filter(Boolean).join(' ');
  return (
    <tr title={row.map.path}>
      <td class={nameClass}>{orDash(header.text)}</td>
      <td class="num">{orDash(row.createdOn)}</td>
      <td class="num muted">{formatBytes(row.map.size)}</td>
      <td class="action">{children}</td>
    </tr>
  );
}

function describeMapHeader(row: MapRow): { text: string; cellClass: string | undefined } {
  if (row.headerStatus === 'pending') {
    return { text: 'reading…', cellClass: 'cell-pending' };
  }
  if (row.headerStatus === 'failed') {
    return { text: 'read failed', cellClass: 'cell-failed' };
  }
  return { text: row.displayName ?? '', cellClass: undefined };
}

function StagedMapRow({ staged }: { staged: StagedMap }) {
  return (
    <tr class={staged.status === 'failed' ? 'failed' : undefined} title={staged.file.name}>
      <td>{staged.displayName !== '' ? staged.displayName : staged.file.name}</td>
      <td class="num">{orDash(staged.createdOn)}</td>
      <td class="num muted">{formatBytes(staged.file.size)}</td>
      <td class="action">
        <UploadControls
          status={staged.status}
          uploadedBytes={staged.uploadedBytes}
          totalBytes={staged.file.size}
          reason={staged.reason}
          onUpload={() => void handleMapUpload(staged)}
        />
      </td>
    </tr>
  );
}
