import type { Category, DeviceFile } from '../device.ts';
import type { StagedFile } from '../staging.ts';
import { deviceFiles, stagedFiles, type FileRow } from '../state.ts';
import { handleDelete, handleUpload } from '../flows.ts';
import { formatBytes, orDash, pluralize } from '../util.ts';
import { UploadControls } from './UploadControls.tsx';

interface AudioTags {
  title: string;
  artist: string;
  album: string;
  track: string;
  genre: string;
}

interface TagColumn {
  header: string;
  pick: (tags: AudioTags) => string;
  /** Marks the primary text column, which absorbs the table's leftover width. */
  expand?: boolean;
  /** Right-aligns the column's numbers against the size column. */
  isNumeric?: boolean;
}

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
    { header: 'Title', pick: (tags) => tags.title, expand: true },
    { header: 'Artist', pick: (tags) => tags.artist },
    { header: 'Album', pick: (tags) => tags.album },
    { header: 'Genre', pick: (tags) => tags.genre },
  ],
  Audiobooks: [
    { header: 'Chapter', pick: (tags) => tags.title, expand: true },
    { header: 'Book', pick: (tags) => tags.album },
    { header: 'Author', pick: (tags) => tags.artist },
    { header: '№', pick: (tags) => tags.track, isNumeric: true },
  ],
  Podcasts: [
    { header: 'Episode', pick: (tags) => tags.title, expand: true },
    { header: 'Podcast', pick: (tags) => tags.album },
    { header: 'Podcaster', pick: (tags) => tags.artist },
    { header: '№', pick: (tags) => tags.track, isNumeric: true },
  ],
};

export function AudioSection({ category }: { category: Category }) {
  const columns = tagColumns[category];
  const hint = sectionHints[category];
  const deviceRows = deviceFiles.value.filter((row) => row.file.folderName === category);
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
                  <th class={headerClass(column)}>{column.header}</th>
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
  const tags: AudioTags = {
    title: row.metadata?.title ?? '',
    artist: row.metadata?.artist ?? '',
    album: row.metadata?.album ?? '',
    track: row.metadata?.track ?? '',
    genre: row.metadata?.genre ?? '',
  };
  return (
    <tr title={row.file.path}>
      {columns.map((column) => (
        <td class={tagCellClass(column, row.metadataStatus)}>{tagCellText(column.pick(tags), row.metadataStatus)}</td>
      ))}
      <td class="num muted">{formatBytes(row.file.size)}</td>
      <td class="action">
        <button class="button-danger" onClick={() => void handleDelete(row.file)}>Delete</button>
      </td>
    </tr>
  );
}

function StagedAudioRow({ staged, columns }: { staged: StagedFile; columns: readonly TagColumn[] }) {
  const tags: AudioTags = {
    title: staged.title,
    artist: staged.artist,
    album: staged.album,
    track: staged.track,
    genre: staged.genre,
  };
  return (
    <tr class={staged.status === 'failed' ? 'failed' : undefined} title={staged.file.name}>
      {columns.map((column) => (
        <td class={column.isNumeric ? 'num' : undefined}>{tagCellText(column.pick(tags), 'read')}</td>
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

function headerClass(column: TagColumn): string | undefined {
  if (column.expand) {
    return 'expand';
  }
  if (column.isNumeric) {
    return 'num';
  }
  return undefined;
}

function tagCellClass(column: TagColumn, status: FileRow['metadataStatus']): string | undefined {
  const classes: string[] = [];
  if (column.isNumeric) {
    classes.push('num');
  }
  if (status === 'pending' || status === 'failed') {
    classes.push(status === 'pending' ? 'cell-pending' : 'cell-failed');
  }
  return classes.length > 0 ? classes.join(' ') : undefined;
}

function tagCellText(value: string, status: FileRow['metadataStatus']): string {
  if (status === 'skipped') {
    return '';
  }
  if (status === 'pending') {
    return 'reading…';
  }
  if (status === 'failed') {
    return 'read failed';
  }
  return orDash(value);
}
