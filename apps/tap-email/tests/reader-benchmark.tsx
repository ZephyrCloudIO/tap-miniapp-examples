import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThreadMessageList } from '../src/thread-messages';
import { ConversationReaderDeck } from '../src/conversation-reader-deck';
import { previewMailState } from '../src/domain';
import '../src/styles.css';

// Synthetic, downloaded HTML mail: measures rendering independently of SDK/network I/O.
const base = previewMailState().threads.find(thread => thread.messages.some(message => message.bodyHtml))!;
const messages = Array.from({ length: 3 }, (_, index) => [{ ...base.messages.at(-1)!,
  messageId: `benchmark_${index}`, bodyHtml: `<div><h1>Benchmark ${index}</h1>${base.messages.at(-1)!.bodyHtml ?? ''}</div>`,
}]);
const samples: { key: string; readyPaintMs: number; frameLoads: number }[] = [];
let frameLoads = 0;
document.addEventListener('load', event => { if (event.target instanceof HTMLIFrameElement) frameLoads++; }, true);
const noop = () => undefined;
const images = async () => ({});
const save = async () => { throw new Error('Attachments are not used in this benchmark.'); };
function Benchmark() {
  const [index, setIndex] = useState(0);
  const props = { accountId: base.accountId, appTheme: 'light' as const, attachmentExportSupported: false,
    imagesEnabled: false, scriptsEnabled: false, trackingPixelsEnabled: false, loadAttachment: null, loadRemoteImages: images,
    onKeyDown: noop, saveAttachment: save, threadId: `benchmark_${index}`, messages: messages[index]! };
  return <><button onClick={() => { samples.length = 0; document.querySelector('#metrics')!.textContent = '[]'; }}>Reset samples</button>
    <div className="message-body" style={{ height: 650 }}>
      <ConversationReaderDeck activeKey={String(index)} warmKeys={['0', '1', '2']}>
        {(key, active) => <ThreadMessageList {...props} active={active}
          threadId={`benchmark_${key}`} messages={messages[Number(key)]!} />}
      </ConversationReaderDeck>
    </div>
    <output id="metrics" aria-label="Benchmark measurements">[]</output>
    <span id="reader-index">{index}</span>
    <input aria-label="Reader keyboard target" autoFocus onKeyDown={event => {
      if (!['j', 'k'].includes(event.key)) return;
      const start = performance.now();
      const loadsBefore = frameLoads;
      const next = (index + (event.key === 'j' ? 1 : 2)) % 3;
      setIndex(next);
      const ready = () => {
        const frame = document.querySelector<HTMLIFrameElement>('[data-reader-active="true"] iframe');
        if (document.querySelector('#reader-index')?.textContent !== String(next) || !frame?.contentDocument?.body?.textContent?.includes(`Benchmark ${next}`)) {
          requestAnimationFrame(ready); return;
        }
        requestAnimationFrame(() => {
          samples.push({ key: event.key, readyPaintMs: +(performance.now() - start).toFixed(2), frameLoads: frameLoads - loadsBefore });
          document.querySelector('#metrics')!.textContent = JSON.stringify(samples);
        });
      };
      requestAnimationFrame(ready);
    }} /></>;
}
createRoot(document.getElementById('root')!).render(<Benchmark />);
