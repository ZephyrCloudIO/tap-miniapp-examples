import React, { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RichMessageBody } from '../src/rich-message';
import '../src/styles.css';

// Public synthetic mail. Reproduce the host guard without weakening frame policy.
const html = `<body style="background:#fff;color:#222"><main style="padding:24px;max-width:640px;margin:auto">
  <h1>Synthetic newsletter</h1>${Array.from({ length: 50 }, (_, index) =>
    `<p>Newsletter section ${index + 1}. This sample exercises scrolling through a long email in a resizable reader.</p>`).join('')}</main></body>`;
function PanelHeightBenchmark() {
  const [height, setHeight] = useState(1000);
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const frame = panel.current?.querySelector('iframe');
    if (frame) Object.defineProperty(frame, 'contentDocument', {
      configurable: true, get: () => { throw new DOMException('Synthetic TAP host guard', 'SecurityError'); },
    });
  }, []);
  return <div className="tap-email" style={{ height: 'auto', minHeight: 0 }}>
    <div style={{ padding: 12 }}><button onClick={() => setHeight(1000)}>Tall panel</button>
      <button onClick={() => setHeight(560)}>Compact panel</button></div>
    <article className="message-pane" ref={panel} style={{ height, maxWidth: 960 }}>
      <header className="message-header"><h2>Host-guarded email height fixture</h2></header>
      <div className="reader-workspace"><div className="message-body">
        <div className="thread-page-controls"><p>All conversation messages loaded</p></div>
        <article className="thread-message is-expanded">
          <header className="thread-message-header">Sample sender</header>
          <div className="thread-message-content"><RichMessageBody html={html} title="Synthetic guarded email"
            scriptsEnabled={false} imagesEnabled={false} /></div>
        </article>
      </div></div>
    </article>
  </div>;
}
createRoot(document.getElementById('root')!).render(<PanelHeightBenchmark />);
