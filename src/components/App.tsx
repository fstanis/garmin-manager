import { useEffect, useState } from 'preact/hooks';
import { routeFiles } from '../flows.ts';
import { connection } from '../state.ts';
import { ConnectSection } from './ConnectSection.tsx';
import { DeviceSection } from './DeviceSection.tsx';

export function App() {
  const isDropTargeted = useWindowFileDrop(routeFiles);
  return (
    <div>
      {isDropTargeted && (
        <div class="dropzone" aria-hidden="true">
          <div class="dropzone-panel">Drop audio or map files to add them</div>
        </div>
      )}
      <ConnectSection />
      {connection.value !== null && <DeviceSection />}
    </div>
  );
}

/** Accepts files dropped anywhere on the window; true while files are dragged over it. */
function useWindowFileDrop(onDrop: (files: File[]) => void): boolean {
  const [isDropTargeted, setIsDropTargeted] = useState(false);
  useEffect(() => {
    // dragenter and dragleave fire for every child element crossed, so only the outermost pair counts.
    let dragDepth = 0;
    const handleDragEnter = (event: DragEvent) => {
      if (!hasDraggedFiles(event)) {
        return;
      }
      dragDepth += 1;
      setIsDropTargeted(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasDraggedFiles(event) || dragDepth === 0) {
        return;
      }
      dragDepth -= 1;
      if (dragDepth === 0) {
        setIsDropTargeted(false);
      }
    };
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepth = 0;
      setIsDropTargeted(false);
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) {
        onDrop(files);
      }
    };
    const listeners: [keyof WindowEventMap, (event: DragEvent) => void][] = [
      ['dragenter', handleDragEnter],
      ['dragleave', handleDragLeave],
      ['dragover', handleDragOver],
      ['drop', handleDrop],
    ];
    for (const [type, listener] of listeners) {
      window.addEventListener(type, listener as EventListener);
    }
    return () => {
      for (const [type, listener] of listeners) {
        window.removeEventListener(type, listener as EventListener);
      }
    };
  }, [onDrop]);
  return isDropTargeted;
}

function hasDraggedFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}
