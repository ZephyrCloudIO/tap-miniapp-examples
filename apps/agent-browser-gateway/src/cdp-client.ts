const BROWSER_BINDING_ORIGIN = "https://browser.internal";
const BROWSER_BINDING_API = `${BROWSER_BINDING_ORIGIN}/v1`;
const BROWSER_CLIENT_HEADER = "@tap-examples/agent-browser-gateway@0.2.0";
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MAX_CONNECT_TIMEOUT_MS = 60_000;
const DEFAULT_DEBUG_ERROR_LIMIT = 32;
const MAX_DEBUG_ERROR_LIMIT = 128;
const DEFAULT_DEBUG_BYTE_LIMIT = 16 * 1024;
const MIN_DEBUG_BYTE_LIMIT = 1024;
const MAX_DEBUG_BYTE_LIMIT = 64 * 1024;
const MAX_DEBUG_MESSAGE_CHARACTERS = 512;
const MAX_CDP_MESSAGE_BYTES = 16 * 1024 * 1024;
const REDACTED = "[REDACTED]";
const IDENTIFIER = /^[0-9A-Za-z._:-]{1,128}$/u;
const TARGET_SESSION_IDENTIFIER = /^[0-9A-Za-z._:-]{1,256}$/u;
const CDP_METHOD = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/u;
const ENABLED_DOMAINS = [
  "Page",
  "DOM",
  "Runtime",
  "Log",
  "Network",
  "Accessibility",
] as const;

export interface CdpBrowserBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export type CdpClientState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "disconnected"
  | "closing"
  | "closed";

export type CdpClientErrorCode =
  | "cdp_invalid_options"
  | "cdp_connect_timeout"
  | "cdp_upgrade_failed"
  | "cdp_invalid_message"
  | "cdp_command_timeout"
  | "cdp_command_failed"
  | "cdp_disconnected"
  | "cdp_connection_replaced"
  | "cdp_closed";

export class CdpClientError extends Error {
  readonly code: CdpClientErrorCode;
  readonly retryable: boolean;
  readonly method: string | null;

  constructor(
    code: CdpClientErrorCode,
    message: string,
    options: Readonly<{
      retryable?: boolean;
      method?: string | null;
    }> = {},
  ) {
    super(message);
    this.name = "CdpClientError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.method = options.method ?? null;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.method === null ? {} : { method: this.method }),
    };
  }
}

export class CdpCommandError extends CdpClientError {
  readonly protocolCode: number | null;

  constructor(
    method: string,
    protocolCode: number | null,
    protocolMessage: string,
  ) {
    super(
      "cdp_command_failed",
      `CDP command ${method} failed: ${protocolMessage}`,
      { method },
    );
    this.name = "CdpCommandError";
    this.protocolCode = protocolCode;
  }

  override toJSON(): Readonly<Record<string, unknown>> {
    return {
      ...super.toJSON(),
      protocolCode: this.protocolCode,
    };
  }
}

export interface CdpEvent {
  readonly method: string;
  readonly params: unknown;
  readonly sessionId: string | null;
  readonly receivedAt: number;
}

export interface CdpDisconnectEvent {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
  readonly receivedAt: number;
}

export interface CdpDebugError {
  /** Monotonic within this client instance, including entries evicted from the ring. */
  readonly sequence: number;
  readonly occurredAt: number;
  readonly code: CdpClientErrorCode | "cdp_event_callback_failed" | "cdp_socket_error";
  readonly message: string;
  readonly method?: string;
  readonly protocolCode?: number;
}

export interface CdpCommandOptions {
  /** Target commands are sent through the flattened target session by default. */
  readonly scope?: "target" | "browser";
  readonly timeoutMs?: number;
}

export interface ConnectBrowserRunCdpOptions {
  readonly browser: CdpBrowserBinding;
  readonly upstreamSessionId: string;
  readonly targetId: string;
  readonly onEvent: (event: CdpEvent) => void | Promise<void>;
  readonly onDisconnect?: (event: CdpDisconnectEvent) => void | Promise<void>;
  readonly commandTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxDebugErrors?: number;
  readonly maxDebugBytes?: number;
}

interface PendingCommand {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: CdpClientError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ActiveConnection {
  readonly generation: number;
  readonly socket: WebSocket;
  readonly onMessage: (event: MessageEvent) => void;
  readonly onClose: (event: CloseEvent) => void;
  readonly onError: (event: Event) => void;
}

interface StoredDebugError {
  readonly entry: CdpDebugError;
  readonly bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CdpClientError(
      "cdp_invalid_options",
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function boundedIntegerOption(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    const containsSensitiveComponents = Boolean(
      url.username ||
      url.password ||
      (url.pathname && url.pathname !== "/") ||
      url.search ||
      url.hash,
    );
    return containsSensitiveComponents
      ? `${url.origin}/${REDACTED}`
      : `${url.origin}/`;
  } catch {
    return REDACTED;
  }
}

function redactDebugText(value: string): string {
  const source = value.slice(0, 8 * MAX_DEBUG_MESSAGE_CHARACTERS);
  const bearerRedacted = source.replace(
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
    `$1 ${REDACTED}`,
  );
  const urlsRedacted = bearerRedacted.replace(
    /\bhttps?:\/\/[^\s<>"']+/giu,
    (candidate) => redactUrl(candidate),
  );
  const secretsRedacted = urlsRedacted.replace(
    /(["']?)(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[_-]?key|credential)(["']?)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/giu,
    (
      _match,
      leadingQuote: string,
      label: string,
      trailingQuote: string,
      separator: string,
    ) => `${leadingQuote}${label}${trailingQuote}${separator}${REDACTED}`,
  );
  if (secretsRedacted.length <= MAX_DEBUG_MESSAGE_CHARACTERS) {
    return secretsRedacted;
  }
  return `${secretsRedacted.slice(0, MAX_DEBUG_MESSAGE_CHARACTERS - 1)}…`;
}

function errorMessage(error: unknown): string {
  return redactDebugText(
    error instanceof Error ? error.message : String(error),
  );
}

function responseResult(message: Readonly<Record<string, unknown>>): unknown {
  return Object.hasOwn(message, "result") ? message.result : {};
}

function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  if (value.length > limit) return true;
  const encoder = new TextEncoder();
  const codeUnitChunkSize = 64 * 1024;
  const encodedChunk = new Uint8Array(codeUnitChunkSize * 3);
  let encodedBytes = 0;
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(value.length, offset + codeUnitChunkSize);
    const finalCodeUnit = value.charCodeAt(end - 1);
    const nextCodeUnit = value.charCodeAt(end);
    if (
      end < value.length &&
      finalCodeUnit >= 0xd800 &&
      finalCodeUnit <= 0xdbff &&
      nextCodeUnit >= 0xdc00 &&
      nextCodeUnit <= 0xdfff
    ) {
      end -= 1;
    }
    const encoded = encoder.encodeInto(
      value.slice(offset, end),
      encodedChunk,
    );
    encodedBytes += encoded.written;
    if (encodedBytes > limit) return true;
    offset = end;
  }
  return false;
}

export class BrowserRunCdpClient {
  readonly #browser: CdpBrowserBinding;
  readonly #upstreamSessionId: string;
  readonly #targetId: string;
  readonly #onEvent: (event: CdpEvent) => void | Promise<void>;
  readonly #onDisconnect:
    | ((event: CdpDisconnectEvent) => void | Promise<void>)
    | undefined;
  readonly #commandTimeoutMs: number;
  readonly #connectTimeoutMs: number;
  readonly #maxDebugErrors: number;
  readonly #maxDebugBytes: number;
  readonly #pending = new Map<number, PendingCommand>();
  readonly #debugErrors: StoredDebugError[] = [];
  #debugBytes = 2;
  #nextDebugSequence = 1;
  #state: CdpClientState = "connecting";
  #connection: ActiveConnection | null = null;
  #targetSessionId: string | null = null;
  #nextCommandId = 1;
  #generation = 0;
  #lifecycle: Promise<void> | null = null;
  #upgradeAbort: AbortController | null = null;

  constructor(options: ConnectBrowserRunCdpOptions) {
    if (!IDENTIFIER.test(options.upstreamSessionId)) {
      throw new CdpClientError(
        "cdp_invalid_options",
        "upstreamSessionId is invalid.",
      );
    }
    if (!IDENTIFIER.test(options.targetId)) {
      throw new CdpClientError("cdp_invalid_options", "targetId is invalid.");
    }
    this.#browser = options.browser;
    this.#upstreamSessionId = options.upstreamSessionId;
    this.#targetId = options.targetId;
    this.#onEvent = options.onEvent;
    this.#onDisconnect = options.onDisconnect;
    this.#commandTimeoutMs = integerOption(
      options.commandTimeoutMs,
      DEFAULT_COMMAND_TIMEOUT_MS,
      1,
      MAX_COMMAND_TIMEOUT_MS,
      "commandTimeoutMs",
    );
    this.#connectTimeoutMs = integerOption(
      options.connectTimeoutMs,
      DEFAULT_CONNECT_TIMEOUT_MS,
      1,
      MAX_CONNECT_TIMEOUT_MS,
      "connectTimeoutMs",
    );
    this.#maxDebugErrors = boundedIntegerOption(
      options.maxDebugErrors,
      DEFAULT_DEBUG_ERROR_LIMIT,
      1,
      MAX_DEBUG_ERROR_LIMIT,
    );
    this.#maxDebugBytes = boundedIntegerOption(
      options.maxDebugBytes,
      DEFAULT_DEBUG_BYTE_LIMIT,
      MIN_DEBUG_BYTE_LIMIT,
      MAX_DEBUG_BYTE_LIMIT,
    );
  }

  get state(): CdpClientState {
    return this.#state;
  }

  get targetSessionId(): string | null {
    return this.#targetSessionId;
  }

  getDebugErrors(): readonly CdpDebugError[] {
    return this.#debugErrors.map(({ entry }) => ({ ...entry }));
  }

  async start(): Promise<void> {
    if (this.#state === "open") return;
    if (this.#state === "closing" || this.#state === "closed") {
      throw new CdpClientError("cdp_closed", "The CDP client is closed.");
    }
    if (this.#lifecycle) {
      await this.#lifecycle;
      return;
    }
    const operation = this.#establish(false);
    this.#lifecycle = operation;
    try {
      await operation;
    } finally {
      if (this.#lifecycle === operation) this.#lifecycle = null;
    }
  }

  async reconnect(): Promise<void> {
    if (this.#state === "closing" || this.#state === "closed") {
      throw new CdpClientError("cdp_closed", "The CDP client is closed.");
    }
    if (this.#lifecycle) {
      await this.#lifecycle;
      return;
    }
    const operation = this.#establish(true);
    this.#lifecycle = operation;
    try {
      await operation;
    } finally {
      if (this.#lifecycle === operation) this.#lifecycle = null;
    }
  }

  async send<Result = unknown>(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    options: CdpCommandOptions = {},
  ): Promise<Result> {
    if (this.#state === "closing" || this.#state === "closed") {
      throw new CdpClientError("cdp_closed", "The CDP client is closed.", {
        method,
      });
    }
    if (this.#state !== "open") {
      throw new CdpClientError(
        "cdp_disconnected",
        "The CDP client is not connected.",
        { retryable: true, method },
      );
    }
    const timeoutMs = integerOption(
      options.timeoutMs,
      this.#commandTimeoutMs,
      1,
      MAX_COMMAND_TIMEOUT_MS,
      "timeoutMs",
    );
    const sessionId = options.scope === "browser"
      ? null
      : this.#targetSessionId;
    if (options.scope !== "browser" && sessionId === null) {
      throw new CdpClientError(
        "cdp_disconnected",
        "The target CDP session is not attached.",
        { retryable: true, method },
      );
    }
    const result = await this.#sendCommand(method, params, sessionId, timeoutMs);
    return result as Result;
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closing";
    this.#upgradeAbort?.abort();
    this.#upgradeAbort = null;
    this.#generation += 1;
    this.#disposeConnection(
      "cdp_closed",
      "The CDP client was closed.",
      false,
    );
    this.#targetSessionId = null;
    const lifecycle = this.#lifecycle;
    if (lifecycle) await lifecycle.catch(() => undefined);
    this.#state = "closed";
  }

  async #establish(replacing: boolean): Promise<void> {
    this.#state = replacing ? "reconnecting" : "connecting";
    if (replacing) {
      this.#generation += 1;
      this.#disposeConnection(
        "cdp_connection_replaced",
        "The CDP connection was replaced.",
        true,
      );
      this.#targetSessionId = null;
    }
    const generation = this.#generation + 1;
    this.#generation = generation;
    try {
      const connection = await this.#openConnection(generation);
      if (
        this.#isClosing() ||
        generation !== this.#generation
      ) {
        this.#closeSocket(connection);
        throw new CdpClientError("cdp_closed", "The CDP client is closed.");
      }
      this.#connection = connection;
      await this.#attachAndEnable();
      if (
        this.#isClosing() ||
        generation !== this.#generation
      ) {
        throw new CdpClientError("cdp_closed", "The CDP client is closed.");
      }
      this.#state = "open";
    } catch (error) {
      if (this.#connection?.generation === generation) {
        this.#disposeConnection(
          "cdp_disconnected",
          "The CDP connection failed during setup.",
          true,
        );
      }
      this.#targetSessionId = null;
      if (!this.#isClosing()) {
        this.#state = "disconnected";
      }
      if (error instanceof CdpClientError) throw error;
      this.#addDebugError(
        "cdp_upgrade_failed",
        errorMessage(error),
      );
      throw new CdpClientError(
        "cdp_upgrade_failed",
        "Browser Run could not establish the CDP connection.",
        { retryable: true },
      );
    }
  }

  async #openConnection(generation: number): Promise<ActiveConnection> {
    const controller = new AbortController();
    this.#upgradeAbort = controller;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const endpoint = `${BROWSER_BINDING_API}/devtools/browser/${
      encodeURIComponent(this.#upstreamSessionId)
    }`;
    const upgrade = this.#browser.fetch(endpoint, {
      headers: {
        Upgrade: "websocket",
        "cf-brapi-client": BROWSER_CLIENT_HEADER,
      },
      redirect: "manual",
      signal: controller.signal,
    });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new CdpClientError(
          "cdp_connect_timeout",
          "Browser Run timed out while opening the CDP connection.",
          { retryable: true },
        ));
      }, this.#connectTimeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([upgrade, deadline]);
    } catch (error) {
      if (error instanceof CdpClientError) {
        this.#addDebugError(error.code, error.message);
        throw error;
      }
      this.#addDebugError("cdp_upgrade_failed", errorMessage(error));
      throw new CdpClientError(
        "cdp_upgrade_failed",
        "Browser Run could not open the CDP WebSocket.",
        { retryable: true },
      );
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (this.#upgradeAbort === controller) this.#upgradeAbort = null;
    }

    const socket = response.webSocket;
    if (socket === null) {
      await response.body?.cancel("CDP upgrade did not return a WebSocket")
        .catch(() => undefined);
      this.#addDebugError(
        "cdp_upgrade_failed",
        `Browser Run CDP upgrade returned HTTP ${response.status}.`,
      );
      throw new CdpClientError(
        "cdp_upgrade_failed",
        "Browser Run did not provide a CDP WebSocket.",
        { retryable: response.status >= 500 },
      );
    }

    const onMessage = (event: MessageEvent): void => {
      this.#handleMessage(generation, event.data);
    };
    const onClose = (event: CloseEvent): void => {
      this.#handleClose(generation, event);
    };
    const onError = (event: Event): void => {
      this.#handleDisconnect(
        generation,
        1006,
        event instanceof ErrorEvent && event.message
          ? event.message
          : "The CDP WebSocket reported an error.",
        false,
        true,
        "cdp_socket_error",
      );
    };
    const connection: ActiveConnection = {
      generation,
      socket,
      onMessage,
      onClose,
      onError,
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
    try {
      socket.accept();
    } catch (error) {
      this.#closeSocket(connection);
      this.#addDebugError("cdp_upgrade_failed", errorMessage(error));
      throw new CdpClientError(
        "cdp_upgrade_failed",
        "Browser Run could not accept the CDP WebSocket.",
        { retryable: true },
      );
    }
    return connection;
  }

  async #attachAndEnable(): Promise<void> {
    const attached = await this.#sendCommand(
      "Target.attachToTarget",
      { targetId: this.#targetId, flatten: true },
      null,
      this.#connectTimeoutMs,
    );
    const targetSessionId = isRecord(attached) &&
        typeof attached.sessionId === "string"
      ? attached.sessionId
      : null;
    if (
      targetSessionId === null ||
      !TARGET_SESSION_IDENTIFIER.test(targetSessionId)
    ) {
      this.#addDebugError(
        "cdp_invalid_message",
        "Target.attachToTarget omitted a valid sessionId.",
        "Target.attachToTarget",
      );
      throw new CdpClientError(
        "cdp_invalid_message",
        "Browser Run returned an invalid target attachment.",
        { method: "Target.attachToTarget" },
      );
    }
    this.#targetSessionId = targetSessionId;
    for (const domain of ENABLED_DOMAINS) {
      await this.#sendCommand(
        `${domain}.enable`,
        {},
        targetSessionId,
        this.#connectTimeoutMs,
      );
    }
  }

  #sendCommand(
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId: string | null,
    timeoutMs: number,
  ): Promise<unknown> {
    if (!CDP_METHOD.test(method) || method.length > 128) {
      return Promise.reject(new CdpClientError(
        "cdp_invalid_options",
        "CDP method is invalid.",
      ));
    }
    const connection = this.#connection;
    if (connection === null || connection.socket.readyState !== 1) {
      return Promise.reject(new CdpClientError(
        "cdp_disconnected",
        "The CDP WebSocket is not open.",
        { retryable: true, method },
      ));
    }
    const id = this.#nextCommandId;
    this.#nextCommandId += 1;
    if (!Number.isSafeInteger(this.#nextCommandId)) this.#nextCommandId = 1;
    let serialized: string;
    try {
      serialized = JSON.stringify({
        id,
        method,
        params,
        ...(sessionId === null ? {} : { sessionId }),
      });
    } catch {
      return Promise.reject(new CdpClientError(
        "cdp_invalid_options",
        "CDP command parameters must be JSON serializable.",
        { method },
      ));
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        const failure = new CdpClientError(
          "cdp_command_timeout",
          `CDP command ${method} timed out.`,
          { retryable: true, method },
        );
        this.#addDebugError(failure.code, failure.message, method);
        pending.reject(failure);
      }, timeoutMs);
      this.#pending.set(id, { method, resolve, reject, timeout });
      try {
        connection.socket.send(serialized);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        this.#addDebugError(
          "cdp_disconnected",
          errorMessage(error),
          method,
        );
        reject(new CdpClientError(
          "cdp_disconnected",
          "The CDP command could not be sent.",
          { retryable: true, method },
        ));
      }
    });
  }

  #handleMessage(generation: number, data: unknown): void {
    if (generation !== this.#generation) return;
    let text: string;
    if (typeof data === "string") {
      if (exceedsUtf8ByteLimit(data, MAX_CDP_MESSAGE_BYTES)) {
        this.#addDebugError(
          "cdp_invalid_message",
          "Browser Run returned an oversized CDP message.",
        );
        return;
      }
      text = data;
    } else if (data instanceof ArrayBuffer) {
      if (data.byteLength > MAX_CDP_MESSAGE_BYTES) {
        this.#addDebugError(
          "cdp_invalid_message",
          "Browser Run returned an oversized CDP message.",
        );
        return;
      }
      text = new TextDecoder().decode(data);
    } else {
      this.#addDebugError(
        "cdp_invalid_message",
        "Browser Run returned an unsupported CDP message type.",
      );
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.#addDebugError(
        "cdp_invalid_message",
        "Browser Run returned malformed CDP JSON.",
      );
      return;
    }
    if (!isRecord(value)) {
      this.#addDebugError(
        "cdp_invalid_message",
        "Browser Run returned a non-object CDP message.",
      );
      return;
    }

    if (Number.isSafeInteger(value.id) && Number(value.id) > 0) {
      this.#handleResponse(Number(value.id), value);
    }
    if (typeof value.method === "string" && value.method.length <= 256) {
      const event: CdpEvent = {
        method: value.method,
        params: Object.hasOwn(value, "params") ? value.params : {},
        sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
        receivedAt: Date.now(),
      };
      this.#deliverEvent(event);
    }
  }

  #handleResponse(
    id: number,
    message: Readonly<Record<string, unknown>>,
  ): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      this.#addDebugError(
        "cdp_invalid_message",
        "Browser Run returned a response for an unknown command.",
      );
      return;
    }
    this.#pending.delete(id);
    clearTimeout(pending.timeout);
    if (isRecord(message.error)) {
      const protocolCode = Number.isSafeInteger(message.error.code)
        ? Number(message.error.code)
        : null;
      const protocolMessage = redactDebugText(
        typeof message.error.message === "string"
          ? message.error.message
          : "The CDP command failed.",
      );
      this.#addDebugError(
        "cdp_command_failed",
        protocolMessage,
        pending.method,
        protocolCode,
      );
      pending.reject(new CdpCommandError(
        pending.method,
        protocolCode,
        protocolMessage,
      ));
      return;
    }
    pending.resolve(responseResult(message));
  }

  #handleClose(generation: number, event: CloseEvent): void {
    this.#handleDisconnect(
      generation,
      event.code,
      event.reason || "The CDP WebSocket closed.",
      event.wasClean,
      false,
      "cdp_disconnected",
    );
  }

  #handleDisconnect(
    generation: number,
    code: number,
    rawReason: string,
    wasClean: boolean,
    closeSocket: boolean,
    debugCode: "cdp_disconnected" | "cdp_socket_error",
  ): void {
    if (generation !== this.#generation) return;
    const connection = this.#connection;
    if (connection?.generation !== generation) return;
    this.#connection = null;
    if (closeSocket) this.#closeSocket(connection);
    else this.#removeListeners(connection);
    this.#targetSessionId = null;
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#state = "disconnected";
    const reason = redactDebugText(rawReason);
    this.#addDebugError(debugCode, reason);
    this.#rejectPending(
      "cdp_disconnected",
      "The CDP WebSocket disconnected.",
      true,
    );
    if (this.#onDisconnect) {
      try {
        const delivery = this.#onDisconnect({
          code,
          reason,
          wasClean,
          receivedAt: Date.now(),
        });
        if (delivery instanceof Promise) {
          void delivery.catch((error: unknown) => {
            this.#addDebugError(
              "cdp_event_callback_failed",
              errorMessage(error),
            );
          });
        }
      } catch (error) {
        this.#addDebugError(
          "cdp_event_callback_failed",
          errorMessage(error),
        );
      }
    }
  }

  #deliverEvent(event: CdpEvent): void {
    try {
      const delivery = this.#onEvent(event);
      if (delivery instanceof Promise) {
        void delivery.catch((error: unknown) => {
          this.#addDebugError(
            "cdp_event_callback_failed",
            errorMessage(error),
            event.method,
          );
        });
      }
    } catch (error) {
      this.#addDebugError(
        "cdp_event_callback_failed",
        errorMessage(error),
        event.method,
      );
    }
  }

  #disposeConnection(
    code: "cdp_disconnected" | "cdp_connection_replaced" | "cdp_closed",
    message: string,
    retryable: boolean,
  ): void {
    const connection = this.#connection;
    this.#connection = null;
    if (connection) this.#closeSocket(connection);
    this.#rejectPending(code, message, retryable);
  }

  #closeSocket(connection: ActiveConnection): void {
    this.#removeListeners(connection);
    try {
      connection.socket.close(1000, "CDP client connection closed");
    } catch {
      // The peer may already have completed the close handshake.
    }
  }

  #removeListeners(connection: ActiveConnection): void {
    connection.socket.removeEventListener("message", connection.onMessage);
    connection.socket.removeEventListener("close", connection.onClose);
    connection.socket.removeEventListener("error", connection.onError);
  }

  #rejectPending(
    code: "cdp_disconnected" | "cdp_connection_replaced" | "cdp_closed",
    message: string,
    retryable: boolean,
  ): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new CdpClientError(code, message, {
        retryable,
        method: pending.method,
      }));
    }
    this.#pending.clear();
  }

  #isClosing(): boolean {
    return this.#state === "closing" || this.#state === "closed";
  }

  #addDebugError(
    code: CdpDebugError["code"],
    message: string,
    method?: string,
    protocolCode?: number | null,
  ): void {
    const entry: CdpDebugError = {
      sequence: this.#nextDebugSequence,
      occurredAt: Date.now(),
      code,
      message: redactDebugText(message),
      ...(method === undefined ? {} : { method: method.slice(0, 128) }),
      ...(protocolCode === undefined || protocolCode === null
        ? {}
        : { protocolCode }),
    };
    this.#nextDebugSequence += 1;
    const bytes = new TextEncoder().encode(JSON.stringify(entry)).byteLength;
    if (bytes + 2 > this.#maxDebugBytes) return;
    const separatorBytes = this.#debugErrors.length === 0 ? 0 : 1;
    this.#debugErrors.push({ entry, bytes });
    this.#debugBytes += bytes + separatorBytes;
    while (
      this.#debugErrors.length > this.#maxDebugErrors ||
      this.#debugBytes > this.#maxDebugBytes
    ) {
      const removed = this.#debugErrors.shift();
      if (!removed) break;
      this.#debugBytes -= removed.bytes;
      if (this.#debugErrors.length > 0) this.#debugBytes -= 1;
    }
  }
}

export async function connectBrowserRunCdp(
  options: ConnectBrowserRunCdpOptions,
): Promise<BrowserRunCdpClient> {
  const client = new BrowserRunCdpClient(options);
  try {
    await client.start();
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}
