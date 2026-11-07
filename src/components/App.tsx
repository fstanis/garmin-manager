import { useEffect, useState } from 'preact/hooks';
import { routeFiles } from '../flows.ts';
import { connection } from '../state.ts';
import { ConnectSection } from './ConnectSection.tsx';
import { DeviceSection } from './DeviceSection.tsx';

export function App() {
  const [isDropTargeted, setIsDropTargeted] = useState(false);
  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      dragDepth += 1;
      setIsDropTargeted(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event) || dragDepth === 0) {
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
        routeFiles(files);
      }
    };
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);
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
