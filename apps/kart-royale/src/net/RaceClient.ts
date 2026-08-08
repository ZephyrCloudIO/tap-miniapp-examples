/**
 * ============================================================================
 *  RACE CLIENT — transport for the session server
 * ============================================================================
 *  REST for room lifecycle (create/join/list), then a ticket-authenticated
 *  WebSocket for the live race. REST goes through an injectable request
 *  function: direct `fetch` in the browser preview, host-mediated
 *  `tap.http.request` (with the platform-session credential) when packaged.
 * ============================================================================
 */
import type {
  ClientMessage,
  ServerMessage,
  ServerWelcome,
} from '@tap-examples/kart-royale-protocol';
import { PROTOCOL_VERSION } from '@tap-examples/kart-royale-protocol';

/** Includes the bounded host-owned socket open plus the room's welcome. */
export const WELCOME_TIMEOUT_MS = 15_000;

export interface RestResponse {
  status: number;
  body: unknown;
}

export type RestRequest = (path: string, init: { method: string; body?: unknown }) => Promise<RestResponse>;

export interface RaceIdentity {
  userId: string;
  channelId: string;
  displayName: string;
}

export interface RoomSummary {
  raceId: string;
  host: string;
  phase: string;
  players: number;
  maxPlayers: number;
}

export interface JoinedRoom {
  raceId: string;
  wsUrl: string;
}

/** The small socket surface shared by native and host-mediated transports. */
export type RaceSocketListener = (event: Record<string, unknown>) => void;

export interface RaceSocket {
  readonly readyState: number;
  addEventListener(type: string, listener: RaceSocketListener): void;
  removeEventListener(type: string, listener: RaceSocketListener): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** A packaged socket opens asynchronously after the host authorization hop. */
export type RaceSocketFactory = (
  url: string,
) => RaceSocket | Promise<RaceSocket>;

const nativeSocketFactory: RaceSocketFactory = (url) =>
  new WebSocket(url) as unknown as RaceSocket;

/** The default REST transport for the browser preview (dev CORS is open). */
export const fetchRest =
  (serverUrl: string): RestRequest =>
  async (path, init) => {
    const res = await fetch(`${serverUrl}${path}`, {
      method: init.method,
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

export class RaceClient {
  onMessage: ((message: ServerMessage) => void) | null = null;
  onClose: (() => void) | null = null;

  private ws: RaceSocket | null = null;
  /** Rejects an in-flight pre-welcome handshake when close() is deliberate. */
  private cancelConnect: (() => void) | null = null;
  /** Removes listeners/timers from the current socket on replacement or close. */
  private teardownSocket: (() => void) | null = null;
  private offsetMs = 0;
  private role: 'player' | 'spectator' = 'player';

  constructor(
    private readonly options: {
      serverUrl: string;
      identity: RaceIdentity;
      rest: RestRequest;
      socketFactory?: RaceSocketFactory;
    },
  ) {}

  /** Best estimate of the server's wall clock, from the welcome handshake. */
  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  /** The channel this client's identity belongs to (the presence room). */
  get channelRoom(): string {
    return this.options.identity.channelId;
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  async listRooms(): Promise<RoomSummary[]> {
    const res = await this.options.rest(`/channels/${encodeURIComponent(this.options.identity.channelId)}/rooms`, {
      method: 'GET',
    });
    if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) return [];
    const rooms = (res.body as { rooms?: RoomSummary[] }).rooms;
    return Array.isArray(rooms) ? rooms : [];
  }

  async createRoom(): Promise<JoinedRoom> {
    return this.joinRequest('/rooms', { role: 'player' });
  }

  async joinRoom(raceId: string, role: 'player' | 'spectator'): Promise<JoinedRoom> {
    return this.joinRequest(`/rooms/${encodeURIComponent(raceId)}/tickets`, { role });
  }

  private async joinRequest(path: string, extra: Record<string, unknown>): Promise<JoinedRoom> {
    const res = await this.options.rest(path, {
      method: 'POST',
      body: { ...this.options.identity, ...extra },
    });
    if (res.status !== 200 || typeof res.body !== 'object' || res.body === null) {
      const message = (res.body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
      throw new Error(`could not join the race: ${message}`);
    }
    const body = res.body as { raceId?: unknown; wsUrl?: unknown };
    if (typeof body.raceId !== 'string' || typeof body.wsUrl !== 'string') {
      throw new Error('could not join the race: malformed response');
    }
    if (extra.role === 'spectator') this.role = 'spectator';
    return { raceId: body.raceId, wsUrl: body.wsUrl };
  }

  /** Open the race socket; resolves once the room's welcome lands. */
  connect(wsUrl: string): Promise<ServerWelcome> {
    this.close();
    return new Promise((resolve, reject) => {
      let ws: RaceSocket | null = null;
      let welcomed = false;
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const clearTimeoutOnly = () => {
        if (timeout === null) return;
        clearTimeout(timeout);
        timeout = null;
      };
      const cleanup = () => {
        clearTimeoutOnly();
        ws?.removeEventListener('error', onError);
        ws?.removeEventListener('message', onMessage);
        ws?.removeEventListener('close', onClose);
        if (this.teardownSocket === cleanup) this.teardownSocket = null;
      };
      const failBeforeWelcome = (message: string, closeSocket = true) => {
        if (settled) return;
        settled = true;
        if (this.cancelConnect === cancelConnect) this.cancelConnect = null;
        if (ws && this.ws === ws) this.ws = null;
        cleanup();
        if (closeSocket && ws) {
          try {
            ws.close();
          } catch {
            /* the failed socket is already gone */
          }
        }
        reject(new Error(message));
      };
      const cancelConnect = () => {
        failBeforeWelcome('the race server connection closed before it was ready');
      };
      const onError = () => {
        failBeforeWelcome('the race server connection failed');
      };
      const onMessage = (event: Record<string, unknown>) => {
        const msg = this.parse(event.data);
        if (!msg) return;
        if (!welcomed && msg.type === 'error') {
          failBeforeWelcome(`the race server refused the connection: ${msg.message}`);
          return;
        }
        if (!welcomed && msg.type === 'welcome') {
          welcomed = true;
          settled = true;
          if (this.cancelConnect === cancelConnect) this.cancelConnect = null;
          this.offsetMs = msg.serverTime - Date.now();
          clearTimeoutOnly();
          ws.removeEventListener('error', onError);
          this.send({ v: PROTOCOL_VERSION, type: 'hello', displayName: this.options.identity.displayName, role: this.role });
          resolve(msg);
        }
        this.onMessage?.(msg);
      };
      const onClose = () => {
        const wasCurrent = this.ws === ws;
        if (wasCurrent) this.ws = null;
        if (!welcomed) {
          failBeforeWelcome('the race server connection closed before it was ready', false);
          return;
        }
        cleanup();
        if (wasCurrent) this.onClose?.();
      };
      this.cancelConnect = cancelConnect;
      this.teardownSocket = cleanup;
      timeout = setTimeout(() => {
        failBeforeWelcome('the race server did not become ready in time');
      }, WELCOME_TIMEOUT_MS);

      const attach = (opened: RaceSocket) => {
        if (
          !opened ||
          typeof opened.readyState !== 'number' ||
          typeof opened.addEventListener !== 'function' ||
          typeof opened.removeEventListener !== 'function' ||
          typeof opened.send !== 'function' ||
          typeof opened.close !== 'function'
        ) {
          failOpen();
          return;
        }
        if (settled || this.cancelConnect !== cancelConnect) {
          try {
            opened.close();
          } catch {
            /* a cancelled asynchronous open is already gone */
          }
          return;
        }
        ws = opened;
        this.ws = opened;
        opened.addEventListener('error', onError);
        opened.addEventListener('message', onMessage);
        opened.addEventListener('close', onClose);
      };
      const failOpen = () => {
        failBeforeWelcome('the race server connection failed', false);
      };
      try {
        const opening = (this.options.socketFactory ?? nativeSocketFactory)(wsUrl);
        if (
          typeof opening === 'object' &&
          opening !== null &&
          typeof (opening as PromiseLike<RaceSocket>).then === 'function'
        ) {
          Promise.resolve(opening).then(attach).catch(failOpen);
        } else {
          attach(opening as RaceSocket);
        }
      } catch {
        failOpen();
      }
    });
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    const cancel = this.cancelConnect;
    this.cancelConnect = null;
    cancel?.();
    const ws = this.ws;
    this.ws = null;
    const teardown = this.teardownSocket;
    this.teardownSocket = null;
    teardown?.();
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }

  private parse(data: unknown): ServerMessage | null {
    if (typeof data !== 'string') return null;
    try {
      const msg = JSON.parse(data) as ServerMessage;
      return msg && typeof msg === 'object' && (msg as { v?: unknown }).v === PROTOCOL_VERSION ? msg : null;
    } catch {
      return null;
    }
  }
}
