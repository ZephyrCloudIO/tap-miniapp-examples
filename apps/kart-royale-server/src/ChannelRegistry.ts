/**
 * ============================================================================
 *  CHANNEL REGISTRY (Durable Object)
 * ============================================================================
 *  One instance per channel id, holding the channel's open race rooms so
 *  members can discover games without out-of-band signalling — the same slot
 *  the TAP channel index fills in packaged mode. Entries are written by the
 *  Worker at room creation and kept current by the RaceRoom as it changes
 *  phase; stale entries are swept lazily on read.
 * ============================================================================
 */
import { DurableObject } from 'cloudflare:workers';

export interface RoomEntry {
  raceId: string;
  host: string;
  phase: string;
  players: number;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
}

/** Rooms vanish from the listing after this long without an update. */
const STALE_MS = 2 * 60 * 60 * 1000;

export class ChannelRegistry extends DurableObject<Env> {
  private rooms = new Map<string, RoomEntry>();
  private hydrated = false;

  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const stored = await this.ctx.storage.get<RoomEntry[]>('rooms');
    if (stored) this.rooms = new Map(stored.map((r) => [r.raceId, r]));
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('rooms', [...this.rooms.values()]);
  }

  override async fetch(request: Request): Promise<Response> {
    await this.hydrate();
    const url = new URL(request.url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });

    if (url.pathname === '/list' && request.method === 'GET') {
      const now = Date.now();
      let swept = false;
      for (const [id, room] of this.rooms) {
        if (now - room.updatedAt > STALE_MS) {
          this.rooms.delete(id);
          swept = true;
        }
      }
      if (swept) await this.persist();
      const rooms = [...this.rooms.values()]
        .filter((r) => r.phase !== 'finished')
        .sort((a, b) => b.createdAt - a.createdAt);
      return json({ rooms });
    }

    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== 'object' || body === null) return json({ error: 'expected JSON object' }, 400);
    const record = body as Partial<RoomEntry> & { raceId?: unknown };

    if (url.pathname === '/register' && request.method === 'POST') {
      if (typeof record.raceId !== 'string' || !record.raceId) return json({ error: 'raceId required' }, 400);
      this.rooms.set(record.raceId, {
        raceId: record.raceId,
        host: typeof record.host === 'string' ? record.host : 'unknown',
        phase: 'lobby',
        players: 0,
        maxPlayers: Number(this.env.MAX_PLAYERS) || 8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await this.persist();
      return json({ ok: true });
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      if (typeof record.raceId !== 'string') return json({ error: 'raceId required' }, 400);
      const room = this.rooms.get(record.raceId);
      if (!room) return json({ error: 'unknown room' }, 404);
      if (typeof record.phase === 'string') room.phase = record.phase;
      if (typeof record.players === 'number' && Number.isFinite(record.players)) {
        room.players = Math.max(0, Math.min(64, record.players));
      }
      room.updatedAt = Date.now();
      await this.persist();
      return json({ ok: true });
    }

    if (url.pathname === '/remove' && request.method === 'POST') {
      if (typeof record.raceId !== 'string') return json({ error: 'raceId required' }, 400);
      this.rooms.delete(record.raceId);
      await this.persist();
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
  }
}
