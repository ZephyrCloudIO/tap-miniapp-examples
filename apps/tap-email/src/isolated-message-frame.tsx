import React, { useEffect, useMemo, useRef, useState } from 'react';
import { messageLayoutHeight, minimumMessageHeight, withMessageLayoutBridge } from './message-layout-bridge';

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
  const [height, setHeight] = useState(minimumMessageHeight);
  const measuredSource = useMemo(() => withMessageLayoutBridge(source, crypto.randomUUID()), [source]);
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
        child.postMessage({ type: 'tap.isolated-document.render', version: 1, html: measuredSource }, '*');
      } else if (event.data.type === 'tap.isolated-document.mounted' && sent) {
        window.clearTimeout(deadline);
      } else if (event.data.type === 'tap.email.layout' && sent) {
        const nextHeight = messageLayoutHeight(event.data.height);
        if (nextHeight !== null) setHeight(nextHeight);
      } else if (sent) {
        const reader = frame.current?.closest<HTMLElement>('.message-body');
        if (!reader) return;
        if (event.data.type === 'tap.email.scroll' && typeof event.data.deltaY === 'number' && Number.isFinite(event.data.deltaY)) {
          const scale = event.data.deltaMode === 1 ? 16 : event.data.deltaMode === 2 ? reader.clientHeight : 1;
          reader.scrollTop += Math.max(-reader.scrollHeight, Math.min(reader.scrollHeight, event.data.deltaY * scale));
        } else if (event.data.type === 'tap.email.scroll-key') {
          const key = event.data.key;
          if (key === 'Home') reader.scrollTop = 0;
          else if (key === 'End') reader.scrollTop = reader.scrollHeight;
          else if (key === 'ArrowDown') reader.scrollTop += 40;
          else if (key === 'ArrowUp') reader.scrollTop -= 40;
          else if (key === 'PageDown' || (key === ' ' && !event.data.shiftKey)) reader.scrollTop += reader.clientHeight;
          else if (key === 'PageUp' || (key === ' ' && event.data.shiftKey)) reader.scrollTop -= reader.clientHeight;
        }
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(deadline);
      window.removeEventListener('message', receive);
    };
  }, [measuredSource, onFailure]);
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
      style={{ height }}
      title={title}
    />
  </>;
}
