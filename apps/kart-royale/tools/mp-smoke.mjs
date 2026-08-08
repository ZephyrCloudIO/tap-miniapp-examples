/**
 * ============================================================================
 *  MULTIPLAYER SMOKE — two real clients racing through the session server
 * ============================================================================
 *  Boots `wrangler dev` (session server) and `rsbuild dev` (game), opens two
 *  puppeteer pages as different pilots, hosts + joins a room through the
 *  lobby overlay, runs the countdown, and asserts:
 *
 *    - both clients reach RaceState.Racing together;
 *    - each client sees the OTHER pilot's kart move (the relay works);
 *    - the non-host sees host-simulated AI backfill karts move;
 *    - no page errors and no console.errors on either client.
 *
 *  This is the Phase 3 proof: hybrid authority live, in real browsers, on the
 *  real production code path (lobby → tickets → sockets → NetKart poses).
 * ============================================================================
 */
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { startVite } from './vite-server.mjs';

const root = new URL('..', import.meta.url).pathname;
const serverRoot = new URL('../../kart-royale-server', import.meta.url).pathname;
const GAME_PORT = 5173;
const SERVER_PORT = 8787;

const results = { failures: [], notes: [] };
function note(text) { results.notes.push(text); console.log(`  [mp] ${text}`); }
function check(cond, label) {
  if (!cond) results.failures.push(label);
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
}

// --- session server lifecycle (same discipline as vite-server) -------------
// Use the package script so its predev hook creates the ignored local secret
// and its explicit CLI binding enables body-authored identities only for this
// local process. The checked-in/deployable Wrangler profile stays fail-closed.
const serverProc = spawn('pnpm', ['dev', '--ip', '127.0.0.1', '--port', String(SERVER_PORT)], {
  cwd: serverRoot,
  stdio: 'ignore',
  detached: true,
});
function stopServer() {
  try { process.kill(-serverProc.pid, 'SIGTERM'); } catch { /* gone */ }
  try { serverProc.kill('SIGTERM'); } catch { /* gone */ }
}
process.once('exit', stopServer);
process.once('SIGINT', () => { stopServer(); process.exit(130); });

async function waitFor(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const gameServer = await startVite(GAME_PORT);
note('game dev server up');
await waitFor(`http://localhost:${SERVER_PORT}/health`);
note('session server up');

// Two SEPARATE browser instances: a background tab suspends the game loop by
// design (`document.hidden` — the same contract as an iOS hidden tab), so two
// pages in one browser can never be live at once. Two players, two machines.
const browsers = [];
async function openPilot(user, name) {
  const browser = await puppeteer.launch({
    headless: true,
    // Two WebGL pages under SwiftShader starve the CDP socket; the default
    // protocol timeout reads that as a hang.
    protocolTimeout: 300000,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=900,506'],
  });
  browsers.push(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 506 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(
    `http://localhost:${GAME_PORT}/?user=${user}&name=${name}&quality=low`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction('window.__gameReady === true', { timeout: 90000 });
  return page;
}

async function clickButton(page, text, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clicked = await page.evaluate((want) => {
      for (const b of document.querySelectorAll('.kr-lobby button, .kr-lobby-toggle')) {
        if (b.textContent.trim() === want && !b.disabled) { b.click(); return true; }
      }
      return false;
    }, text);
    if (clicked) return;
    if (Date.now() > deadline) throw new Error(`button not clickable: ${text}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function waitLobbyText(page, text, timeoutMs = 60000) {
  // innerText reflects rendered case (the lobby CSS uppercases headings).
  await page.waitForFunction(
    (want) => document.body.innerText.toLowerCase().includes(want),
    { timeout: timeoutMs, polling: 500 },
    text.toLowerCase(),
  );
}

const kartPos = (page, slot) =>
  page.evaluate((s) => {
    const k = window.__ctx.race.karts[s];
    return k ? [k.position.x, k.position.z] : null;
  }, slot);

try {
  note('opening two pilots…');
  const alpha = await openPilot('alpha', 'Alpha');
  const bravo = await openPilot('bravo', 'Bravo');

  await clickButton(alpha, 'Race together');
  await waitLobbyText(alpha, 'Race together');
  await clickButton(alpha, 'Host a race');
  await waitLobbyText(alpha, 'Lobby');
  note('alpha hosted a room');

  await clickButton(bravo, 'Race together');
  await waitLobbyText(bravo, 'Race together');
  await clickButton(bravo, 'Refresh');
  await page_settle(bravo, 800);
  await clickButton(bravo, 'Race');
  await waitLobbyText(bravo, 'Lobby');
  note('bravo joined the room');

  await clickButton(bravo, 'Ready');
  await clickButton(alpha, 'Ready');
  await waitLobbyText(alpha, 'Start race');
  await clickButton(alpha, 'Start race');
  note('race started');

  // The countdown ticks in frame time; under SwiftShader a 4.4 s countdown
  // takes many wall seconds. Wait for both clients to reach Racing.
  for (const [label, page] of [['alpha', alpha], ['bravo', bravo]]) {
    await page.waitForFunction(
      () => window.__ctx.race.state === 2,
      { timeout: 90000, polling: 500 },
    );
    note(`${label} is racing`);
  }

  // Everyone holds the throttle now.
  await alpha.keyboard.down('ArrowUp');
  await bravo.keyboard.down('ArrowUp');

  const before = {
    alphaPeer: await kartPos(alpha, 1),
    bravoPeer: await kartPos(bravo, 0),
    bravoAi: await kartPos(bravo, 3),
  };
  await page_settle(alpha, 4000);
  await alpha.keyboard.up('ArrowUp');
  await bravo.keyboard.up('ArrowUp');
  const after = {
    alphaPeer: await kartPos(alpha, 1),
    bravoPeer: await kartPos(bravo, 0),
    bravoAi: await kartPos(bravo, 3),
  };
  const moved = (a, b) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5;
  check(moved(before.alphaPeer, after.alphaPeer), 'alpha sees bravo\u2019s kart move (relay)');
  check(moved(before.bravoPeer, after.bravoPeer), 'bravo sees alpha\u2019s kart move (relay)');
  check(moved(before.bravoAi, after.bravoAi), 'bravo sees host-simulated AI kart move');

  // --- server-arbitrated items -------------------------------------------
  // alpha draws from box 0 (the adapter API — the box-contact half is
  // Items-internal and covered by the solo autoplay gate).
  await alpha.evaluate(() => {
    window.__mp.adapter.requestDraw(window.__ctx.race.player, 0);
  });
  await alpha.waitForFunction(
    () => window.__ctx.items.held(window.__ctx.race.player).count > 0,
    { timeout: 20000, polling: 300 },
  );
  const granted = await alpha.evaluate(() => {
    const held = window.__ctx.items.held(window.__ctx.race.player);
    return { kind: held.kind, count: held.count };
  });
  note(`alpha granted server-rolled item ${granted.kind} ×${granted.count}`);
  // Wait out the roulette arm, then spend it.
  await page_settle(alpha, 1400);
  await alpha.evaluate(() => {
    window.__mp.adapter.requestUse(window.__ctx.race.player, false);
  });
  await alpha.waitForFunction(
    (before) => window.__ctx.items.held(window.__ctx.race.player).count < before,
    { timeout: 20000, polling: 300 },
    granted.count,
  );
  note('alpha spent it through the room');
  // On bravo the spend is visible: either a remote projectile exists, or the
  // boost/star timer arrives with alpha's next state sample. Do not inspect
  // immediately after alpha's local confirmation: the broadcast and the
  // following state relay are separate WebSocket frames.
  await bravo.waitForFunction(
    () => {
      const proj = window.__ctx.items.proj;
      const remoteLive = proj.pool.some((p) => p.remote && p.state !== 0);
      const alphaKart = window.__ctx.race.karts[0];
      return remoteLive || alphaKart.boostTime > 0 || alphaKart.starTime > 0;
    },
    { timeout: 5000, polling: 100 },
  );
  const bravoSaw = await bravo.evaluate(() => {
    const proj = window.__ctx.items.proj;
    const remoteLive = proj.pool.some((p) => p.remote && p.state !== 0);
    const alphaKart = window.__ctx.race.karts[0];
    return { remoteLive, alphaBoost: alphaKart.boostTime, alphaStar: alphaKart.starTime };
  });
  check(
    bravoSaw.remoteLive || bravoSaw.alphaBoost > 0 || bravoSaw.alphaStar > 0,
    `bravo observes alpha's spend (projectile ${bravoSaw.remoteLive}, boost ${bravoSaw.alphaBoost}, star ${bravoSaw.alphaStar})`,
  );

  check(alpha.errors.length === 0, `alpha: no page errors (${alpha.errors.length})`);
  check(bravo.errors.length === 0, `bravo: no page errors (${bravo.errors.length})`);
  if (alpha.errors.length) console.log(alpha.errors.slice(0, 5));
  if (bravo.errors.length) console.log(bravo.errors.slice(0, 5));

  await alpha.screenshot({ path: '/tmp/mp-alpha.png' });
  await bravo.screenshot({ path: '/tmp/mp-bravo.png' });
  note('screenshots in /tmp/mp-alpha.png and /tmp/mp-bravo.png');
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  gameServer.stop();
  stopServer();
}

function page_settle(page, ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (results.failures.length) {
  console.error(`\nMP SMOKE FAILED: ${results.failures.join('; ')}`);
  process.exit(1);
}
console.log('\nMP SMOKE OK');
