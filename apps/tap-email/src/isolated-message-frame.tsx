import React, { useEffect, useRef } from 'react';

const rendererQuery = 'tap-isolated-document=v1';
let rendererProbe: Promise<string | null> | undefined;

/** The host must attest support before any sender scripts enter a frame. */
export function isolatedMessageRenderer(): Promise<string | null> {
  if (rendererProbe) return rendererProbe;
  const url = new URL(window.location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.resolve(null);
  url.search = rendererQuery;
  url.hash = '';
  rendererProbe = fetch(url.href, { method: 'HEAD', credentials: 'omit', signal: AbortSignal.timeout(5_000) })
    .then(response => response.ok && response.headers.get('x-tap-isolated-document') === '1' ? url.href : null)
    .catch(() => null);
  return rendererProbe;
}

export function IsolatedMessageFrame({ source, url, title, id, presentation, theme, onFailure }: {
  readonly onFailure: () => void;
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly id: string;
  readonly presentation: string;
  readonly theme: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let sent = false;
    const deadline = window.setTimeout(() => onFailure(), 10_000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.data?.version !== 1) return;
      let child: Window | null;
      try { child = frame.current?.contentWindow ?? null; }
      catch (error) {
        if (error instanceof DOMException && error.name === 'SecurityError') return;
        throw error;
      }
      if (!child || event.source !== child) return;
      if (event.data.type === 'tap.isolated-document.ready' && !sent) {
        sent = true;
        child.postMessage({ type: 'tap.isolated-document.render', version: 1, html: source }, '*');
      } else if (event.data.type === 'tap.isolated-document.mounted' && sent) {
        window.clearTimeout(deadline);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(deadline);
      window.removeEventListener('message', receive);
    };
  }, [source, onFailure]);
  return <>
    <iframe
      className="rich-message-frame"
      data-presentation={presentation}
      data-theme={theme}
      id={id}
      ref={frame}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      src={url}
      style={{ height: 480 }}
      title={title}
    />
  </>;
}
