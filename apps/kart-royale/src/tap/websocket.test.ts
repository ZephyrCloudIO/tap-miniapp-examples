import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  HOST_WEBSOCKET_ACTION_TIMEOUT_MS,
  openHostWebSocket,
} from './websocket';

const DOCUMENT_ID = Symbol.for('zephyrcloudio.miniapp.document-id');
const HOST_ORIGIN = 'https://tap.example.test';
const SOCKET_URL = 'wss://race.example.test/socket?ticket=one';

type FrameListener = (event: MessageEvent<unknown>) => void;

function installFrame() {
  Reflect.set(globalThis, DOCUMENT_ID, 'document-kart-1');
  const listeners = new Set<FrameListener>();
  const requests: Array<{ message: Record<string, unknown>; targetOrigin: string }> = [];
  const parent = {
    postMessage(message: unknown, targetOrigin: string) {
      requests.push({ message: message as Record<string, unknown>, targetOrigin });
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search:
          '?miniappHostOrigin=https%3A%2F%2Ftap.example.test&miniappInstanceId=kart-instance-1',
      },
      parent,
      addEventListener(type: string, listener: FrameListener) {
        if (type === 'message') listeners.add(listener);
      },
      removeEventListener(type: string, listener: FrameListener) {
        if (type === 'message') listeners.delete(listener);
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { referrer: '' },
  });
  return {
    parent,
    requests,
    listenerCount: () => listeners.size,
    dispatch(options: {
      data: Record<string, unknown>;
      origin?: string;
      source?: unknown;
      ports?: MessagePort[];
    }) {
      for (const listener of [...listeners]) {
        listener({
          data: options.data,
          origin: options.origin ?? HOST_ORIGIN,
          source: options.source ?? parent,
          ports: options.ports ?? [],
        } as unknown as MessageEvent<unknown>);
      }
    },
  };
}

function successResult(
  id: unknown,
  port: MessagePort,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    url: SOCKET_URL,
    protocol: '',
    limits: {
      maxMessageBytes: 65_536,
      maxIncomingBytesInFlight: 262_144,
    },
    port,
    ...overrides,
  };
}

function nextPortMessage(port: MessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.addEventListener('message', (event) => resolve(event.data), { once: true });
    port.start();
  });
}

afterEach(() => {
  rstest.useRealTimers();
  rstest.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, DOCUMENT_ID);
});

describe('packaged host WebSocket bridge', () => {
  it('binds the raw action to the exact parent, origin, instance, and document', async () => {
    const frame = installFrame();
    const opening = openHostWebSocket(SOCKET_URL);
    expect(frame.requests).toHaveLength(1);
    const request = frame.requests[0]!.message;
    expect(frame.requests[0]!.targetOrigin).toBe(HOST_ORIGIN);
    expect(request).toMatchObject({
      type: 'tap-miniapp-host-action',
      action: 'tap.platform.websocket.v1.open',
      documentId: 'document-kart-1',
      instanceId: 'kart-instance-1',
      payload: { options: { url: SOCKET_URL, protocols: [] } },
    });

    const forgedChannel = new MessageChannel();
    frame.dispatch({
      origin: 'https://evil.example.test',
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('forged', forgedChannel.port1),
      },
      ports: [forgedChannel.port1],
    });
    frame.dispatch({
      source: {},
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: false,
        error: 'forged denial',
      },
    });

    const channel = new MessageChannel();
    const credit = nextPortMessage(channel.port2);
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-1', channel.port1),
      },
      ports: [channel.port1],
    });
    const socket = await opening;
    expect(socket.readyState).toBe(1);
    await expect(credit).resolves.toEqual({
      type: 'credit',
      sessionId: 'websocket-session-1',
      bytes: 262_144,
    });
    socket.close();
    channel.port2.close();
    forgedChannel.port1.close();
    forgedChannel.port2.close();
  });

  it('rejects an invalid selected protocol and closes its transferred port', async () => {
    const frame = installFrame();
    const channel = new MessageChannel();
    const close = rstest.spyOn(channel.port1, 'close');
    const opening = openHostWebSocket(SOCKET_URL, ['kart-royale.v1']);
    const request = frame.requests[0]!.message;
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-1', channel.port1, {
          protocol: 'forged.v1',
        }),
      },
      ports: [channel.port1],
    });

    await expect(opening).rejects.toThrow(/invalid WebSocket session/u);
    expect(close).toHaveBeenCalled();
    expect(frame.listenerCount()).toBe(0);
    channel.port2.close();
  });

  it('rejects on timeout but closes a matching late transferred port', async () => {
    rstest.useFakeTimers();
    const frame = installFrame();
    const opening = openHostWebSocket(SOCKET_URL);
    const rejection = expect(opening).rejects.toThrow(/timed out/u);
    const request = frame.requests[0]!.message;

    await rstest.advanceTimersByTimeAsync(HOST_WEBSOCKET_ACTION_TIMEOUT_MS);
    await rejection;
    expect(frame.listenerCount()).toBe(1);

    const channel = new MessageChannel();
    const close = rstest.spyOn(channel.port1, 'close');
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-late', channel.port1),
      },
      ports: [channel.port1],
    });
    expect(close).toHaveBeenCalledOnce();
    expect(frame.listenerCount()).toBe(0);
    channel.port2.close();
  });

  it('enforces command/event sequences and replenishes received byte credit', async () => {
    const frame = installFrame();
    const channel = new MessageChannel();
    const initialCredit = nextPortMessage(channel.port2);
    const opening = openHostWebSocket(SOCKET_URL);
    const request = frame.requests[0]!.message;
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-1', channel.port1),
      },
      ports: [channel.port1],
    });
    const socket = await opening;
    await initialCredit;

    const message = new Promise<Record<string, unknown>>((resolve) =>
      socket.addEventListener('message', resolve),
    );
    const replenished = nextPortMessage(channel.port2);
    channel.port2.postMessage({
      type: 'message',
      sessionId: 'websocket-session-1',
      sequence: 1,
      data: 'ready',
    });
    await expect(message).resolves.toEqual({ data: 'ready' });
    await expect(replenished).resolves.toEqual({
      type: 'credit',
      sessionId: 'websocket-session-1',
      bytes: 5,
    });

    const sent = nextPortMessage(channel.port2);
    socket.send('hello');
    const sendCommand = (await sent) as Record<string, unknown>;
    expect(sendCommand).toMatchObject({
      type: 'send',
      sessionId: 'websocket-session-1',
      sequence: 1,
      data: 'hello',
    });
    channel.port2.postMessage({
      type: 'ack',
      sessionId: 'websocket-session-1',
      requestId: sendCommand.requestId,
    });

    const closeCommandPromise = nextPortMessage(channel.port2);
    socket.close();
    const closeCommand = (await closeCommandPromise) as Record<string, unknown>;
    expect(closeCommand).toMatchObject({
      type: 'close',
      sessionId: 'websocket-session-1',
      sequence: 2,
    });
    const closed = new Promise<Record<string, unknown>>((resolve) =>
      socket.addEventListener('close', resolve),
    );
    channel.port2.postMessage({
      type: 'ack',
      sessionId: 'websocket-session-1',
      requestId: closeCommand.requestId,
    });
    channel.port2.postMessage({
      type: 'close',
      sessionId: 'websocket-session-1',
      sequence: 2,
      code: 1000,
      reason: '',
      wasClean: true,
    });
    await expect(closed).resolves.toMatchObject({ code: 1000, wasClean: true });
    expect(socket.readyState).toBe(3);
    channel.port2.close();
  });

  it('isolates throwing listeners from credit, ordered delivery, and close cleanup', async () => {
    const reported = rstest.fn();
    rstest.stubGlobal('reportError', reported);
    const frame = installFrame();
    const channel = new MessageChannel();
    const closePort = rstest.spyOn(channel.port1, 'close');
    const initialCredit = nextPortMessage(channel.port2);
    const opening = openHostWebSocket(SOCKET_URL);
    const request = frame.requests[0]!.message;
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-1', channel.port1),
      },
      ports: [channel.port1],
    });
    const socket = await opening;
    await initialCredit;

    const delivered: string[] = [];
    socket.addEventListener('message', () => {
      throw new Error('consumer message failure');
    });
    socket.addEventListener('message', (event) => {
      delivered.push(String(event.data));
    });

    const firstCredit = nextPortMessage(channel.port2);
    channel.port2.postMessage({
      type: 'message',
      sessionId: 'websocket-session-1',
      sequence: 1,
      data: 'first',
    });
    await expect(firstCredit).resolves.toMatchObject({ type: 'credit', bytes: 5 });

    const secondCredit = nextPortMessage(channel.port2);
    channel.port2.postMessage({
      type: 'message',
      sessionId: 'websocket-session-1',
      sequence: 2,
      data: 'second',
    });
    await expect(secondCredit).resolves.toMatchObject({ type: 'credit', bytes: 6 });
    expect(delivered).toEqual(['first', 'second']);

    const closeObserved = rstest.fn();
    socket.addEventListener('close', () => {
      throw new Error('consumer close failure');
    });
    socket.addEventListener('close', closeObserved);
    channel.port2.postMessage({
      type: 'close',
      sessionId: 'websocket-session-1',
      sequence: 3,
      code: 1000,
      reason: '',
      wasClean: true,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(socket.readyState).toBe(3);
    expect(closePort).toHaveBeenCalledOnce();
    expect(closeObserved).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledTimes(3);
    channel.port2.close();
  });

  it('fails closed when the host skips an event sequence', async () => {
    const frame = installFrame();
    const channel = new MessageChannel();
    const opening = openHostWebSocket(SOCKET_URL);
    const request = frame.requests[0]!.message;
    frame.dispatch({
      data: {
        type: 'tap-miniapp-host-action-response',
        id: request.id,
        ok: true,
        result: successResult('websocket-session-1', channel.port1),
      },
    });
    const socket = await opening;
    const errored = new Promise<Record<string, unknown>>((resolve) =>
      socket.addEventListener('error', resolve),
    );
    const closed = new Promise<Record<string, unknown>>((resolve) =>
      socket.addEventListener('close', resolve),
    );
    channel.port2.postMessage({
      type: 'message',
      sessionId: 'websocket-session-1',
      sequence: 2,
      data: 'out of order',
    });
    await expect(errored).resolves.toMatchObject({ message: expect.stringMatching(/protocol/u) });
    await expect(closed).resolves.toMatchObject({ code: 1006, wasClean: false });
    expect(socket.readyState).toBe(3);
    channel.port2.close();
  });
});
