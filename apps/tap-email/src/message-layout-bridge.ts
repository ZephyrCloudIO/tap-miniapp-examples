// This first-party script runs inside the existing opaque renderer. Sender
// scripts remain stripped when disabled; only this nonce-authorized observer runs.
const layoutScript = String.raw`(() => {
  const post = parent.postMessage.bind(parent);
  const send = data => post({ version: 1, ...data }, '*');
  let scheduled = false;
  let previousHeight = 0;
  const measure = () => {
    scheduled = false;
    const body = document.body;
    if (!body) return;
    const box = body.getBoundingClientRect();
    const margin = parseFloat(getComputedStyle(body).marginBottom) || 0;
    const height = Math.max(24, Math.ceil(box.top + window.scrollY + Math.max(box.height, body.scrollHeight) + margin));
    if (height === previousHeight) return;
    previousHeight = height;
    send({ type: 'tap.email.layout', height });
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  };
  new ResizeObserver(schedule).observe(document.body);
  new MutationObserver(schedule).observe(document.body, {
    attributes: true, characterData: true, childList: true, subtree: true,
  });
  document.addEventListener('load', schedule, true);
  document.addEventListener('error', schedule, true);
  document.addEventListener('toggle', schedule, true);
  window.addEventListener('resize', schedule);
  if (document.fonts) void document.fonts.ready.then(schedule);
  const nestedScroller = (target, direction) => {
    let element = target instanceof Element ? target : target?.parentElement;
    while (element && element !== document.body && element !== document.documentElement) {
      const maximum = element.scrollHeight - element.clientHeight;
      if (/^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY) && maximum > 0 &&
          (direction < 0 ? element.scrollTop > 0 : element.scrollTop < maximum)) return true;
      element = element.parentElement;
    }
    return false;
  };
  document.addEventListener('wheel', event => {
    if (event.defaultPrevented || event.ctrlKey || !event.deltaY || nestedScroller(event.target, event.deltaY)) return;
    event.preventDefault();
    send({ type: 'tap.email.scroll', deltaY: event.deltaY, deltaMode: event.deltaMode });
  }, { passive: false });
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
    if (event.shiftKey && event.key !== ' ') return;
    if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, summary, [contenteditable], [role="button"]')) return;
    const backwards = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.shiftKey;
    if (nestedScroller(event.target, backwards ? -1 : 1)) return;
    event.preventDefault();
    send({ type: 'tap.email.scroll-key', key: event.key, shiftKey: event.shiftKey });
  });
  schedule();
})();`;

export function withMessageLayoutBridge(source: string, nonce: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  const content = policy?.getAttribute('content');
  if (content) {
    policy?.setAttribute('content', content.replace("script-src 'none'", `script-src 'nonce-${nonce}'`));
  }
  const script = document.createElement('script');
  script.setAttribute('nonce', nonce);
  script.textContent = layoutScript;
  document.body.append(script);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

export const minimumMessageHeight = 24;
// Bound untrusted layout reports without cutting off normal long newsletters.
export const maximumMessageHeight = 1_000_000;

export function messageLayoutHeight(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximumMessageHeight
    ? Math.max(minimumMessageHeight, Math.ceil(value)) : null;
}
