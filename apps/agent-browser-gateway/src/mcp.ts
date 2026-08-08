import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import {
  browserRuntimeLimits,
  type BrowserToolPage,
  type BrowserToolDiagnostic,
  type BrowserToolNetworkRequest,
  type BrowserToolSessionView,
  type BrowserParticipant,
  type BrowserRoomView,
  type RpcError,
  type RpcResult,
} from "./control-plane";
import {
  DEFAULT_BROWSER_VIEWPORT,
  KITESURF_ENGINE,
  configuredAllowedDomains,
  parseSessionInput,
} from "./policy";
import { browserParticipantFromContext } from "./participant";
import {
  decodeRemoteBrowserRoomCode,
  isRemoteBrowserRoomCode,
  REMOTE_BROWSER_ROOM_CODE_PATTERN,
} from "./room-code";
import { randomSessionToken } from "./security";
import {
  REMOTE_BROWSER_MCP_SCOPE,
  type RemoteBrowserMcpProps,
} from "./oauth";

const DEFAULT_KEEP_ALIVE_MS = 600_000;
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 100;
const MAX_ELEMENT_SELECTOR_LENGTH = 4_096;
const MAX_ELEMENT_HTML_LENGTH = 131_072;
const MAX_ELEMENT_PNG_BYTES = 6 * 1024 * 1024;

const sessionHandleSchema = z
  .string()
  .uuid()
  .describe("Opaque Remote Browser session handle returned by remote_browser_start.");
const invitationTokenSchema = z.string().regex(/^[0-9A-Za-z_-]{43}$/u);
const roomCodeSchema = z
  .string()
  .regex(REMOTE_BROWSER_ROOM_CODE_PATTERN)
  .refine(isRemoteBrowserRoomCode, "Room code must contain a canonical Remote Browser session handle.")
  .describe("Exact RB1 room code shown by the Remote Browser miniapp.");
const joinSessionInputSchema = z.union([
  z.strictObject({ roomCode: roomCodeSchema }),
  z.strictObject({
    sessionHandle: sessionHandleSchema,
    invitationToken: invitationTokenSchema.optional(),
  }),
]);
const elementRefSchema = z
  .string()
  .min(1)
  .max(128)
  .describe(
    "Opaque element reference returned by the latest remote_browser_snapshot or remote_browser_select_element.",
  );
const targetUrlSchema = z
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "URL must use HTTP or HTTPS.");
const controlEpochSchema = z
  .number()
  .int()
  .positive()
  .describe("Control epoch returned by the latest Remote Browser result.");
const documentRevisionSchema = z
  .number()
  .int()
  .positive()
  .describe("Document revision returned by the latest Remote Browser result.");
const telemetryStartedSchema = z.iso.datetime().nullable();
const controlSchema = z.strictObject({
  holder: z.enum(["agent", "human"]),
  participantId: z.string().min(1).max(128).nullable(),
  epoch: controlEpochSchema,
  expiresAt: z.iso.datetime().nullable(),
});
const sessionViewSchema = z.strictObject({
  sessionHandle: sessionHandleSchema,
  url: z.string(),
  title: z.string(),
  documentRevision: documentRevisionSchema,
  control: controlSchema,
  telemetryCoverageStartedAt: telemetryStartedSchema,
});
const participantSchema = z.strictObject({
  participantId: z.string().regex(/^rp_[0-9a-f]{64}$/u),
  kind: z.enum(["agent", "human"]),
  principalId: z.string().min(1).max(512),
  consumerKind: z.enum([
    "package-contribution",
    "specialist",
    "chat",
    "workflow",
    "platform-service",
  ]),
  status: z.enum(["connected", "disconnected"]),
  creator: z.boolean(),
  self: z.boolean(),
  joinedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  disconnectedAt: z.iso.datetime().nullable(),
});
const roomSchema = z.strictObject({
  sessionHandle: sessionHandleSchema,
  state: z.enum(["allocating", "active", "closing", "closed", "failed"]),
  documentRevision: documentRevisionSchema,
  control: controlSchema,
  participants: z.array(participantSchema).min(1).max(64),
});
const mutationGuardSchema = {
  expectedControlEpoch: controlEpochSchema,
  expectedDocumentRevision: documentRevisionSchema,
} as const;
const scrollDeltaSchema = z.number().min(-2_400).max(2_400);
const browserViewportSchema = z.strictObject({
  width: z.number().int().min(320).max(1_920),
  height: z.number().int().min(240).max(1_200),
  deviceScaleFactor: z.number().min(1).max(3),
  mobile: z.boolean(),
});
const scrollInputSchema = z.strictObject({
  sessionHandle: sessionHandleSchema,
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  deltaX: scrollDeltaSchema,
  deltaY: scrollDeltaSchema,
  ...mutationGuardSchema,
}).refine(
  ({ deltaX, deltaY }) => deltaX !== 0 || deltaY !== 0,
  "At least one scroll delta must be non-zero.",
);
const pageInputSchema = z.strictObject({
  sessionHandle: sessionHandleSchema,
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
const networkItemSchema = z.strictObject({
  method: z.string().nullable(),
  url: z.string().nullable(),
  resourceType: z.string().nullable(),
  status: z.number().nullable(),
  failed: z.boolean().nullable(),
  errorText: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
const diagnosticItemSchema = z.strictObject({
  kind: z.enum(["console", "exception", "network", "http", "cdp", "telemetry"]),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  source: z.string().nullable(),
  occurredAt: z.iso.datetime(),
});

function sessionCoordinator(env: Env, sessionHandle: string) {
  return env.BROWSER_SESSIONS.getByName(sessionHandle);
}

function quotaCoordinator(env: Env, workspaceId: string) {
  return env.BROWSER_OWNER_QUOTAS.getByName(workspaceId);
}

function toolError(error: RpcError) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: { code: error.code, message: error.message },
        }),
      },
    ],
  };
}

function toolSuccess<T extends Readonly<Record<string, unknown>>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function pageResult<T>(page: BrowserToolPage<T>): Readonly<Record<string, unknown>> {
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    telemetryGap: page.telemetryGap,
    telemetryCoverageStartedAt: page.telemetryCoverageStartedAt,
  };
}

function toolView(view: BrowserToolSessionView): Readonly<Record<string, unknown>> {
  return {
    sessionHandle: view.sessionId,
    url: view.url,
    title: view.title,
    documentRevision: view.documentRevision,
    control: view.control,
    telemetryCoverageStartedAt: view.telemetryCoverageStartedAt,
  };
}

function roomResult(view: BrowserRoomView): Readonly<Record<string, unknown>> {
  return {
    sessionHandle: view.sessionId,
    state: view.state,
    documentRevision: view.documentRevision,
    control: view.control,
    participants: view.participants,
  };
}

async function attestedParticipant(
  context: ServerContext,
  props: RemoteBrowserMcpProps,
) {
  return browserParticipantFromContext(context, props);
}

async function createToolSession(
  env: Env,
  participant: BrowserParticipant,
  url: string,
  keepAliveMs: number,
  viewport: unknown,
): Promise<
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: RpcError }
> {
  const owner = participant.owner;
  const input = parseSessionInput(
    { url, engine: KITESURF_ENGINE, keepAliveMs, viewport },
    env.ALLOWED_HOSTS,
  );
  const runtimeLimits = browserRuntimeLimits(env);
  const sessionHandle = crypto.randomUUID();
  const sessionToken = randomSessionToken();
  const now = Date.now();
  const quota = quotaCoordinator(env, owner.workspaceId);
  const reserved = await quota.reserveSession({
    sessionId: sessionHandle,
    actorId: owner.actorId,
    expiresAt:
      now +
      runtimeLimits.maxSessionLifetimeMs +
      runtimeLimits.browserRunInactivityTimeoutMs,
    now,
  });
  if (!reserved.ok) return reserved;

  const coordinator = sessionCoordinator(env, sessionHandle);
  const created = await coordinator.create({
    sessionId: sessionHandle,
    sessionToken,
    owner,
    participant,
    input,
    allowedDomains: configuredAllowedDomains(env.ALLOWED_HOSTS),
    allowedHosts: env.ALLOWED_HOSTS,
    browserRunInactivityTimeoutMs: runtimeLimits.browserRunInactivityTimeoutMs,
    maxSessionLifetimeMs: runtimeLimits.maxSessionLifetimeMs,
    now,
  });
  if (!created.ok) {
    if (created.error.code !== "session_already_initialized") {
      await quota.releaseSession(sessionHandle, owner.actorId);
    }
    return created;
  }
  const current = await coordinator.toolGet(participant);
  if (!current.ok) {
    await coordinator.toolClose(participant, 0);
    return current;
  }
  return {
    ok: true,
    value: {
      ...toolView(current.value),
      expiresAt: created.value.expiresAt,
    },
  };
}

function registerRemoteBrowserTools(
  server: McpServer,
  env: Env,
  props: RemoteBrowserMcpProps,
): void {
  server.registerTool(
    "remote_browser_start",
    {
      title: "Start Remote Browser",
      description:
        "Start a real ephemeral Cloudflare Kitesurf session. Returns an opaque session handle, control epoch, and document revision for later tool calls.",
      inputSchema: z.strictObject({
        url: targetUrlSchema.describe("Initial page to open."),
        keepAliveMs: z
          .number()
          .int()
          .min(60_000)
          .max(600_000)
          .default(DEFAULT_KEEP_ALIVE_MS),
        viewport: browserViewportSchema
          .default(DEFAULT_BROWSER_VIEWPORT)
          .describe("CSS viewport dimensions and device emulation settings."),
      }),
      outputSchema: sessionViewSchema.extend({ expiresAt: z.iso.datetime() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url, keepAliveMs, viewport }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await createToolSession(
        env,
        authenticated.value,
        url,
        keepAliveMs,
        viewport,
      );
      return result.ok ? toolSuccess(result.value) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_share_session",
    {
      title: "Share Remote Browser Session",
      description:
        "Mint a short-lived, workspace-bound invitation for up to two participants. Only the durable room creator may share it.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        invitationToken: invitationTokenSchema,
        invitationExpiresAt: z.iso.datetime(),
        remainingUses: z.literal(2),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).shareSession(
        authenticated.value,
      );
      return result.ok
        ? toolSuccess({
          sessionHandle: result.value.sessionId,
          invitationToken: result.value.invitationToken,
          invitationExpiresAt: result.value.invitationExpiresAt,
          remainingUses: result.value.remainingUses,
        })
        : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_join_session",
    {
      title: "Join Remote Browser Session",
      description:
        "Join one existing Kitesurf room with the exact RB1 room code shown by Remote Browser. The legacy handle form remains available only for existing integrations and exact participant resumption.",
      inputSchema: joinSessionInputSchema,
      outputSchema: roomSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const invitation = "roomCode" in input
        ? decodeRemoteBrowserRoomCode(input.roomCode)
        : input;
      const result = await sessionCoordinator(env, invitation.sessionHandle).joinSession(
        authenticated.value,
        invitation.invitationToken,
      );
      return result.ok ? toolSuccess(roomResult(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_room",
    {
      title: "Inspect Remote Browser Room",
      description:
        "Read durable participant presence, the shared document revision, and the exact current controller.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: roomSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).room(
        authenticated.value,
      );
      return result.ok ? toolSuccess(roomResult(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_claim_control",
    {
      title: "Claim Remote Browser Control",
      description:
        "Claim exact participant control using a compare-and-swap epoch. Human claims are bounded leases; contention fails closed.",
      inputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        expectedControlEpoch: controlEpochSchema,
        leaseMs: z.number().int().min(60_000).max(600_000).default(120_000),
      }),
      outputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        control: controlSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionHandle, expectedControlEpoch, leaseMs }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).claimControl(
        authenticated.value,
        { expectedEpoch: expectedControlEpoch, leaseMs },
      );
      return result.ok
        ? toolSuccess({ sessionHandle, control: result.value })
        : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_release_control",
    {
      title: "Release Remote Browser Control",
      description:
        "Release only the calling participant's exact current control epoch without closing the shared browser.",
      inputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        expectedControlEpoch: controlEpochSchema,
      }),
      outputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        control: controlSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionHandle, expectedControlEpoch }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).releaseControl(
        authenticated.value,
        expectedControlEpoch,
      );
      return result.ok
        ? toolSuccess({ sessionHandle, control: result.value })
        : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_leave_session",
    {
      title: "Leave Remote Browser Session",
      description:
        "Disconnect the calling participant and release its control without closing the owner's Kitesurf session.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        participantId: z.string().regex(/^rp_[0-9a-f]{64}$/u),
        status: z.literal("disconnected"),
        control: controlSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).leaveSession(
        authenticated.value,
      );
      return result.ok
        ? toolSuccess({
          sessionHandle: result.value.sessionId,
          participantId: result.value.participantId,
          status: result.value.status,
          control: result.value.control,
        })
        : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_navigate",
    {
      title: "Navigate Remote Browser",
      description:
        "Navigate the Kitesurf session to an allowed HTTP(S) URL. Requires the latest control epoch and document revision so stale actions cannot affect a changed page.",
      inputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        url: targetUrlSchema,
        ...mutationGuardSchema,
      }),
      outputSchema: sessionViewSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (
      { sessionHandle, url, expectedControlEpoch, expectedDocumentRevision },
      context,
    ) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolNavigate(
        authenticated.value,
        {
        url,
        expectedControlEpoch,
        expectedDocumentRevision,
        },
      );
      return result.ok ? toolSuccess(toolView(result.value)) : toolError(result.error);
    },
  );

  const snapshotElementSchema = z.strictObject({
    ref: elementRefSchema.nullable(),
    role: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    value: z.string().nullable(),
    disabled: z.boolean(),
    focused: z.boolean(),
  });
  server.registerTool(
    "remote_browser_snapshot",
    {
      title: "Inspect Remote Browser Page",
      description:
        "Read the current page through its accessibility tree. Semantic elements include opaque refs accepted by guarded element tools; no inbound CSS selector or raw DOM capability is exposed.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: sessionViewSchema.extend({
        elements: z.array(snapshotElementSchema),
        truncated: z.boolean(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolSnapshot(
        authenticated.value,
      );
      if (!result.ok) return toolError(result.error);
      return toolSuccess({
        sessionHandle: result.value.sessionId,
        url: result.value.url,
        title: result.value.title,
        documentRevision: result.value.documentRevision,
        control: result.value.control,
        telemetryCoverageStartedAt: result.value.telemetryCoverageStartedAt,
        elements: result.value.elements,
        truncated: result.value.truncated,
      });
    },
  );

  const screenshotOutputSchema = sessionViewSchema.pick({
    sessionHandle: true,
    documentRevision: true,
    control: true,
    telemetryCoverageStartedAt: true,
  }).extend({
    mediaType: z.literal("image/png"),
    byteLength: z.number().int().positive(),
  });
  server.registerTool(
    "remote_browser_screenshot",
    {
      title: "Take Remote Browser Screenshot",
      description:
        "Capture the visible Kitesurf viewport as a real PNG image and return it as native MCP image content.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: screenshotOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolScreenshot(
        authenticated.value,
      );
      if (!result.ok) return toolError(result.error);
      const metadata = {
        sessionHandle: result.value.sessionId,
        documentRevision: result.value.documentRevision,
        control: result.value.control,
        telemetryCoverageStartedAt: result.value.telemetryCoverageStartedAt,
        mediaType: result.value.mediaType,
        byteLength: result.value.byteLength,
      };
      return {
        content: [
          {
            type: "image" as const,
            data: result.value.base64,
            mimeType: result.value.mediaType,
          },
          { type: "text" as const, text: JSON.stringify(metadata) },
        ],
        structuredContent: metadata,
      };
    },
  );

  const selectElementCommonSchema = {
    sessionHandle: sessionHandleSchema,
    representation: z.enum(["selector", "html", "png"]),
    ...mutationGuardSchema,
  } as const;
  const selectElementInputSchema = z.union([
    z.strictObject({
      ...selectElementCommonSchema,
      elementRef: elementRefSchema,
    }),
    z.strictObject({
      ...selectElementCommonSchema,
      xRatio: z.number().finite().min(0).max(1),
      yRatio: z.number().finite().min(0).max(1),
    }),
  ]);
  const selectElementOutputSchema = sessionViewSchema.pick({
    sessionHandle: true,
    documentRevision: true,
    control: true,
    telemetryCoverageStartedAt: true,
  }).extend({
    elementRef: elementRefSchema,
    representation: z.enum(["selector", "html", "png"]),
    selector: z.string().min(1).max(MAX_ELEMENT_SELECTOR_LENGTH).nullable(),
    html: z.string().min(1).max(MAX_ELEMENT_HTML_LENGTH).nullable(),
    mediaType: z.literal("image/png").nullable(),
    byteLength: z.number().int().min(1).max(MAX_ELEMENT_PNG_BYTES).nullable(),
  });
  server.registerTool(
    "remote_browser_select_element",
    {
      title: "Select Remote Browser Element",
      description:
        "Resolve an element from an opaque snapshot ref or normalized visible-viewport coordinates and return exactly one governed representation: a safe document-level selector, sanitized outer HTML, or an element-only PNG. Stale control epochs and document revisions fail closed.",
      inputSchema: selectElementInputSchema,
      outputSchema: selectElementOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const target = "elementRef" in input
        ? { ref: input.elementRef }
        : { xRatio: input.xRatio, yRatio: input.yRatio };
      const result = await sessionCoordinator(
        env,
        input.sessionHandle,
      ).toolSelectElement(authenticated.value, {
        ...target,
        representation: input.representation,
        expectedControlEpoch: input.expectedControlEpoch,
        expectedDocumentRevision: input.expectedDocumentRevision,
      });
      if (!result.ok) return toolError(result.error);
      const metadata = {
        sessionHandle: result.value.sessionId,
        elementRef: result.value.elementRef,
        documentRevision: result.value.documentRevision,
        control: result.value.control,
        telemetryCoverageStartedAt: result.value.telemetryCoverageStartedAt,
        representation: result.value.representation,
        selector: result.value.selector,
        html: result.value.html,
        mediaType: result.value.mediaType,
        byteLength: result.value.byteLength,
      };
      if (result.value.representation !== "png" || result.value.base64 === null) {
        return toolSuccess(metadata);
      }
      return {
        content: [
          {
            type: "image" as const,
            data: result.value.base64,
            mimeType: "image/png" as const,
          },
          { type: "text" as const, text: JSON.stringify(metadata) },
        ],
        structuredContent: metadata,
      };
    },
  );

  const pageOutputBase = {
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    telemetryGap: z.boolean(),
    telemetryCoverageStartedAt: telemetryStartedSchema,
  } as const;
  server.registerTool(
    "remote_browser_network",
    {
      title: "List Remote Browser Network Calls",
      description:
        "List bounded, redacted network calls observed through CDP. URLs omit credentials, queries, and fragments; headers and bodies are never returned.",
      inputSchema: pageInputSchema,
      outputSchema: z.strictObject({
        items: z.array(networkItemSchema),
        ...pageOutputBase,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sessionHandle, cursor, limit }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result: RpcResult<BrowserToolPage<BrowserToolNetworkRequest>> =
        await sessionCoordinator(env, sessionHandle).toolNetwork(
          authenticated.value,
          { cursor, limit },
        );
      return result.ok ? toolSuccess(pageResult(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_diagnostics",
    {
      title: "List Remote Browser Errors",
      description:
        "List bounded CDP diagnostics: page exceptions, console errors, failed requests, HTTP errors, CDP command failures, and telemetry gaps.",
      inputSchema: pageInputSchema,
      outputSchema: z.strictObject({
        items: z.array(diagnosticItemSchema),
        ...pageOutputBase,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sessionHandle, cursor, limit }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result: RpcResult<BrowserToolPage<BrowserToolDiagnostic>> =
        await sessionCoordinator(env, sessionHandle).toolDiagnostics(
          authenticated.value,
          { cursor, limit },
        );
      return result.ok ? toolSuccess(pageResult(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_click",
    {
      title: "Click Remote Browser Element",
      description:
        "Click an element returned by the latest page snapshot using native browser pointer events. Stale refs, control epochs, and document revisions fail closed.",
      inputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        elementRef: elementRefSchema,
        ...mutationGuardSchema,
      }),
      outputSchema: sessionViewSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      sessionHandle,
      elementRef,
      expectedControlEpoch,
      expectedDocumentRevision,
    }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolClick(
        authenticated.value,
        {
        ref: elementRef,
        expectedControlEpoch,
        expectedDocumentRevision,
        },
      );
      return result.ok ? toolSuccess(toolView(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_fill",
    {
      title: "Fill Remote Browser Input",
      description:
        "Fill a non-credential input returned by the latest page snapshot. Password, token, secret, OTP, and payment credential fields are refused. The value is never echoed or logged.",
      inputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        elementRef: elementRefSchema,
        value: z.string().max(10_000),
        ...mutationGuardSchema,
      }),
      outputSchema: sessionViewSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      sessionHandle,
      elementRef,
      value,
      expectedControlEpoch,
      expectedDocumentRevision,
    }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolFill(
        authenticated.value,
        {
        ref: elementRef,
        value,
        expectedControlEpoch,
        expectedDocumentRevision,
        },
      );
      return result.ok ? toolSuccess(toolView(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_scroll",
    {
      title: "Scroll Remote Browser Viewport",
      description:
        "Dispatch a bounded native wheel gesture at normalized viewport coordinates. Control epochs and document revisions fail closed.",
      inputSchema: scrollInputSchema,
      outputSchema: sessionViewSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      sessionHandle,
      xRatio,
      yRatio,
      deltaX,
      deltaY,
      expectedControlEpoch,
      expectedDocumentRevision,
    }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolScroll(
        authenticated.value,
        {
          xRatio,
          yRatio,
          deltaX,
          deltaY,
          expectedControlEpoch,
          expectedDocumentRevision,
        },
      );
      return result.ok ? toolSuccess(toolView(result.value)) : toolError(result.error);
    },
  );

  server.registerTool(
    "remote_browser_close",
    {
      title: "Close Remote Browser",
      description:
        "Close the ephemeral Kitesurf session and release its browser and workspace quota.",
      inputSchema: z.strictObject({ sessionHandle: sessionHandleSchema }),
      outputSchema: z.strictObject({
        sessionHandle: sessionHandleSchema,
        state: z.enum(["closing", "closed"]),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sessionHandle }, context) => {
      const authenticated = await attestedParticipant(context, props);
      if (!authenticated.ok) return toolError(authenticated.error);
      const result = await sessionCoordinator(env, sessionHandle).toolClose(
        authenticated.value,
        5_000,
      );
      return result.ok
        ? toolSuccess({ sessionHandle, state: result.value.state })
        : toolError(result.error);
    },
  );
}

export function createRemoteBrowserMcpServer(
  env: Env,
  props: RemoteBrowserMcpProps,
): McpServer {
  const server = new McpServer({
    name: "TAP Remote Browser",
    version: "0.3.0",
  });
  registerRemoteBrowserTools(server, env, props);
  return server;
}

export function createRemoteBrowserMcpHandler(
  env: Env,
  props: RemoteBrowserMcpProps,
) {
  return createMcpHandler(() => createRemoteBrowserMcpServer(env, props), {
    route: "/mcp",
    authContext: { props },
    legacy: "stateless",
  });
}

export class RemoteBrowserMcpEntrypoint extends WorkerEntrypoint<
  Env,
  RemoteBrowserMcpProps
> {
  override fetch(request: Request): Promise<Response> {
    if (!this.ctx.props.scopes.includes(REMOTE_BROWSER_MCP_SCOPE)) {
      return Promise.resolve(
        Response.json(
          {
            error: "insufficient_scope",
            error_description: "The access token does not grant Remote Browser tools.",
          },
          { status: 403 },
        ),
      );
    }
    return createRemoteBrowserMcpHandler(this.env, this.ctx.props).fetch(request);
  }
}
