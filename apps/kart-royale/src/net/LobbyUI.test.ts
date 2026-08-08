import { describe, expect, it, rstest } from '@rstest/core';
import { LobbyUI } from './LobbyUI';
import type { RoomSummary } from './RaceClient';

interface LobbyHarness {
  disposed: boolean;
  error: string;
  joining: boolean;
  operationGeneration: number;
  selfReady: boolean;
  view: { kind: string; rooms?: RoomSummary[] };
  root: { remove(): void };
  toggle: { remove(): void };
  toggleTimer: ReturnType<typeof setInterval>;
  adapter: {
    self: { role: 'player' | 'spectator'; ready: boolean } | null;
    attach(): void;
    detach(): void;
  };
  client: {
    connect(url: string): Promise<Record<string, unknown>>;
    close(): void;
    listRooms(): Promise<RoomSummary[]>;
  };
  session: {
    noteJoined(raceId: string, role: 'player' | 'spectator', phase: string): void;
    noteLeft(): void;
  };
  render(): void;
  close(): void;
  hide(): void;
  dispose(): void;
  refresh(): void;
  openBrowse(): Promise<void>;
  joinAs(join: () => Promise<{ raceId: string; wsUrl: string }>): Promise<void>;
}

function harness(
  connect: LobbyHarness['client']['connect'],
  listRooms: LobbyHarness['client']['listRooms'] = async () => [],
) {
  const calls = {
    attach: rstest.fn(),
    detach: rstest.fn(),
    close: rstest.fn(),
    noteJoined: rstest.fn(),
    noteLeft: rstest.fn(),
    render: rstest.fn(),
  };
  // `joinAs` is intentionally exercised without constructing DOM. Its contract
  // only touches these collaborators and final view state.
  const lobby = Object.create(LobbyUI.prototype) as unknown as LobbyHarness;
  lobby.disposed = false;
  lobby.error = '';
  lobby.joining = false;
  lobby.operationGeneration = 0;
  lobby.selfReady = false;
  lobby.view = { kind: 'browse' };
  lobby.root = { remove: rstest.fn() };
  lobby.toggle = { remove: rstest.fn() };
  lobby.toggleTimer = 0 as unknown as ReturnType<typeof setInterval>;
  lobby.adapter = {
    self: { role: 'spectator', ready: false },
    attach: calls.attach,
    detach: calls.detach,
  };
  lobby.client = { connect, close: calls.close, listRooms };
  lobby.session = {
    noteJoined: calls.noteJoined,
    noteLeft: calls.noteLeft,
  };
  lobby.render = calls.render;
  return { lobby, calls };
}

describe('LobbyUI join lifecycle', () => {
  it('detaches and closes when the WebSocket leg fails', async () => {
    const { lobby, calls } = harness(async () => {
      throw new Error('the race server connection failed');
    });

    await lobby.joinAs(async () => ({ raceId: 'race-1', wsUrl: 'wss://race.test/ws' }));

    expect(calls.attach).toHaveBeenCalledOnce();
    expect(calls.noteLeft).toHaveBeenCalledOnce();
    expect(calls.detach).toHaveBeenCalledOnce();
    expect(calls.close).toHaveBeenCalledOnce();
    expect(calls.noteJoined).not.toHaveBeenCalled();
    expect(lobby.error).toBe('the race server connection failed');
    expect(lobby.view).toEqual({ kind: 'browse' });
  });

  it('closes the lobby when a spectator joins a running room', async () => {
    const { lobby, calls } = harness(async () => ({
      v: 1,
      type: 'welcome',
      userId: 'watcher',
      slot: null,
      phase: 'running',
      roster: [],
      serverTime: 5000,
      countdownEndsAt: null,
    }));

    await lobby.joinAs(async () => ({ raceId: 'race-live', wsUrl: 'wss://race.test/ws' }));

    expect(calls.noteJoined).toHaveBeenCalledWith('race-live', 'spectator', 'running');
    expect(lobby.view).toEqual({ kind: 'closed' });
    expect(calls.detach).not.toHaveBeenCalled();
    expect(calls.close).not.toHaveBeenCalled();
  });

  it('does not attach when disposal wins an in-flight room ticket', async () => {
    let resolveTicket!: (joined: { raceId: string; wsUrl: string }) => void;
    const ticket = new Promise<{ raceId: string; wsUrl: string }>((resolve) => {
      resolveTicket = resolve;
    });
    const { lobby, calls } = harness(async () => ({
      phase: 'lobby',
    }));

    const joining = lobby.joinAs(() => ticket);
    lobby.dispose();
    resolveTicket({ raceId: 'race-late', wsUrl: 'wss://race.test/ws' });
    await joining;

    expect(calls.attach).not.toHaveBeenCalled();
    expect(calls.noteJoined).not.toHaveBeenCalled();
  });

  it('does not publish a late welcome after disposal', async () => {
    let resolveConnect!: (welcome: Record<string, unknown>) => void;
    const connected = new Promise<Record<string, unknown>>((resolve) => {
      resolveConnect = resolve;
    });
    const { lobby, calls } = harness(() => connected);

    const joining = lobby.joinAs(async () => ({
      raceId: 'race-late-welcome',
      wsUrl: 'wss://race.test/ws',
    }));
    await Promise.resolve();
    expect(calls.attach).toHaveBeenCalledOnce();

    lobby.dispose();
    resolveConnect({ phase: 'lobby' });
    await joining;

    expect(calls.noteJoined).not.toHaveBeenCalled();
  });

  it('keeps the newest room list when refresh responses arrive out of order', async () => {
    let resolveFirst!: (rooms: RoomSummary[]) => void;
    const firstRooms = new Promise<RoomSummary[]>((resolve) => {
      resolveFirst = resolve;
    });
    const latestRoom: RoomSummary = {
      raceId: 'race-new',
      host: 'New host',
      phase: 'lobby',
      players: 1,
      maxPlayers: 4,
    };
    let request = 0;
    const { lobby } = harness(
      async () => ({ phase: 'lobby' }),
      () => (++request === 1 ? firstRooms : Promise.resolve([latestRoom])),
    );

    const olderRefresh = lobby.openBrowse();
    await lobby.openBrowse();
    resolveFirst([{
      raceId: 'race-old',
      host: 'Old host',
      phase: 'lobby',
      players: 1,
      maxPlayers: 4,
    }]);
    await olderRefresh;

    expect(lobby.view).toEqual({ kind: 'browse', rooms: [latestRoom] });
  });

  it('resets the ready toggle from the server roster after reconnect', () => {
    const { lobby, calls } = harness(async () => ({ phase: 'lobby' }));
    lobby.view = { kind: 'in-room' };
    lobby.selfReady = true;
    lobby.adapter.self = { role: 'player', ready: false };

    lobby.refresh();

    expect(lobby.selfReady).toBe(false);
    expect(calls.render).toHaveBeenCalledOnce();
  });

  it('does not reopen browse when a room list returns after close', async () => {
    let resolveRooms!: (rooms: RoomSummary[]) => void;
    const rooms = new Promise<RoomSummary[]>((resolve) => {
      resolveRooms = resolve;
    });
    const { lobby } = harness(async () => ({ phase: 'lobby' }), () => rooms);

    const browsing = lobby.openBrowse();
    lobby.close();
    resolveRooms([{
      raceId: 'race-late-list',
      host: 'Late host',
      phase: 'lobby',
      players: 1,
      maxPlayers: 4,
    }]);
    await browsing;

    expect(lobby.view).toEqual({ kind: 'closed' });
  });

  it('keeps an accepted live-room join when the countdown hides the lobby', async () => {
    let lobby!: LobbyHarness;
    const joined = harness(async () => {
      // NetAdapter delivers the welcome to MultiplayerSession.onCountdown
      // before RaceClient.connect resolves back into LobbyUI.joinAs.
      lobby.hide();
      return { phase: 'countdown' };
    });
    lobby = joined.lobby;

    await lobby.joinAs(async () => ({
      raceId: 'race-live-countdown',
      wsUrl: 'wss://race.test/ws',
    }));

    expect(joined.calls.noteJoined).toHaveBeenCalledWith(
      'race-live-countdown',
      'spectator',
      'countdown',
    );
    expect(joined.calls.noteLeft).not.toHaveBeenCalled();
    expect(joined.calls.detach).not.toHaveBeenCalled();
    expect(joined.calls.close).not.toHaveBeenCalled();
    expect(lobby.view).toEqual({ kind: 'closed' });
  });
});
