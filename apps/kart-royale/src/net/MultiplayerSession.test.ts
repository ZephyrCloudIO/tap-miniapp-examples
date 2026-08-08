import { describe, expect, it, rstest } from '@rstest/core';
import { MultiplayerSession } from './MultiplayerSession';

describe('MultiplayerSession disposal', () => {
  it('owns room teardown requested by a race-menu title action', () => {
    const lobby = { leaveRoom: rstest.fn() };
    const session = Object.create(MultiplayerSession.prototype) as unknown as {
      disposed: boolean;
      lobby: typeof lobby;
      leaveFromRaceMenu(): void;
    };
    session.disposed = false;
    session.lobby = lobby;

    session.leaveFromRaceMenu();

    expect(lobby.leaveRoom).toHaveBeenCalledOnce();
  });

  it('does not reattach an in-flight reconnect after disposal', async () => {
    let resolveTicket!: (joined: { raceId: string; wsUrl: string }) => void;
    const ticket = new Promise<{ raceId: string; wsUrl: string }>((resolve) => {
      resolveTicket = resolve;
    });
    const adapter = {
      attach: rstest.fn(),
      detach: rstest.fn(),
    };
    const client = {
      channelRoom: 'channel-1',
      joinRoom: rstest.fn(() => ticket),
      connect: rstest.fn(async () => undefined),
      close: rstest.fn(),
    };
    const lobby = {
      refresh: rstest.fn(),
      dispose: rstest.fn(),
    };
    const race = {
      setNetworkLeaveHandler: rstest.fn(),
    };

    // Exercise the lifecycle directly without constructing the WebGL game or
    // lobby DOM; these are the complete collaborators touched by this path.
    const session = Object.create(MultiplayerSession.prototype) as unknown as {
      joined: { raceId: string; role: 'player' | 'spectator' } | null;
      deliberateClose: boolean;
      reconnecting: boolean;
      reconnectAttempts: number;
      reconnectTimer: ReturnType<typeof setTimeout> | null;
      projectionTimer: ReturnType<typeof setInterval> | null;
      disposed: boolean;
      adapter: typeof adapter;
      client: typeof client;
      lobby: typeof lobby;
      race: typeof race;
      attemptReconnect(): Promise<void>;
      dispose(): void;
    };
    session.joined = { raceId: 'race-1', role: 'player' };
    session.deliberateClose = false;
    session.reconnecting = true;
    session.reconnectAttempts = 1;
    session.reconnectTimer = null;
    session.projectionTimer = null;
    session.disposed = false;
    session.adapter = adapter;
    session.client = client;
    session.lobby = lobby;
    session.race = race;

    const reconnect = session.attemptReconnect();
    expect(client.joinRoom).toHaveBeenCalledOnce();

    session.dispose();
    resolveTicket({ raceId: 'race-1', wsUrl: 'wss://race.test/ws' });
    await reconnect;

    expect(adapter.attach).not.toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledOnce();
    expect(adapter.detach).toHaveBeenCalledOnce();
    expect(race.setNetworkLeaveHandler).toHaveBeenCalledWith(null);
    expect(session.joined).toBeNull();
    expect(session.reconnecting).toBe(false);
  });
});
