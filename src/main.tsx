import { render } from 'preact';
import { preloadMtpRuntime } from './device.ts';
import { setStatus } from './state.ts';
import { describeError } from './util.ts';
import { App } from './components/App.tsx';

preloadMtpRuntime().catch((error: unknown) => {
  setStatus(`Failed to load the MTP runtime: ${describeError(error)}`, 'error');
});

const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app element');
}
render(<App />, app);
