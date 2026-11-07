import type { Category, DeviceFile } from '../device.ts';
import type { StagedFile } from '../staging.ts';
import { deviceFiles, stagedFiles, type FileRow } from '../state.ts';
import { handleDelete, handleUpload } from '../flows.ts';
import type { AudioMetadata } from '../metadata.ts';
import { formatBytes, pluralize } from '../util.ts';
import { describeReadCell, joinClassNames } from './read-cell.ts';
import { UploadControls } from './UploadControls.tsx';

/** Primary columns absorb the table's leftover width; numeric ones right-align against the size column. */
type ColumnKind = 'primary' | 'text' | 'numeric';

interface TagColumn {
  header: string;
  pick: (metadata: AudioMetadata) => string;
  kind: ColumnKind;
}

const headerClassNames: Record<ColumnKind, string> = { primary: 'expand', text: '', numeric: 'num' };
const cellClassNames: Record<ColumnKind, string> = { primary: '', text: '', numeric: 'num' };

const sectionNoun: Record<Category, string> = {
  Music: 'track',
  Podcasts: 'episode',
  Audiobooks: 'chapter',
};

interface SectionHint {
  reason: string;
  command: string;
}

const sectionHints: Partial<Record<Category, SectionHint>> = {
  Audiobooks: {
    reason: 'Files must have genre set to Audiobook. Chapters group into one book when album and artist match.',
    command: [
      'ffmpeg -i ch3.m4b -c copy \\',
      '  -metadata genre=Audiobook \\',
      '  -metadata album="The Book" \\',
      '  -metadata artist="The Author" \\',
      '  -metadata title="Chapter 3" \\',
      '  -metadata track=3 \\',
      '  ch3.tagged.m4b',
    ].join('\n'),
  },
  Podcasts: {
    reason: 'Files must have genre set to Podcast. Episodes group into one show when album and artist match.',
    command: [
      'ffmpeg -i ep42.mp3 -c copy \\',
      '  -metadata genre=Podcast \\',
      '  -metadata album="The Show" \\',
      '  -metadata artist="The Host" \\',
      '  -metadata title="Episode 42" \\',
      '  -metadata track=42 \\',
      '  ep42.tagged.mp3',
    ].join('\n'),
  },
};

const tagColumns: Record<Category, readonly TagColumn[]> = {
  Music: [
    { header: 'Title', pick: (metadata) => metadata.title, kind: 'primary' },
    { header: 'Artist', pick: (metadata) => metadata.artist, kind: 'text' },
    { header: 'Album', pick: (metadata) => metadata.album, kind: 'text' },
    { header: 'Genre', pick: (metadata) => metadata.genre, kind: 'text' },
  ],
  Audiobooks: [
    { header: 'Chapter', pick: (metadata) => metadata.title, kind: 'primary' },
    { header: 'Book', pick: (metadata) => metadata.album, kind: 'text' },
    { header: 'Author', pick: (metadata) => metadata.artist, kind: 'text' },
    { header: '№', pick: (metadata) => metadata.track, kind: 'numeric' },
  ],
  Podcasts: [
    { header: 'Episode', pick: (metadata) => metadata.title, kind: 'primary' },
    { header: 'Podcast', pick: (metadata) => metadata.album, kind: 'text' },
    { header: 'Podcaster', pick: (metadata) => metadata.artist, kind: 'text' },
    { header: '№', pick: (metadata) => metadata.track, kind: 'numeric' },
  ],
};

export function AudioSection({ category }: { category: Category }) {
  const columns = tagColumns[category];
  const hint = sectionHints[category];
  const deviceRows = deviceFiles.value.filter((row) => row.file.category === category);
  const stagedRows = stagedFiles.value.filter((staged) => staged.category === category);
  const isEmpty = deviceRows.length === 0 && stagedRows.length === 0;
  const totalBytes = deviceRows.reduce((sum, row) => sum + row.file.size, 0);
  return (
    <section>
      <div class="section-header">
        <h3>{category}</h3>
        {!isEmpty && (
          <span class="section-meta muted">{pluralize(deviceRows.length, sectionNoun[category])} · {formatBytes(totalBytes)}</span>
        )}
      </div>
      {hint && <p class="help muted">{hint.reason}</p>}
      {hint && <pre class="command"><code>{hint.command}</code></pre>}
      {isEmpty ? (
        <p class="empty muted">Nothing here — drop audio files anywhere on the page to add them.</p>
      ) : (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th class={headerClassNames[column.kind]}>{column.header}</th>
                ))}
                <th class="num">Size</th>
                <th class="action"></th>
              </tr>
            </thead>
            {deviceRows.length > 0 && (
              <tbody>
                {deviceRows.map((row) => <DeviceAudioRow key={row.file.path} row={row} columns={columns} />)}
              </tbody>
            )}
            {stagedRows.length > 0 && (
              <tbody class="staged">
                {stagedRows.map((staged, index) => <StagedAudioRow key={`staged-${index}`} staged={staged} columns={columns} />)}
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

function DeviceAudioRow({ row, columns }: { row: FileRow; columns: readonly TagColumn[] }) {
  return (
    <tr title={row.file.path}>
      {columns.map((column) => {
        const cell = describeReadCell(column.pick(row.metadata), row.metadataStatus);
        return <td class={joinClassNames(cellClassNames[column.kind], cell.className)}>{cell.text}</td>;
      })}
      <td class="num muted">{formatBytes(row.file.size)}</td>
      <td class="action">
        <button class="button-danger" onClick={() => void handleDelete(row.file)}>Delete</button>
      </td>
    </tr>
  );
}

function StagedAudioRow({ staged, columns }: { staged: StagedFile; columns: readonly TagColumn[] }) {
  return (
    <tr class={staged.status === 'failed' ? 'failed' : undefined} title={staged.file.name}>
      {columns.map((column) => (
        <td class={cellClassNames[column.kind]}>{describeReadCell(column.pick(staged.metadata), 'read').text}</td>
      ))}
      <td class="num muted">{formatBytes(staged.file.size)}</td>
      <td class="action">
        <UploadControls
          status={staged.status}
          uploadedBytes={staged.uploadedBytes}
          totalBytes={staged.file.size}
          reason={staged.reason}
          onUpload={() => void handleUpload(staged)}
        />
      </td>
    </tr>
  );
}
