/**
 * ============================================================================
 *  MULTIPLAYER SESSION — orchestrates client, adapter and lobby
 * ============================================================================
 *  Owns the whole multiplayer flow for one mounted game: the RaceClient
 *  transport, the NetAdapter that bridges the race director, and the LobbyUI
 *  overlay. Solo play is the default and never depends on this being alive.
 * ============================================================================
 */
import type { Ctx } from '../types';
import { RaceState } from '../types';
import type { Race } from '../game/Race';
import { Items } from '../game/Items';
import { NetAdapter } from './NetAdapter';
import {
  RaceClient,
  fetchRest,
  type RaceIdentity,
  type RaceSocketFactory,
  type RestRequest,
} from './RaceClient';
import { LobbyUI } from './LobbyUI';
import { joinPresence, leavePresence, updatePresence, type KartPresenceState } from '../tap/presence';
import { writeRaceProjection } from '../tap/projection';
import type { TapPackageEventPublisher } from '@theaiplatform/miniapp-sdk/surface';
import type { RacePhase } from '@tap-examples/kart-royale-protocol';

export interface MultiplayerSessionOptions {
  host: HTMLElement;
  /** The game's live context (race + items are wired into the session). */
  ctx: Ctx;
  serverUrl: string;
  identity: RaceIdentity;
  /** Packaged mode passes the host-mediated REST bridge; preview uses fetch. */
  rest?: RestRequest;
  /** Packaged mode asks the trusted host to own the live WebSocket. */
  socketFactory?: RaceSocketFactory;
  /**
   * Packaged mode: TAP presence, durable milestone events, and the MCP
   * read-projection for Chloe. Absent in the browser preview.
   */
  tap?: {
    events?: TapPackageEventPublisher;
  };
}

export class MultiplayerSession {
  readonly client: RaceClient;
  readonly adapter: NetAdapter;
  private readonly lobby: LobbyUI;
  /** The room we're in, so a dropped socket can rejoin with a fresh ticket. */
  private joined: { raceId: string; role: 'player' | 'spectator' } | null = null;
  private deliberateClose = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly race: Race;
  private readonly tapHooks: { events?: TapPackageEventPublisher } | undefined;
  private readonly identity: RaceIdentity;
  /** Session view of the room phase, for presence and the MCP projection. */
  private roomPhase: 'idle' | 'lobby' | 'countdown' | 'running' | 'finished' = 'idle';
  private projectionTimer: ReturnType<typeof setInterval> | null = null;
  private lastProjectionWrite = 0;

  constructor(opts: MultiplayerSessionOptions) {
    const race = opts.ctx.race as Race;
    this.race = race;
    this.tapHooks = opts.tap;
    this.identity = opts.identity;
    this.client = new RaceClient({
      serverUrl: opts.serverUrl,
      identity: opts.identity,
      rest: opts.rest ?? fetchRest(opts.serverUrl),
      socketFactory: opts.socketFactory,
    });
    this.adapter = new NetAdapter(this.client, race, opts.ctx.items as Items, {
      onCountdown: (endsAt) => {
        race.beginNetworkRace(endsAt, this.adapter.serverNow);
        // A live-room welcome reaches the adapter before LobbyUI.joinAs has
        // finished awaiting connect. Hide without cancelling that accepted
        // transport; user-driven Close remains the cancellation path.
        this.lobby.hide();
        this.roomPhase = 'countdown';
        this.writeProjectionSoon();
      },
      onRoster: () => {
        this.lobby.refresh();
        this.pushPresence();
        this.writeProjectionSoon();
      },
      onPeerFinish: () => {},
      onRaceStart: () => {
        this.roomPhase = 'running';
        this.writeProjectionSoon();
        if (!opts.tap?.events || !this.joined) return;
        void opts.tap.events.publish('race.started', {
          raceId: this.joined.raceId,
          players: this.adapter.roster.filter((m) => m.role === 'player').length,
        });
      },
      onRaceResults: (standings) => {
        this.roomPhase = 'finished';
        this.writeProjectionSoon();
        if (!opts.tap?.events || !this.joined) return;
        void opts.tap.events.publish('race.finished', {
          raceId: this.joined.raceId,
          winner: standings[0]?.displayName ?? null,
          players: standings.length,
        });
      },
      onClose: () => this.onSocketClose(),
    });
    this.lobby = new LobbyUI(opts.host, race, this.client, this.adapter, this);
    race.setNetworkLeaveHandler(() => this.leaveFromRaceMenu());
    if (opts.tap) {
      void joinPresence(opts.identity.channelId, this.presenceState());
      // Live standings ride the projection at ~1 Hz while a room is joined.
      this.projectionTimer = setInterval(() => {
        if (this.joined) this.writeProjectionSoon();
      }, 1000);
    }
  }

  private presenceState(): KartPresenceState {
    const self = this.adapter.self;
    return {
      role: self?.role ?? 'idle',
      raceId: this.joined?.raceId ?? null,
      ready: self?.ready ?? false,
      hosting: this.adapter.isHost,
    };
  }

  /** Push the current lobby state to the channel presence room (best effort). */
  private pushPresence(): void {
    if (!this.tapHooks) return;
    if (!this.client.connected && !this.joined) return;
    void updatePresence(this.client.channelRoom, this.presenceState());
  }

  /** Throttled write of the MCP read-projection into TAP storage. */
  private writeProjectionSoon(): void {
    if (!this.tapHooks) return;
    const now = Date.now();
    if (now - this.lastProjectionWrite < 800) return;
    this.lastProjectionWrite = now;
    const standings = this.race.standings.map((k) => ({
      slot: k.id,
      displayName: k.stats.name,
      lap: k.lap,
      place: k.place,
      finished: k.finished,
    }));
    void writeRaceProjection(this.identity.userId, this.identity.channelId, {
      raceId: this.joined?.raceId ?? null,
      phase: this.roomPhase,
      roster: this.adapter.roster,
      standings,
      nowMs: now,
    });
  }

  /** The lobby records the join so a dropped socket can be re-established. */
  noteJoined(raceId: string, role: 'player' | 'spectator', phase: RacePhase = 'lobby'): void {
    if (this.disposed) return;
    this.joined = { raceId, role };
    this.deliberateClose = false;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.roomPhase = phase;
    this.pushPresence();
    this.writeProjectionSoon();
  }

  noteLeft(): void {
    this.deliberateClose = true;
    this.joined = null;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.roomPhase = 'idle';
    this.pushPresence();
    this.writeProjectionSoon();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  get reconnectingNow(): boolean {
    return this.reconnecting;
  }

  /** Race menu actions hand room/transport teardown back to the session. */
  private leaveFromRaceMenu(): void {
    if (this.disposed) return;
    this.lobby.leaveRoom();
  }

  /**
   * An unexpected socket drop: the room holds our slot for the grace period,
   * so re-ticket and reconnect with bounded backoff (1s, 2s, 4s), then give up
   * and hand the room back to the lobby as closed.
   */
  private onSocketClose(): void {
    if (this.disposed) return;
    if (this.deliberateClose || !this.joined || this.reconnecting) {
      if (!this.reconnecting) this.lobby.leaveRoom();
      return;
    }
    if (this.reconnectAttempts >= 3) {
      this.lobby.leaveRoom();
      return;
    }
    this.reconnecting = true;
    const delay = 1000 * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this.disposed || !this.joined || this.deliberateClose) {
      this.reconnecting = false;
      return;
    }
    const expectedRoom = this.joined;
    try {
      const joined = await this.client.joinRoom(expectedRoom.raceId, expectedRoom.role);
      if (this.disposed || this.deliberateClose || this.joined !== expectedRoom) {
        this.reconnecting = false;
        return;
      }
      // attach() is idempotent: handlers re-register against the new socket.
      this.adapter.attach();
      await this.client.connect(joined.wsUrl);
      if (this.disposed || this.deliberateClose || this.joined !== expectedRoom) {
        this.adapter.detach();
        this.client.close();
        this.reconnecting = false;
        return;
      }
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      this.lobby.refresh();
    } catch {
      this.reconnecting = false;
      if (this.disposed || this.deliberateClose) return;
      this.onSocketClose();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deliberateClose = true;
    this.joined = null;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.race.setNetworkLeaveHandler(null);
    if (this.projectionTimer) {
      clearInterval(this.projectionTimer);
      this.projectionTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.adapter.detach();
    this.client.close();
    this.lobby.dispose();
    void leavePresence(this.client.channelRoom);
  }
}

/** True while the menu is up — the only state the lobby toggle shows in. */
export function inMenu(ctx: Ctx): boolean {
  return ctx.race.state === RaceState.Menu;
}
