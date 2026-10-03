import '@theaiplatform/miniapp-sdk/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { TapEmailApp } from '../src/app';
import '../src/styles.css';

// Temporary review harness: the complete preview UI, synthetic mail, physical keys.
const samples: { key: string; bodyReadyMs: number | null; nextPaintMs?: number }[] = [];
const output = document.createElement('pre');
output.id = 'review-results';
output.style.cssText = 'position:fixed;bottom:0;right:0;z-index:99999;background:#101010;color:white;padding:8px;max-width:600px;max-height:180px;overflow:auto;font-size:12px';
document.body.append(output);
const heading = () => document.querySelector('[aria-label="Selected email"] h2')?.textContent;
let pending: { start: number; oldHeading: string | null | undefined; sample: typeof samples[number] } | null = null;
const publish = () => {
  output.textContent = JSON.stringify({ scope: 'Source preview; synthetic mail; no SQLite/host/backend', samples }, null, 2);
  void fetch('/review-results', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(samples) });
};
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    const event = entry as PerformanceEventTiming;
    if (event.name === 'keydown' && event.interactionId && samples.length) {
      samples[samples.length - 1]!.nextPaintMs = event.duration;
      publish();
    }
  }
}).observe({ type: 'event', durationThreshold: 16, buffered: false });
document.addEventListener('keydown', event => {
  if (!['j', 'k', 'e'].includes(event.key) || !event.isTrusted) return;
  const sample = { key: event.key, bodyReadyMs: null };
  samples.push(sample);
  pending = { start: performance.now(), oldHeading: heading(), sample };
}, true);
const observer = new MutationObserver(() => {
  const request = pending;
  if (!request || !heading() || heading() === request.oldHeading) return;
  const reader = document.querySelector('[aria-label="Selected email"]');
  const body = reader?.querySelector('.plain-message-body, iframe');
  if (!body) return;
  pending = null;
  const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    request.sample.bodyReadyMs = +(performance.now() - request.start).toFixed(2);
    publish();
  }));
  if (body instanceof HTMLIFrameElement) body.addEventListener('load', ready, { once: true });
  else ready();
});
observer.observe(document.getElementById('root')!, { subtree: true, childList: true, characterData: true });
createRoot(document.getElementById('root')!).render(<TapEmailApp preview />);
publish();
