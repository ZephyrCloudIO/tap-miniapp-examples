import type {
  ElementPickPoint,
  ElementRepresentation,
} from "./element-picker";
import { encodeRemoteBrowserRoomCode } from "./room-code";

export type MiniAppJsonValue =
  | null
  | boolean
  | number
  | string
  | MiniAppJsonValue[]
  | { readonly [key: string]: MiniAppJsonValue };

export type DeclaredMcpContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly data: string;
      readonly mimeType: string;
    }
  | {
      readonly type: "resource";
      readonly resource: {
        readonly uri: string;
        readonly text?: string;
        readonly blob?: string;
        readonly mimeType?: string;
      };
    };

export interface DeclaredMcpToolResult {
  readonly content: readonly DeclaredMcpContent[];
  readonly structuredContent: MiniAppJsonValue | null;
}

export interface CallDeclaredMcpToolOptions {
  readonly toolContributionId: string;
  readonly input: MiniAppJsonValue;
}

export type CallDeclaredMcpTool = (
  options: CallDeclaredMcpToolOptions,
) => Promise<DeclaredMcpToolResult>;

export interface AuthorizeDeclaredMcpToolOptions {
  readonly toolContributionId: string;
}

export type AuthorizeDeclaredMcpTool = (
  options: AuthorizeDeclaredMcpToolOptions,
) => Promise<void>;

export interface RemoteBrowserControl {
  readonly holder: "agent" | "human";
  readonly participantId: string | null;
  readonly epoch: number;
  readonly expiresAt: string | null;
}

export type RemoteBrowserRoomStatus =
  | "allocating"
  | "active"
  | "closing"
  | "closed"
  | "failed";

export interface RemoteBrowserParticipant {
  readonly participantId: string;
  readonly kind: "agent" | "human";
  readonly principalId: string;
  readonly consumerKind:
    | "package-contribution"
    | "specialist"
    | "chat"
    | "workflow"
    | "platform-service";
  readonly status: "connected" | "disconnected";
  readonly creator: boolean;
  readonly self: boolean;
  readonly joinedAt: string;
  readonly lastSeenAt: string;
  readonly disconnectedAt: string | null;
}

export interface RemoteBrowserRoomState {
  readonly sessionHandle: string;
  readonly state: RemoteBrowserRoomStatus;
  readonly documentRevision: number;
  readonly control: RemoteBrowserControl;
  readonly participants: readonly RemoteBrowserParticipant[];
}

export interface RemoteBrowserShareResult {
  readonly sessionHandle: string;
  readonly invitationToken: string;
  readonly invitationExpiresAt: string;
  readonly remainingUses: number;
}

export interface RemoteBrowserLeaveResult {
  readonly sessionHandle: string;
  readonly participantId: string;
  readonly status: "disconnected";
  readonly control: RemoteBrowserControl;
}

export interface RemoteBrowserSessionState {
  readonly sessionHandle: string;
  readonly url: string;
  readonly title: string;
  readonly documentRevision: number;
  readonly control: RemoteBrowserControl;
  readonly telemetryCoverageStartedAt: string | null;
  readonly expiresAt: string;
}

export interface RemoteBrowserScreenshot {
  readonly sessionHandle: string;
  readonly documentRevision: number;
  readonly control: RemoteBrowserControl;
  readonly telemetryCoverageStartedAt: string | null;
  readonly mediaType: "image/png";
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly pngData: Uint8Array;
  readonly pngDataUrl: string;
}

export interface RemoteBrowserElementSelection {
  readonly sessionHandle: string;
  readonly elementRef: string;
  readonly documentRevision: number;
  readonly control: RemoteBrowserControl;
  readonly telemetryCoverageStartedAt: string | null;
  readonly representation: ElementRepresentation;
  readonly selector: string | null;
  readonly html: string | null;
  readonly mediaType: "image/png" | null;
  readonly byteLength: number | null;
  readonly pngData: Uint8Array | null;
  readonly pngDataUrl: string | null;
}

export interface RemoteBrowserCloseResult {
  readonly sessionHandle: string;
  readonly state: "closing" | "closed";
}

export interface RemoteBrowserViewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly mobile: boolean;
}

export interface RemoteBrowserMcpClient {
  start(input: {
    readonly url: string;
    readonly keepAliveMs?: number;
    readonly viewport?: RemoteBrowserViewport;
  }): Promise<RemoteBrowserSessionState>;
  screenshot(sessionHandle: string): Promise<RemoteBrowserScreenshot>;
  selectElement(input: {
    readonly sessionHandle: string;
    readonly point: ElementPickPoint;
    readonly representation: ElementRepresentation;
    readonly expectedControlEpoch: number;
    readonly expectedDocumentRevision: number;
  }): Promise<RemoteBrowserElementSelection>;
  scroll(input: {
    readonly sessionHandle: string;
    readonly point: ElementPickPoint;
    readonly deltaX: number;
    readonly deltaY: number;
    readonly expectedControlEpoch: number;
    readonly expectedDocumentRevision: number;
  }): Promise<void>;
  share(sessionHandle: string): Promise<RemoteBrowserShareResult>;
  join(input: {
    readonly sessionHandle: string;
    readonly invitationToken?: string;
  }): Promise<RemoteBrowserRoomState>;
  room(sessionHandle: string): Promise<RemoteBrowserRoomState>;
  claimControl(input: {
    readonly sessionHandle: string;
    readonly expectedControlEpoch: number;
    readonly leaseMs?: number;
  }): Promise<{ readonly sessionHandle: string; readonly control: RemoteBrowserControl }>;
  releaseControl(input: {
    readonly sessionHandle: string;
    readonly expectedControlEpoch: number;
  }): Promise<{ readonly sessionHandle: string; readonly control: RemoteBrowserControl }>;
  leave(sessionHandle: string): Promise<RemoteBrowserLeaveResult>;
  close(sessionHandle: string): Promise<RemoteBrowserCloseResult>;
}

const SESSION_HANDLE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PARTICIPANT_ID = /^rp_[0-9a-f]{64}$/u;
const INVITATION_TOKEN = /^[0-9A-Za-z_-]{43}$/u;
const ROOM_STATES = new Set<RemoteBrowserRoomStatus>([
  "allocating",
  "active",
  "closing",
  "closed",
  "failed",
]);
const PARTICIPANT_CONSUMER_KINDS = new Set<RemoteBrowserParticipant["consumerKind"]>([
  "package-contribution",
  "specialist",
  "chat",
  "workflow",
  "platform-service",
]);
const MAX_PNG_BYTES = 6 * 1024 * 1024;
const MAX_HTML_BYTES = 128 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function record(value: MiniAppJsonValue | undefined, label: string) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return value as Readonly<Record<string, MiniAppJsonValue>>;
}

function integer(value: MiniAppJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return value;
}

function nonNegativeInteger(
  value: MiniAppJsonValue | undefined,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return value;
}

function boundedString(
  value: MiniAppJsonValue | undefined,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum ||
    /[\0]/u.test(value)
  ) {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return value;
}

function dateTime(
  value: MiniAppJsonValue | undefined,
  label: string,
): string {
  const candidate = boundedString(value, label, 64);
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return candidate;
}

function nullableDateTime(
  value: MiniAppJsonValue | undefined,
  label: string,
): string | null {
  return value === null ? null : dateTime(value, label);
}

function sessionHandle(value: MiniAppJsonValue | undefined): string {
  const candidate = boundedString(value, "session handle", 64);
  if (!SESSION_HANDLE.test(candidate)) {
    throw new Error("Remote Browser returned invalid session handle.");
  }
  return candidate;
}

function participantId(
  value: MiniAppJsonValue | undefined,
  nullable = false,
): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !PARTICIPANT_ID.test(value)) {
    throw new Error("Remote Browser returned invalid participant identity.");
  }
  return value;
}

function invitationToken(value: MiniAppJsonValue | undefined): string {
  if (typeof value !== "string" || !INVITATION_TOKEN.test(value)) {
    throw new Error("Remote Browser returned invalid room invitation token.");
  }
  return value;
}

function pageUrl(value: MiniAppJsonValue | undefined): string {
  const candidate = boundedString(value, "page URL", 64 * 1024);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Remote Browser returned invalid page URL.");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Remote Browser returned invalid page URL.");
  }
  return parsed.toString();
}

function control(value: MiniAppJsonValue | undefined): RemoteBrowserControl {
  const candidate = record(value, "control state");
  if (candidate.holder !== "agent" && candidate.holder !== "human") {
    throw new Error("Remote Browser returned invalid control state.");
  }
  return {
    holder: candidate.holder,
    participantId: participantId(candidate.participantId, true),
    epoch: integer(candidate.epoch, "control epoch"),
    expiresAt: nullableDateTime(candidate.expiresAt, "control expiry"),
  };
}

function boolean(value: MiniAppJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Remote Browser returned invalid ${label}.`);
  }
  return value;
}

function participant(value: MiniAppJsonValue): RemoteBrowserParticipant {
  const candidate = record(value, "room participant");
  if (candidate.kind !== "agent" && candidate.kind !== "human") {
    throw new Error("Remote Browser returned invalid participant kind.");
  }
  if (
    typeof candidate.consumerKind !== "string" ||
    !PARTICIPANT_CONSUMER_KINDS.has(
      candidate.consumerKind as RemoteBrowserParticipant["consumerKind"],
    )
  ) {
    throw new Error("Remote Browser returned invalid participant consumer kind.");
  }
  if (candidate.status !== "connected" && candidate.status !== "disconnected") {
    throw new Error("Remote Browser returned invalid participant status.");
  }
  return {
    participantId: participantId(candidate.participantId) as string,
    kind: candidate.kind,
    principalId: boundedString(candidate.principalId, "participant principal", 512),
    consumerKind:
      candidate.consumerKind as RemoteBrowserParticipant["consumerKind"],
    status: candidate.status,
    creator: boolean(candidate.creator, "participant creator flag"),
    self: boolean(candidate.self, "participant self flag"),
    joinedAt: dateTime(candidate.joinedAt, "participant join time"),
    lastSeenAt: dateTime(candidate.lastSeenAt, "participant last-seen time"),
    disconnectedAt: nullableDateTime(
      candidate.disconnectedAt,
      "participant disconnect time",
    ),
  };
}

function roomState(
  value: Readonly<Record<string, MiniAppJsonValue>>,
): RemoteBrowserRoomState {
  if (typeof value.state !== "string" || !ROOM_STATES.has(value.state as RemoteBrowserRoomStatus)) {
    throw new Error("Remote Browser returned invalid room state.");
  }
  if (!Array.isArray(value.participants) || value.participants.length > 64) {
    throw new Error("Remote Browser returned invalid room participants.");
  }
  const participants = value.participants.map(participant);
  const identities = new Set(participants.map((item) => item.participantId));
  if (identities.size !== participants.length) {
    throw new Error("Remote Browser returned duplicate room participants.");
  }
  if (participants.filter((item) => item.self).length !== 1) {
    throw new Error("Remote Browser omitted the current room participant.");
  }
  return {
    sessionHandle: sessionHandle(value.sessionHandle),
    state: value.state as RemoteBrowserRoomStatus,
    documentRevision: integer(value.documentRevision, "document revision"),
    control: control(value.control),
    participants,
  };
}

function structured(result: DeclaredMcpToolResult) {
  if (
    result === null ||
    typeof result !== "object" ||
    !Array.isArray(Reflect.get(result, "content"))
  ) {
    throw new Error("Remote Browser returned an invalid MCP tool result.");
  }
  for (const item of result.content) {
    if (item === null || typeof item !== "object") {
      throw new Error("Remote Browser returned invalid MCP content.");
    }
    if (item.type === "text") {
      if (typeof item.text !== "string" || item.text.length > 1024 * 1024) {
        throw new Error("Remote Browser returned invalid MCP text content.");
      }
      continue;
    }
    if (item.type === "image") {
      if (
        typeof item.data !== "string" ||
        item.data.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4 ||
        typeof item.mimeType !== "string" ||
        item.mimeType.length > 128
      ) {
        throw new Error("Remote Browser returned invalid MCP image content.");
      }
      continue;
    }
    if (
      item.type !== "resource" ||
      item.resource === null ||
      typeof item.resource !== "object" ||
      typeof item.resource.uri !== "string"
    ) {
      throw new Error("Remote Browser returned an unsupported MCP content block.");
    }
  }
  return record(result.structuredContent ?? undefined, "structured tool output");
}

function decodePng(result: DeclaredMcpToolResult, expectedBytes: number) {
  const images = result.content.filter(
    (item): item is Extract<DeclaredMcpContent, { readonly type: "image" }> =>
      item.type === "image",
  );
  if (images.length !== 1 || images[0].mimeType !== "image/png") {
    throw new Error("Remote Browser omitted the selected PNG image block.");
  }
  const encoded = images[0].data;
  if (
    encoded.length === 0 ||
    !/^(?:[0-9A-Za-z+/]{4})*(?:[0-9A-Za-z+/]{2}==|[0-9A-Za-z+/]{3}=)?$/u.test(
      encoded,
    )
  ) {
    throw new Error("Remote Browser returned invalid PNG image data.");
  }
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch {
    throw new Error("Remote Browser returned invalid PNG image data.");
  }
  if (binary.length !== expectedBytes || binary.length > MAX_PNG_BYTES) {
    throw new Error("Remote Browser returned a PNG with mismatched size metadata.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    bytes.length < 24 ||
    PNG_SIGNATURE.some((expected, index) => bytes[index] !== expected) ||
    String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
  ) {
    throw new Error("Remote Browser returned invalid PNG image data.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1 || width > 8_192 || height > 8_192) {
    throw new Error("Remote Browser returned invalid PNG dimensions.");
  }
  return {
    bytes,
    width,
    height,
    dataUrl: `data:image/png;base64,${encoded}`,
  };
}

function commonSessionOutput(value: Readonly<Record<string, MiniAppJsonValue>>) {
  return {
    sessionHandle: sessionHandle(value.sessionHandle),
    documentRevision: integer(value.documentRevision, "document revision"),
    control: control(value.control),
    telemetryCoverageStartedAt: nullableDateTime(
      value.telemetryCoverageStartedAt,
      "telemetry coverage time",
    ),
  };
}

function assertSameSession(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error("Remote Browser returned a different session handle.");
  }
}

function assertExpectedRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error("The selected element belongs to a stale browser document.");
  }
}

export function createRemoteBrowserMcpClient(
  callDeclaredTool: CallDeclaredMcpTool,
): RemoteBrowserMcpClient {
  const client: RemoteBrowserMcpClient = {
    async start(input) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-start",
        input: {
          url: input.url,
          ...(input.keepAliveMs === undefined
            ? {}
            : { keepAliveMs: input.keepAliveMs }),
          ...(input.viewport === undefined
            ? {}
            : {
                viewport: {
                  width: input.viewport.width,
                  height: input.viewport.height,
                  deviceScaleFactor: input.viewport.deviceScaleFactor,
                  mobile: input.viewport.mobile,
                },
              }),
        },
      });
      const output = structured(result);
      return {
        ...commonSessionOutput(output),
        url: pageUrl(output.url),
        title: boundedString(output.title, "page title", 1_024, true),
        expiresAt: dateTime(output.expiresAt, "session expiry"),
      };
    },

    async screenshot(expectedSessionHandle) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-screenshot",
        input: { sessionHandle: expectedSessionHandle },
      });
      const output = structured(result);
      const common = commonSessionOutput(output);
      assertSameSession(common.sessionHandle, expectedSessionHandle);
      if (output.mediaType !== "image/png") {
        throw new Error("Remote Browser returned an invalid screenshot media type.");
      }
      const byteLength = integer(output.byteLength, "screenshot byte length");
      if (byteLength > MAX_PNG_BYTES) {
        throw new Error("Remote Browser screenshot exceeds the 6 MiB limit.");
      }
      const png = decodePng(result, byteLength);
      return {
        ...common,
        mediaType: "image/png" as const,
        byteLength,
        width: png.width,
        height: png.height,
        pngData: png.bytes,
        pngDataUrl: png.dataUrl,
      };
    },

    async selectElement(input) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-select-element",
        input: {
          sessionHandle: input.sessionHandle,
          xRatio: input.point.xRatio,
          yRatio: input.point.yRatio,
          representation: input.representation,
          expectedControlEpoch: input.expectedControlEpoch,
          expectedDocumentRevision: input.expectedDocumentRevision,
        },
      });
      const output = structured(result);
      const common = commonSessionOutput(output);
      assertSameSession(common.sessionHandle, input.sessionHandle);
      assertExpectedRevision(
        common.documentRevision,
        input.expectedDocumentRevision,
      );
      if (common.control.epoch !== input.expectedControlEpoch) {
        throw new Error("The selected element belongs to a stale control epoch.");
      }
      if (output.representation !== input.representation) {
        throw new Error("Remote Browser returned a different element representation.");
      }
      const elementRef = boundedString(output.elementRef, "element reference", 128);

      if (input.representation === "selector") {
        if (
          output.html !== null ||
          output.mediaType !== null ||
          output.byteLength !== null
        ) {
          throw new Error("Remote Browser returned mixed element representations.");
        }
        return {
          ...common,
          elementRef,
          representation: "selector" as const,
          selector: boundedString(output.selector, "element selector", 4_096),
          html: null,
          mediaType: null,
          byteLength: null,
          pngData: null,
          pngDataUrl: null,
        };
      }
      if (input.representation === "html") {
        if (
          output.selector !== null ||
          output.mediaType !== null ||
          output.byteLength !== null
        ) {
          throw new Error("Remote Browser returned mixed element representations.");
        }
        const html = boundedString(output.html, "element HTML", MAX_HTML_BYTES);
        if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
          throw new Error("Remote Browser element HTML exceeds the 128 KiB limit.");
        }
        if (
          /<\/?(?:script|style|noscript|template|iframe|object|embed)\b/iu.test(html) ||
          /\son[a-z]+\s*=/iu.test(html)
        ) {
          throw new Error("Remote Browser returned unsafe element HTML.");
        }
        return {
          ...common,
          elementRef,
          representation: "html" as const,
          selector: null,
          html,
          mediaType: null,
          byteLength: null,
          pngData: null,
          pngDataUrl: null,
        };
      }
      if (output.mediaType !== "image/png") {
        throw new Error("Remote Browser returned an invalid element image type.");
      }
      if (output.selector !== null || output.html !== null) {
        throw new Error("Remote Browser returned mixed element representations.");
      }
      const byteLength = integer(output.byteLength, "element image byte length");
      const png = decodePng(result, byteLength);
      return {
        ...common,
        elementRef,
        representation: "png" as const,
        selector: null,
        html: null,
        mediaType: "image/png" as const,
        byteLength,
        pngData: png.bytes,
        pngDataUrl: png.dataUrl,
      };
    },

    async scroll(input) {
      if (
        !Number.isFinite(input.point.xRatio) ||
        !Number.isFinite(input.point.yRatio) ||
        input.point.xRatio < 0 ||
        input.point.xRatio > 1 ||
        input.point.yRatio < 0 ||
        input.point.yRatio > 1 ||
        !Number.isFinite(input.deltaX) ||
        !Number.isFinite(input.deltaY) ||
        Math.abs(input.deltaX) > 2_400 ||
        Math.abs(input.deltaY) > 2_400 ||
        (input.deltaX === 0 && input.deltaY === 0)
      ) {
        throw new Error("Remote Browser scroll input is outside the supported viewport bounds.");
      }
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-scroll",
        input: {
          sessionHandle: input.sessionHandle,
          xRatio: input.point.xRatio,
          yRatio: input.point.yRatio,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          expectedControlEpoch: input.expectedControlEpoch,
          expectedDocumentRevision: input.expectedDocumentRevision,
        },
      });
      const output = structured(result);
      const common = commonSessionOutput(output);
      assertSameSession(common.sessionHandle, input.sessionHandle);
      assertExpectedRevision(
        common.documentRevision,
        input.expectedDocumentRevision,
      );
      if (common.control.epoch !== input.expectedControlEpoch) {
        throw new Error("The scroll result belongs to a stale control epoch.");
      }
      pageUrl(output.url);
      boundedString(output.title, "page title", 1_024, true);
    },

    async share(expectedSessionHandle) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-share-session",
        input: { sessionHandle: expectedSessionHandle },
      });
      const output = structured(result);
      const actualSessionHandle = sessionHandle(output.sessionHandle);
      assertSameSession(actualSessionHandle, expectedSessionHandle);
      const remainingUses = nonNegativeInteger(
        output.remainingUses,
        "room invitation remaining uses",
      );
      if (remainingUses !== 2) {
        throw new Error("Remote Browser returned invalid room invitation remaining uses.");
      }
      return {
        sessionHandle: actualSessionHandle,
        invitationToken: invitationToken(output.invitationToken),
        invitationExpiresAt: dateTime(
          output.invitationExpiresAt,
          "room invitation expiry",
        ),
        remainingUses,
      };
    },

    async join(input) {
      if (
        input.invitationToken !== undefined &&
        !INVITATION_TOKEN.test(input.invitationToken)
      ) {
        throw new Error("Enter a valid Remote Browser room code.");
      }
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-join-session",
        input: input.invitationToken === undefined
          ? { sessionHandle: input.sessionHandle }
          : {
              roomCode: encodeRemoteBrowserRoomCode({
                sessionHandle: input.sessionHandle,
                invitationToken: input.invitationToken,
              }),
            },
      });
      const output = roomState(structured(result));
      assertSameSession(output.sessionHandle, input.sessionHandle);
      return output;
    },

    async room(expectedSessionHandle) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-room",
        input: { sessionHandle: expectedSessionHandle },
      });
      const output = roomState(structured(result));
      assertSameSession(output.sessionHandle, expectedSessionHandle);
      return output;
    },

    async claimControl(input) {
      const leaseMs = input.leaseMs ?? 120_000;
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 60_000 || leaseMs > 600_000) {
        throw new Error("Remote Browser control lease must be between 1 and 10 minutes.");
      }
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-claim-control",
        input: {
          sessionHandle: input.sessionHandle,
          expectedControlEpoch: input.expectedControlEpoch,
          leaseMs,
        },
      });
      const output = structured(result);
      const actualSessionHandle = sessionHandle(output.sessionHandle);
      assertSameSession(actualSessionHandle, input.sessionHandle);
      return { sessionHandle: actualSessionHandle, control: control(output.control) };
    },

    async releaseControl(input) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-release-control",
        input: {
          sessionHandle: input.sessionHandle,
          expectedControlEpoch: input.expectedControlEpoch,
        },
      });
      const output = structured(result);
      const actualSessionHandle = sessionHandle(output.sessionHandle);
      assertSameSession(actualSessionHandle, input.sessionHandle);
      return { sessionHandle: actualSessionHandle, control: control(output.control) };
    },

    async leave(expectedSessionHandle) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-leave-session",
        input: { sessionHandle: expectedSessionHandle },
      });
      const output = structured(result);
      const actualSessionHandle = sessionHandle(output.sessionHandle);
      assertSameSession(actualSessionHandle, expectedSessionHandle);
      if (output.status !== "disconnected") {
        throw new Error("Remote Browser returned invalid participant leave status.");
      }
      return {
        sessionHandle: actualSessionHandle,
        participantId: participantId(output.participantId) as string,
        status: "disconnected" as const,
        control: control(output.control),
      };
    },

    async close(expectedSessionHandle) {
      const result = await callDeclaredTool({
        toolContributionId: "remote-browser-close",
        input: { sessionHandle: expectedSessionHandle },
      });
      const output = structured(result);
      const actualSessionHandle = sessionHandle(output.sessionHandle);
      assertSameSession(actualSessionHandle, expectedSessionHandle);
      if (output.state !== "closing" && output.state !== "closed") {
        throw new Error("Remote Browser returned an invalid close state.");
      }
      const state = output.state;
      return { sessionHandle: actualSessionHandle, state };
    },
  };
  return Object.freeze(client);
}
