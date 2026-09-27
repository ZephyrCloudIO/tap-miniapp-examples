import '@theaiplatform/miniapp-sdk/ui/styles.css';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReadingPreferences } from '../../src/reading-preferences';
import { defaultPreferences, isMailPreferences, normalizeMailPreferences, type MailPreferences } from '../../src/domain';
import { RichMessageBody, plainTextFromRichMessage } from '../../src/rich-message';
import '../../src/styles.css';

const html = `<h1>Synthetic interactive email</h1>
<p id="result">Script has not run.</p>
<button onclick="document.getElementById('result').textContent = 'Button handler ran.'">Run embedded handler</button>
<ul id="checks"></ul>
<script>
 document.getElementById('result').textContent = 'Embedded script ran.';
 const report = (label, result) => {
   const item = document.createElement('li'); item.textContent = label + ': ' + result;
   document.getElementById('checks').append(item);
 };
 for (const [label, probe] of [
   ['Parent document', () => parent.document.body],
   ['Parent credentials', () => parent.localStorage.getItem('fixture-secret')],
   ['Local storage', () => localStorage.getItem('mail')],
   ['Cookies', () => document.cookie],
   ['WebRTC', () => new RTCPeerConnection()],
   ['Document replacement', () => document.open()],
   ['Child realm', () => { const child = document.createElement('iframe'); document.body.append(child); return child.contentWindow.RTCPeerConnection; }],
 ]) { try { probe(); report(label, 'UNEXPECTED ACCESS'); } catch { report(label, 'blocked'); } }
 document.addEventListener('DOMContentLoaded', () => report('DOMContentLoaded', 'ran'));
 window.addEventListener('load', () => report('Load handler', 'ran'));
 fetch('/network-probe').then(() => report('Network', 'UNEXPECTED ACCESS'), () => report('Network', 'blocked'));
</script>`;

function Fixture() {
  const [preferences, setPreferences] = useState<MailPreferences>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('interactive-email-preferences') ?? 'null');
      if (isMailPreferences(saved)) return normalizeMailPreferences(saved);
    } catch { /* New fixture profile. */ }
    return defaultPreferences;
  });
  const update = (next: MailPreferences) => {
    setPreferences(next);
    localStorage.setItem('interactive-email-preferences', JSON.stringify(next));
  };
  return <main style={{ maxWidth: 800, padding: 24, margin: 'auto' }}>
    <h1>Local Email renderer test</h1>
    <p>Synthetic content only. Uses the Email reader, its settings, and the TAP broker.</p>
    <ReadingPreferences preferences={preferences} onChange={update} />
    <p role="status">HTML: {preferences.htmlEnabled === false ? 'off' : 'on'} · JavaScript: {preferences.scriptsEnabled === false ? 'off' : 'on'}</p>
    {preferences.htmlEnabled === false
      ? <p className="plain-message-body">{plainTextFromRichMessage(html)}</p>
      : <RichMessageBody html={html} scriptsEnabled={preferences.scriptsEnabled !== false} title="Synthetic email document" />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
