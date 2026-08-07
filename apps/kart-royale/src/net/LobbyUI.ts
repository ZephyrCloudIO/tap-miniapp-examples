/**
 * ============================================================================
 *  MULTIPLAYER LOBBY (overlay)
 * ============================================================================
 *  A self-contained panel above the title screen: list the channel's open
 *  rooms, host one, join as player or spectator, ready up, and let the host
 *  start. Deliberately separate from `Menus.ts` — the vendored menu stack
 *  owns the solo flow, and the lobby never reaches into it.
 * ============================================================================
 */
import { RaceState } from '../types';
import type { Race } from '../game/Race';
import type { NetAdapter } from './NetAdapter';
import type { RaceClient, RoomSummary } from './RaceClient';
import type { MultiplayerSession } from './MultiplayerSession';

const CSS = `
.kr-lobby-toggle {
  position: absolute; top: 18px; right: 18px; z-index: 40;
  pointer-events: auto; cursor: pointer;
  background: rgba(10,14,26,.82); color: #f3f6fb; border: 1px solid rgba(122,162,255,.35);
  border-radius: 10px; padding: 10px 16px; font: 700 13px/1 system-ui, sans-serif;
  letter-spacing: .08em; text-transform: uppercase;
}
.kr-lobby-toggle:hover { border-color: #6ad2ff; }
.kr-lobby {
  position: absolute; inset: 0; z-index: 50; display: grid; place-items: center;
  background: rgba(5,7,13,.72); backdrop-filter: blur(6px);
  pointer-events: auto; font-family: system-ui, sans-serif; color: #f3f6fb;
}
.kr-lobby-panel {
  width: min(560px, 92%); max-height: 84%; overflow: auto;
  background: rgba(12,17,30,.96); border: 1px solid rgba(122,162,255,.25);
  border-radius: 16px; padding: 22px 24px;
}
.kr-lobby h2 { font-size: 20px; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px; }
.kr-lobby .sub { color: #93a4c4; font-size: 12.5px; margin: 0 0 16px; }
.kr-lobby button {
  cursor: pointer; border-radius: 9px; border: 1px solid rgba(122,162,255,.35);
  background: rgba(24,32,54,.9); color: #f3f6fb; padding: 8px 14px;
  font: 600 12.5px/1 system-ui, sans-serif; letter-spacing: .04em;
}
.kr-lobby button:hover:not(:disabled) { border-color: #6ad2ff; }
.kr-lobby button:disabled { opacity: .45; cursor: not-allowed; }
.kr-lobby button.primary { background: linear-gradient(180deg, #ffb85c, #f0a23c); color: #1a1206; border: none; }
.kr-lobby .row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid rgba(122,162,255,.12); }
.kr-lobby .row:last-child { border-bottom: 0; }
.kr-lobby .grow { flex: 1; min-width: 0; }
.kr-lobby .name { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kr-lobby .meta { color: #8fa0c2; font-size: 12px; }
.kr-lobby .actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.kr-lobby .error { color: #ff8d7a; font-size: 12.5px; margin-top: 10px; min-height: 1em; }
.kr-lobby .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
.kr-lobby .dot.ready { background: #4ade5a; }
.kr-lobby .dot.waiting { background: #ffd23f; }
.kr-lobby .dot.offline { background: #6b7590; }
`;

type View =
  | { kind: 'closed' }
  | { kind: 'browse'; rooms: RoomSummary[] }
  | { kind: 'in-room' };

export class LobbyUI {
  private view: View = { kind: 'closed' };
  private readonly root: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private error = '';
  private selfReady = false;
  private readonly toggleTimer: ReturnType<typeof setInterval>;

  constructor(
    host: HTMLElement,
    private readonly race: Race,
    private readonly client: RaceClient,
    private readonly adapter: NetAdapter,
    private readonly session: MultiplayerSession,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    host.appendChild(style);

    this.root = document.createElement('div');
    host.appendChild(this.root);
    this.toggle = document.createElement('button');
    this.toggle.className = 'kr-lobby-toggle';
    this.toggle.textContent = 'Race together';
    this.toggle.addEventListener('click', () => void this.openBrowse());
    host.appendChild(this.toggle);
    this.render();

    // The toggle rides the title screen, and race state changes without any
    // DOM event to hear — so it polls, cheaply and only its own visibility.
    this.toggleTimer = setInterval(() => {
      this.toggle.style.display =
        this.view.kind === 'closed' && this.race.state === RaceState.Menu ? '' : 'none';
    }, 250);
  }

  dispose(): void {
    clearInterval(this.toggleTimer);
    this.root.remove();
    this.toggle.remove();
  }

  /** Re-render on roster/phase pushes from the adapter. */
  refresh(): void {
    if (this.view.kind !== 'closed') this.render();
  }

  // ------------------------------------------------------------- rendering

  private render(): void {
    this.root.innerHTML = '';
    this.toggle.style.display =
      this.view.kind === 'closed' && this.race.state === RaceState.Menu ? '' : 'none';
    if (this.view.kind === 'closed') return;

    const overlay = document.createElement('div');
    overlay.className = 'kr-lobby';
    const panel = document.createElement('div');
    panel.className = 'kr-lobby-panel';
    overlay.appendChild(panel);
    this.root.appendChild(overlay);

    if (this.view.kind === 'browse') this.renderBrowse(panel, this.view.rooms);
    else this.renderInRoom(panel);
  }

  private renderBrowse(panel: HTMLElement, rooms: RoomSummary[]): void {
    this.line(panel, 'h2', '', 'Race together');
    this.line(panel, 'p', 'sub', 'Open rooms in this channel. AI drivers fill empty slots.');

    if (rooms.length === 0) {
      this.line(panel, 'p', 'meta', 'No open rooms right now — host the first one.');
    }
    for (const room of rooms) {
      const row = document.createElement('div');
      row.className = 'row';
      const grow = document.createElement('div');
      grow.className = 'grow';
      this.line(grow, 'div', 'name', `${room.host}'s race`);
      this.line(grow, 'div', 'meta', `${room.players}/${room.maxPlayers} players · ${room.phase}`);
      row.appendChild(grow);
      row.appendChild(this.button('Race', () => void this.join(room.raceId, 'player'), {
        disabled: room.players >= room.maxPlayers || room.phase !== 'lobby',
      }));
      row.appendChild(this.button('Watch', () => void this.join(room.raceId, 'spectator')));
      panel.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(this.button('Host a race', () => void this.host(), { primary: true }));
    actions.appendChild(this.button('Refresh', () => void this.openBrowse()));
    actions.appendChild(this.button('Close', () => this.close()));
    panel.appendChild(actions);
    this.errorLine(panel);
  }

  private renderInRoom(panel: HTMLElement): void {
    this.line(panel, 'h2', '', 'Lobby');
    this.line(panel, 'p', 'sub', 'The host starts when every player is ready.');

    const roster = this.adapter.roster;
    for (const m of roster) {
      const row = document.createElement('div');
      row.className = 'row';
      const dot = document.createElement('span');
      dot.className = `dot ${m.connected ? (m.ready ? 'ready' : 'waiting') : 'offline'}`;
      row.appendChild(dot);
      const grow = document.createElement('div');
      grow.className = 'grow';
      this.line(grow, 'div', 'name', `${m.displayName}${m.host ? ' (host)' : ''}`);
      this.line(grow, 'div', 'meta', m.role === 'spectator' ? 'spectator' : m.connected ? `slot ${(m.slot ?? 0) + 1}` : 'disconnected');
      row.appendChild(grow);
      panel.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const me = this.adapter.self;
    if (me?.role === 'player') {
      actions.appendChild(this.button(this.selfReady ? 'Unready' : 'Ready', () => {
        this.selfReady = !this.selfReady;
        this.adapter.setReady(this.selfReady);
      }, { primary: !this.selfReady }));
      if (this.adapter.isHost) {
        actions.appendChild(this.button('Start race', () => this.adapter.requestStart()));
      }
    }
    actions.appendChild(this.button('Leave', () => this.leaveRoom()));
    panel.appendChild(actions);
    this.errorLine(panel);
  }

  private errorLine(panel: HTMLElement): void {
    const line = this.line(panel, 'p', 'error', this.error);
    line.setAttribute('role', 'alert');
  }

  // ---------------------------------------------------------------- helpers

  private line(parent: HTMLElement, tag: string, cls: string, text: string): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = text;
    parent.appendChild(e);
    return e;
  }

  private button(label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (opts.primary) b.classList.add('primary');
    if (opts.disabled) b.disabled = true;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  // ------------------------------------------------------------------- flow

  private async openBrowse(): Promise<void> {
    this.error = '';
    this.view = { kind: 'browse', rooms: [] };
    this.render();
    try {
      const rooms = await this.client.listRooms();
      this.view = { kind: 'browse', rooms };
    } catch {
      this.error = 'The race server is unreachable — solo play is unaffected.';
      this.view = { kind: 'browse', rooms: [] };
    }
    this.render();
  }

  private async host(): Promise<void> {
    await this.joinAs(() => this.client.createRoom());
  }

  private async join(raceId: string, role: 'player' | 'spectator'): Promise<void> {
    await this.joinAs(() => this.client.joinRoom(raceId, role));
  }

  private async joinAs(join: () => Promise<{ raceId: string; wsUrl: string }>): Promise<void> {
    this.error = '';
    try {
      const joined = await join();
      // Attach BEFORE connecting: the welcome message carries our slot and the
      // roster, and it must reach the adapter, not fall on a null handler.
      this.adapter.attach();
      await this.client.connect(joined.wsUrl);
      this.session.noteJoined(joined.raceId, this.adapter.self?.role ?? 'player');
      this.view = { kind: 'in-room' };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'could not join the race';
    }
    this.render();
  }

  leaveRoom(): void {
    this.selfReady = false;
    this.session.noteLeft();
    this.adapter.detach();
    this.client.close();
    this.view = { kind: 'closed' };
    this.render();
  }

  close(): void {
    this.view = { kind: 'closed' };
    this.render();
  }
}
