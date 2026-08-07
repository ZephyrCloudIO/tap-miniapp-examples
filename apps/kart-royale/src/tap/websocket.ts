/**
 * Host-mediated text WebSocket used by the packaged surface.
 *
 * Packaged assets cannot open arbitrary sockets under their CSP. The trusted
 * parent owns the browser WebSocket and transfers this frame a bounded
 * MessagePort after the normal TAP action/effect checks have succeeded.
 */
import type { RaceSocket, RaceSocketFactory, RaceSocketListener } from '../net/RaceClient';

const HOST_ACTION_REQUEST = 'tap-miniapp-host-action';
const HOST_ACTION_RESPONSE = 'tap-miniapp-host-action-response';
const OPEN_WEBSOCKET_ACTION = 'tap.platform.websocket.v1.open';
const MINIAPP_DOCUMENT_ID_GLOBAL_KEY = 'zephyrcloudio.miniapp.document-id';
const MAX_FRAME_ID_CHARS = 256;
const MAX_SESSION_ID_CHARS = 512;
const MAX_ERROR_CHARS = 1_024;
const MAX_CLOSE_REASON_BYTES = 123;
const EXPECTED_MAX_MESSAGE_BYTES = 65_536;
const EXPECTED_MAX_INCOMING_BYTES_IN_FLIGHT = 262_144;

// The host bounds native WebSocket opening at 10 seconds. Keep the action
// envelope slightly longer, while RaceClient's end-to-end welcome bound is
// longer still, so timeout ownership is deterministic and no late live socket
// can outlast a caller that already failed.
export const HOST_WEBSOCKET_ACTION_TIMEOUT_MS = 12_000;
export const HOST_WEBSOCKET_LATE_RESPONSE_GRACE_MS = 15_000;

let hostActionSequence = 0;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function exactOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === 'null' || url.username || url.password ? null : url.origin;
  } catch {
    return null;
  }
}

function getHostOrigin(): string | null {
  const params = new URLSearchParams(window.location.search);
  return (
    exactOrigin(params.get('hostOrigin')) ??
    exactOrigin(params.get('miniappHostOrigin')) ??
    exactOrigin(typeof document === 'undefined' ? '' : document.referrer)
  );
}

function getFrameInstanceId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const instanceId =
    params.get('miniappInstanceId') ??
    params.get('instanceId') ??
    params.get('miniappFrameId');
  return isBoundedString(instanceId, MAX_FRAME_ID_CHARS) ? instanceId : null;
}

function getDocumentId(): string {
  const documentId = Reflect.get(
    globalThis,
    Symbol.for(MINIAPP_DOCUMENT_ID_GLOBAL_KEY),
  );
  if (!isBoundedString(documentId, MAX_FRAME_ID_CHARS)) {
    throw new Error('The miniapp document identity is unavailable.');
  }
  return documentId;
}

function createActionId(): string {
  hostActionSequence += 1;
  return `tap-websocket-open-${hostActionSequence}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function closePort(value: unknown): void {
  if (!value || typeof (value as { close?: unknown }).close !== 'function') return;
  try {
    (value as { close(): void }).close();
  } catch {
    /* the transferred endpoint was already closed */
  }
}

function closeResponsePorts(event: MessageEvent<unknown>): void {
  const ports = new Set<unknown>(event.ports ?? []);
  if (isRecord(event.data) && isRecord(event.data.result)) {
    ports.add(event.data.result.port);
  }
  for (const port of ports) closePort(port);
}

function hostActionError(value: UnknownRecord): Error {
  return new Error(
    isBoundedString(value.error, MAX_ERROR_CHARS)
      ? value.error
      : 'The miniapp host WebSocket action failed.',
  );
}

/** Match browser EventTarget: report a listener exception without aborting dispatch. */
function reportListenerError(error: unknown): void {
  const reportError = Reflect.get(globalThis, 'reportError');
  if (typeof reportError !== 'function') return;
  try {
    Reflect.apply(reportError, globalThis, [error]);
  } catch {
    /* reporting must never break socket flow control or teardown */
  }
}

interface OpenResult {
  id: string;
  url: string;
  protocol: string;
  limits: {
    maxMessageBytes: number;
    maxIncomingBytesInFlight: number;
  };
  port: MessagePort;
}

function checkedOpenResult(
  value: unknown,
  requestedUrl: string,
  requestedProtocols: readonly string[],
): OpenResult {
  const invalid = () => {
    throw new Error('The miniapp host returned an invalid WebSocket session.');
  };
  if (
    !isRecord(value) ||
    !exactKeys(value, ['id', 'url', 'protocol', 'limits', 'port']) ||
    !isBoundedString(value.id, MAX_SESSION_ID_CHARS) ||
    value.url !== requestedUrl ||
    typeof value.protocol !== 'string' ||
    (value.protocol !== '' && !requestedProtocols.includes(value.protocol)) ||
    !isRecord(value.limits) ||
    !exactKeys(value.limits, ['maxMessageBytes', 'maxIncomingBytesInFlight']) ||
    value.limits.maxMessageBytes !== EXPECTED_MAX_MESSAGE_BYTES ||
    value.limits.maxIncomingBytesInFlight !== EXPECTED_MAX_INCOMING_BYTES_IN_FLIGHT ||
    typeof MessagePort !== 'function' ||
    !(value.port instanceof MessagePort)
  ) {
    return invalid();
  }
  return value as unknown as OpenResult;
}

function normalizeRequest(urlValue: string, protocolsValue: readonly string[]): {
  url: string;
  protocols: string[];
} {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error('The race WebSocket URL is invalid.');
  }
  const isSecure = url.protocol === 'wss:';
  const isLoopbackDevelopment =
    url.protocol === 'ws:' && url.hostname === '127.0.0.1' && url.port.length > 0;
  if (
    (!isSecure && !isLoopbackDevelopment) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== urlValue
  ) {
    throw new Error('The race WebSocket URL is not canonical or allowed.');
  }
  const protocols = [...protocolsValue];
  if (
    protocols.length > 16 ||
    protocols.some(
      (protocol, index) =>
        typeof protocol !== 'string' ||
        protocol.length === 0 ||
        protocol.length > 128 ||
        !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(protocol) ||
        protocols.indexOf(protocol) !== index,
    )
  ) {
    throw new Error('The race WebSocket protocols are invalid.');
  }
  return { url: url.href, protocols };
}

function requestOpenResult(url: string, protocols: readonly string[]): Promise<OpenResult> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('The miniapp host is unavailable.'));
  }
  const hostOrigin = getHostOrigin();
  if (!hostOrigin) {
    return Promise.reject(new Error('The miniapp host origin is unavailable.'));
  }
  const instanceId = getFrameInstanceId();
  if (!instanceId) {
    return Promise.reject(new Error('The miniapp frame identity is unavailable.'));
  }
  let documentId: string;
  try {
    documentId = getDocumentId();
  } catch (error) {
    return Promise.reject(error);
  }
  const parent = window.parent;
  if (!parent || parent === window) {
    return Promise.reject(new Error('The miniapp host is unavailable.'));
  }

  const id = createActionId();
  return new Promise((resolve, reject) => {
    let settled = false;
    let lateResponseTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (lateResponseTimer !== null) clearTimeout(lateResponseTimer);
      window.removeEventListener('message', handleMessage);
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== parent || event.origin !== hostOrigin || !isRecord(event.data)) return;
      if (event.data.type !== HOST_ACTION_RESPONSE || event.data.id !== id) return;

      if (settled) {
        closeResponsePorts(event);
        cleanup();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      cleanup();
      if (typeof event.data.ok !== 'boolean') {
        closeResponsePorts(event);
        reject(new Error('The miniapp host returned an invalid WebSocket response.'));
        return;
      }
      if (!event.data.ok) {
        closeResponsePorts(event);
        reject(hostActionError(event.data));
        return;
      }
      try {
        resolve(checkedOpenResult(event.data.result, url, protocols));
      } catch (error) {
        closeResponsePorts(event);
        reject(error);
      }
    };
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('The miniapp host WebSocket action timed out.'));
      // Keep one bounded compensating listener so a response posted after the
      // caller has timed out cannot strand its transferred MessagePort.
      lateResponseTimer = setTimeout(cleanup, HOST_WEBSOCKET_LATE_RESPONSE_GRACE_MS);
    }, HOST_WEBSOCKET_ACTION_TIMEOUT_MS);

    window.addEventListener('message', handleMessage);
    try {
      parent.postMessage(
        {
          type: HOST_ACTION_REQUEST,
          id,
          action: OPEN_WEBSOCKET_ACTION,
          documentId,
          instanceId,
          payload: { options: { url, protocols: [...protocols] } },
        },
        hostOrigin,
      );
    } catch (error) {
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(error);
    }
  });
}

class HostPortSocket implements RaceSocket {
  readonly url: string;
  readonly protocol: string;
  readyState = 1;

  private readonly listeners = new Map<string, Set<RaceSocketListener>>();
  private readonly pendingRequests = new Set<string>();
  private commandSequence = 0;
  private requestSequence = 0;
  private expectedEventSequence = 1;
  private incomingCredit: number;

  constructor(private readonly opened: OpenResult) {
    this.url = opened.url;
    this.protocol = opened.protocol;
    this.incomingCredit = opened.limits.maxIncomingBytesInFlight;
    opened.port.onmessage = (event) => this.receive(event.data);
    opened.port.onmessageerror = () => this.protocolFailure();
    opened.port.start();
    opened.port.postMessage({
      type: 'credit',
      sessionId: opened.id,
      bytes: this.incomingCredit,
    });
  }

  addEventListener(type: string, listener: RaceSocketListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: RaceSocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('The race WebSocket is not open.');
    if (typeof data !== 'string' || new TextEncoder().encode(data).byteLength > this.opened.limits.maxMessageBytes) {
      throw new Error('The race WebSocket message exceeds the allowed size.');
    }
    const identity = this.nextCommand('send');
    this.opened.port.postMessage({
      type: 'send',
      sessionId: this.opened.id,
      ...identity,
      data,
    });
  }

  close(code?: number, reason?: string): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const identity = this.nextCommand('close');
    this.opened.port.postMessage({
      type: 'close',
      sessionId: this.opened.id,
      ...identity,
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  private nextCommand(kind: string): { requestId: string; sequence: number } {
    if (
      this.commandSequence >= Number.MAX_SAFE_INTEGER ||
      this.requestSequence >= Number.MAX_SAFE_INTEGER ||
      this.pendingRequests.size >= 128
    ) {
      this.protocolFailure();
      throw new Error('The race WebSocket command limit was exceeded.');
    }
    this.commandSequence += 1;
    this.requestSequence += 1;
    const requestId = `kart-websocket-${kind}-${this.requestSequence}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    this.pendingRequests.add(requestId);
    return { requestId, sequence: this.commandSequence };
  }

  private receive(value: unknown): void {
    if (this.readyState === 3 || !isRecord(value) || value.sessionId !== this.opened.id) {
      this.protocolFailure();
      return;
    }
    if (value.type === 'ack') {
      if (
        !exactKeys(value, ['type', 'sessionId', 'requestId']) ||
        typeof value.requestId !== 'string' ||
        !this.pendingRequests.delete(value.requestId)
      ) {
        this.protocolFailure();
      }
      return;
    }
    if (
      !Number.isSafeInteger(value.sequence) ||
      value.sequence !== this.expectedEventSequence
    ) {
      this.protocolFailure();
      return;
    }
    this.expectedEventSequence += 1;

    if (value.type === 'message') {
      if (!exactKeys(value, ['type', 'sessionId', 'sequence', 'data']) || typeof value.data !== 'string') {
        this.protocolFailure();
        return;
      }
      const bytes = new TextEncoder().encode(value.data).byteLength;
      if (bytes > this.opened.limits.maxMessageBytes || bytes > this.incomingCredit) {
        this.protocolFailure();
        return;
      }
      this.incomingCredit -= bytes;
      this.emit('message', { data: value.data });
      if (this.readyState !== 3 && bytes > 0) {
        this.opened.port.postMessage({
          type: 'credit',
          sessionId: this.opened.id,
          bytes,
        });
        this.incomingCredit += bytes;
      }
      return;
    }
    if (value.type === 'error') {
      if (
        !exactKeys(value, ['type', 'sessionId', 'sequence', 'message']) ||
        !isBoundedString(value.message, MAX_ERROR_CHARS)
      ) {
        this.protocolFailure();
        return;
      }
      this.emit('error', { message: value.message });
      return;
    }
    if (value.type === 'close') {
      if (
        !exactKeys(value, ['type', 'sessionId', 'sequence', 'code', 'reason', 'wasClean']) ||
        !Number.isInteger(value.code) ||
        (value.code as number) < 0 ||
        (value.code as number) > 4_999 ||
        typeof value.reason !== 'string' ||
        new TextEncoder().encode(value.reason).byteLength > MAX_CLOSE_REASON_BYTES ||
        typeof value.wasClean !== 'boolean'
      ) {
        this.protocolFailure();
        return;
      }
      this.finish({ code: value.code, reason: value.reason, wasClean: value.wasClean });
      return;
    }
    this.protocolFailure();
  }

  private protocolFailure(): void {
    if (this.readyState === 3) return;
    this.emit('error', { message: 'The host WebSocket protocol is invalid.' });
    this.finish({ code: 1006, reason: 'protocol error', wasClean: false });
  }

  private finish(event: { code: unknown; reason: unknown; wasClean: unknown }): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.pendingRequests.clear();
    this.opened.port.onmessage = null;
    this.opened.port.onmessageerror = null;
    closePort(this.opened.port);
    this.emit('close', event);
    this.listeners.clear();
  }

  private emit(type: string, event: Record<string, unknown>): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        listener(event);
      } catch (error) {
        reportListenerError(error);
      }
    }
  }
}

/** Open one host-owned, text-only WebSocket for a packaged Kart surface. */
export async function openHostWebSocket(
  urlValue: string,
  protocolsValue: readonly string[] = [],
): Promise<RaceSocket> {
  const { url, protocols } = normalizeRequest(urlValue, protocolsValue);
  const result = await requestOpenResult(url, protocols);
  try {
    return new HostPortSocket(result);
  } catch (error) {
    closePort(result.port);
    throw error;
  }
}

/** RaceClient factory used only by the packaged federated surface. */
export const hostWebSocketFactory: RaceSocketFactory = (url) => openHostWebSocket(url);
