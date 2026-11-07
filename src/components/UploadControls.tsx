import type { StagedFile, StagedMap } from '../staging.ts';
import { progressPercent } from '../util.ts';

type StagedStatus = StagedFile['status'] | StagedMap['status'];

interface UploadControlsProps {
  status: StagedStatus;
  uploadedBytes: number;
  totalBytes: number;
  /** Rendered under the button when the last upload attempt failed; empty otherwise. */
  reason: string;
  onUpload: () => void;
}

export function UploadControls({ status, uploadedBytes, totalBytes, reason, onUpload }: UploadControlsProps) {
  if (status === 'uploading') {
    return (
      <div class="upload">
        <progress value={uploadedBytes} max={totalBytes} />
        <span class="upload-percent">{progressPercent(uploadedBytes, totalBytes)}</span>
      </div>
    );
  }
  return (
    <div>
      <button onClick={onUpload}>
        {status === 'failed' ? 'Retry' : 'Add'}
      </button>
      {status === 'failed' && reason !== '' && <div class="failure">{reason}</div>}
    </div>
  );
}
