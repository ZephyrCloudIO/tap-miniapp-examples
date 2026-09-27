import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const root = path.join(app, 'dist-diagnostics');
const reportFile = path.join(app, '.tap-diagnostics', 'harness', 'reports.json');
let stored = { value: null, revision: null };
try { stored = JSON.parse(await readFile(reportFile, 'utf8')); } catch { /* First run. */ }
let denyStorage = false;
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Email local diagnostics</title>
<style>body{font:14px system-ui;margin:0;background:#161716;color:#eee}header{padding:14px 20px}button{padding:8px 12px;margin-right:8px}iframe{width:100%;height:76vh;border:0;background:#fff}pre{max-height:180px;overflow:auto;white-space:pre-wrap}details{padding:12px 20px}</style>
<header><strong>Locally built Email · synthetic mailbox</strong><p id="status">Waiting for mailbox hydration…</p>
<button id="render" disabled>Inject render failure</button><button id="promise" disabled>Inject rejected promise</button><button id="reload">Reload Email</button><label><input type="checkbox" id="deny">Deny diagnostic storage</label></header>
<iframe title="Local Email" id="email" sandbox="allow-scripts allow-same-origin allow-forms" src="/app/index.html"></iframe>
<details id="saved"><summary>Saved reports outside Email</summary><pre id="reports">No errors recorded.</pre></details>
<script>
const frame = document.getElementById('email'), status = document.getElementById('status');
const faultButtons = [document.getElementById('render'), document.getElementById('promise')];
window.addEventListener('message', event => {
  if(event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if(event.data?.type === 'mailbox-ready') {status.textContent = 'Mailbox rendered. Failure controls are ready.';faultButtons.forEach(button => button.disabled = false);}
});
faultButtons.forEach((button,index) => button.onclick = () => frame.contentWindow.postMessage({type:index ? 'promise-failure' : 'render-failure'},location.origin));
document.getElementById('reload').onclick = () => {frame.src = '/app/index.html';faultButtons.forEach(button => button.disabled = true);status.textContent = 'Waiting for mailbox hydration…';};
document.getElementById('deny').onchange = event => fetch('/deny',{method:'POST',body:JSON.stringify({deny:event.target.checked})});
setInterval(async () => {const state = await (await fetch('/reports')).json(); document.getElementById('reports').textContent = JSON.stringify(state,null,2); document.getElementById('saved').querySelector('summary').textContent = 'Saved reports outside Email (' + (state.value?.length || 0) + ')';}, 500);
</script></html>`;
const server = createServer(async (request, response) => {
  const send = (status, type, content) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(content); };
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 100_000) throw new Error('Request too large'); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (url.pathname === '/deny') { denyStorage = input.deny === true; return send(200, 'application/json', '{}'); }
      if (url.pathname !== '/diagnostics') return send(404, 'text/plain', 'Not found');
      if (denyStorage) return send(403, 'text/plain', 'Denied');
      if (input.expectedRevision !== stored.revision) return send(409, 'text/plain', 'Conflict');
      stored = { value: input.value, revision: (stored.revision ?? 0) + 1 };
      await mkdir(path.dirname(reportFile), { recursive: true });
      await writeFile(reportFile, JSON.stringify(stored, null, 2));
      return send(200, 'application/json', JSON.stringify({ revision: stored.revision }));
    }
    if (url.pathname === '/diagnostics' && denyStorage) return send(403, 'text/plain', 'Denied');
    if (url.pathname === '/diagnostics' || url.pathname === '/reports') return send(200, 'application/json', JSON.stringify(stored));
    if (url.pathname === '/') return send(200, 'text/html', page);
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname.replace(/^\/app/u, '')));
    if (!file.startsWith(root + path.sep) || file.endsWith('.map')) return send(404, 'text/plain', 'Not found');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    send(200, types[path.extname(file)] ?? 'application/octet-stream', await readFile(file));
  } catch { send(404, 'text/plain', 'Not found'); }
});
server.listen(Number(process.env.PORT ?? 53681), '127.0.0.1', () => {
  console.log(`Local Email diagnostics: http://127.0.0.1:${server.address().port}`);
  console.log(`Saved reports: ${reportFile}`);
});
