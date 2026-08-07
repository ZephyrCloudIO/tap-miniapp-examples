import { afterEach, beforeEach, describe, expect, it, rstest } from '@rstest/core';
import {
  RaceClient,
  WELCOME_TIMEOUT_MS,
  type RaceSocketFactory,
} from './RaceClient';

type SocketListener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<SocketListener>>();
  readyState = FakeWebSocket.CONNECTING;
  closeCalls = 0;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = FakeWebSocket.CLOSING;
  }

  welcome(overrides: Record<string, unknown> = {}): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('message', {
      data: JSON.stringify({
        v: 1,
        type: 'welcome',
        userId: 'pilot-1',
        slot: 0,
        phase: 'lobby',
        roster: [],
        serverTime: Date.now(),
        countdownEndsAt: null,
        ...overrides,
      }),
    });
  }

  serverError(): void {
    this.emit('error', {});
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  serverMessage(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function client(socketFactory?: RaceSocketFactory): RaceClient {
  return new RaceClient({
    serverUrl: 'https://race.test',
    identity: {
      userId: 'pilot-1',
      channelId: 'channel-1',
      displayName: 'Pilot One',
    },
    rest: async () => ({ status: 200, body: {} }),
    socketFactory,
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  rstest.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  rstest.useRealTimers();
  rstest.unstubAllGlobals();
});

describe('RaceClient welcome handshake', () => {
  it('waits for an asynchronous host socket before handling welcome', async () => {
    let resolveSocket: ((socket: FakeWebSocket) => void) | null = null;
    const socketPromise = new Promise<FakeWebSocket>((resolve) => {
      resolveSocket = resolve;
    });
    const raceClient = client(() => socketPromise);
    const connecting = raceClient.connect('wss://race.test/ws');
    const socket = new FakeWebSocket('wss://race.test/ws');

    resolveSocket?.(socket);
    await Promise.resolve();
    socket.welcome();

    await expect(connecting).resolves.toMatchObject({ type: 'welcome' });
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'hello' });
    raceClient.close();
  });

  it('rejects when an asynchronous host socket cannot be opened', async () => {
    const raceClient = client(() => Promise.reject(new Error('permission denied')));

    await expect(raceClient.connect('wss://race.test/ws')).rejects.toThrow(
      'connection failed',
    );
    expect(raceClient.connected).toBe(false);
  });

  it('resolves with welcome and sends hello', async () => {
    const raceClient = client();
    const received = rstest.fn();
    raceClient.onMessage = received;
    const connecting = raceClient.connect('wss://race.test/ws');
    const socket = FakeWebSocket.instances[0]!;

    socket.welcome();
    const welcome = await connecting;

    expect(welcome).toMatchObject({ type: 'welcome', userId: 'pilot-1', phase: 'lobby' });
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      v: 1,
      type: 'hello',
      displayName: 'Pilot One',
      role: 'player',
    });
    expect(received).toHaveBeenCalledOnce();
    expect(raceClient.connected).toBe(true);
    raceClient.close();
  });

  it('rejects when the socket closes before welcome', async () => {
    const raceClient = client();
    const connecting = raceClient.connect('wss://race.test/ws');
    const rejection = expect(connecting).rejects.toThrow('closed before it was ready');

    FakeWebSocket.instances[0]!.serverClose();

    await rejection;
    expect(raceClient.connected).toBe(false);
  });

  it('rejects and closes when the socket errors before welcome', async () => {
    const raceClient = client();
    const connecting = raceClient.connect('wss://race.test/ws');
    const socket = FakeWebSocket.instances[0]!;
    const rejection = expect(connecting).rejects.toThrow('connection failed');

    socket.serverError();

    await rejection;
    expect(socket.closeCalls).toBe(1);
    expect(raceClient.connected).toBe(false);
  });

  it('surfaces a server refusal received before welcome', async () => {
    const raceClient = client();
    const connecting = raceClient.connect('wss://race.test/ws');
    const socket = FakeWebSocket.instances[0]!;
    const rejection = expect(connecting).rejects.toThrow('All player slots are taken');

    socket.serverMessage({
      v: 1,
      type: 'error',
      code: 'room_full',
      message: 'All player slots are taken',
    });

    await rejection;
    expect(socket.closeCalls).toBe(1);
  });

  it('times out a socket that never sends welcome', async () => {
    rstest.useFakeTimers();
    const raceClient = client();
    const connecting = raceClient.connect('wss://race.test/ws');
    const socket = FakeWebSocket.instances[0]!;
    const rejection = expect(connecting).rejects.toThrow('did not become ready in time');

    await rstest.advanceTimersByTimeAsync(WELCOME_TIMEOUT_MS);

    await rejection;
    expect(socket.closeCalls).toBe(1);
    expect(raceClient.connected).toBe(false);
  });
});
