import { handleConnectToggle } from '../flows.ts';
import { connection, isBusy, isDisconnecting, scanProgress, statusClassName, statusMessage } from '../state.ts';

export function ConnectSection() {
  let buttonLabel = 'Connect device';
  if (isBusy.value) {
    buttonLabel = isDisconnecting.value ? 'Disconnecting…' : 'Connecting…';
  }
  const progress = scanProgress.value;
  return (
    <section>
      {connection.value === null && (
        <button
          class="connect-button"
          onClick={() => void handleConnectToggle()}
          disabled={isBusy.value}
        >
          {buttonLabel}
        </button>
      )}
      {statusMessage.value !== '' && (
        <div role="status" class={statusClassName.value}>
          <p>{statusMessage.value}</p>
          {isBusy.value && (progress !== null
            ? <progress value={progress.completed} max={progress.total} />
            : <progress aria-hidden="true" />
          )}
        </div>
      )}
    </section>
  );
}
