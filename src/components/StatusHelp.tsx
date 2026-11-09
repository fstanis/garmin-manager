import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { HelpTopic } from '../state.ts';

type Platform = 'android' | 'macos' | 'other';

const deviceBusySteps: Record<Platform, ComponentChildren[]> = {
  android: [
    'Open Settings → Apps and turn on showing system apps.',
    <>Find <strong>MTP Host</strong> (on some phones, "MTP application") and tap <strong>Disable</strong>. If it can't be disabled, tap <strong>Force stop</strong> each time after plugging in the watch.</>,
    'Close the Files app if it opened for the watch.',
    'Tap Connect device again.',
  ],
  macos: [
    'Quit Image Capture, Photos, Android File Transfer and any other tab using the watch.',
    <>macOS's camera service may still hold the watch. In Terminal, run <code>sudo pkill PTPCamera</code>.</>,
    'Click Connect device again.',
  ],
  other: [
    'Close any app or browser tab that may be using the watch.',
    'Unplug the watch, plug it back in and click Connect device again.',
  ],
};

const helpSteps: Record<Exclude<HelpTopic, 'none'>, Record<Platform, ComponentChildren[]>> = {
  'device-busy': deviceBusySteps,
};

/** Toggles platform-specific troubleshooting steps for the status line's error. */
export function StatusHelp({ topic }: { topic: Exclude<HelpTopic, 'none'> }) {
  const [isOpen, setIsOpen] = useState(false);
  const steps = helpSteps[topic][detectPlatform()];
  return (
    <div class="status-help">
      <button class="button-outline" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? 'Hide help' : 'Help'}
      </button>
      {isOpen && (
        <ol>
          {steps.map((step) => <li>{step}</li>)}
        </ol>
      )}
    </div>
  );
}

function detectPlatform(): Platform {
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) {
    return 'android';
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return 'macos';
  }
  return 'other';
}
