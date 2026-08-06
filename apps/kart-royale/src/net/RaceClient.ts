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
} from '@tap-examples/kart-royale-server/protocol';
import { PROTOCOL_VERSION } from '@tap-examples/kart-royale-server/protocol';

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

  private ws: WebSocket | null = null;
  private offsetMs = 0;
  private role: 'player' | 'spectator' = 'player';

  constructor(
    private readonly options: {
      serverUrl: string;
      identity: RaceIdentity;
      rest: RestRequest;
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
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
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
  connect(wsUrl: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      const onError = () => {
        cleanup();
        reject(new Error('the race server connection failed'));
      };
      const onMessage = (event: MessageEvent) => {
        const msg = this.parse(event.data);
        if (!msg) return;
        if (msg.type === 'welcome') {
          this.offsetMs = msg.serverTime - Date.now();
          cleanup();
          this.send({ v: PROTOCOL_VERSION, type: 'hello', displayName: this.options.identity.displayName, role: this.role });
          resolve();
        }
        this.onMessage?.(msg);
      };
      const onClose = () => {
        if (this.ws === ws) this.ws = null;
        this.onClose?.();
      };
      const cleanup = () => {
        ws.removeEventListener('error', onError);
      };
      ws.addEventListener('error', onError);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose);
    });
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    if (!this.ws) return;
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
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
