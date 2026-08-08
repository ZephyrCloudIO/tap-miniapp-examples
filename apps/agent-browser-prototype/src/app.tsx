import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  captureSnapshot,
  type BrowserSnapshot,
  type GatewayContext,
} from "./browser-gateway";
import {
  cancelSavedBrowserSnapshotRun,
  canOpenWorkflowRunArtifact,
  hasWorkflowRunsV1,
  listSavedWorkflows,
  readWorkflowRunArtifact,
  runSavedBrowserSnapshot,
  type SavedWorkflowSummary,
  type WorkflowBrowserSnapshot,
} from "./workflow-snapshot";
import {
  availableEvidenceChannels,
  type EvidenceTab,
} from "./evidence-data";
import {
  containedFramePoint,
  representationLabel,
  type ElementPickPoint,
  type ElementRepresentation,
} from "./element-picker";
import {
  createRemoteBrowserMcpClient,
  type AuthorizeDeclaredMcpTool,
  type CallDeclaredMcpTool,
  type RemoteBrowserControl,
  type RemoteBrowserElementSelection,
  type RemoteBrowserMcpClient,
  type RemoteBrowserParticipant,
  type RemoteBrowserRoomState,
  type RemoteBrowserSessionState,
  type RemoteBrowserViewport,
} from "./remote-browser-mcp";
import {
  decodeRemoteBrowserRoomCode,
  encodeRemoteBrowserRoomCode,
} from "./room-code";
import {
  forgetRemoteBrowserSession,
  nextParticipantRejoinCycle,
  recalledRemoteBrowserSession,
  rejoinRemoteBrowserParticipant,
  rememberRemoteBrowserSession,
} from "./room-recovery";

// Three variants of a remote agent-browser workspace, switchable via
// `?variant=`, on this new prototype surface.
type Variant = "A" | "B" | "C";
type SurfaceExperience = "workflow" | "live" | "combined";
type ViewportPresetId = "desktop" | "laptop" | "mobile";

const VIEWPORT_PRESETS: Readonly<
  Record<ViewportPresetId, { readonly label: string; readonly viewport: RemoteBrowserViewport }>
> = {
  desktop: {
    label: "Desktop · 1440×900",
    viewport: { width: 1_440, height: 900, deviceScaleFactor: 1, mobile: false },
  },
  laptop: {
    label: "Laptop · 1280×800",
    viewport: { width: 1_280, height: 800, deviceScaleFactor: 1, mobile: false },
  },
  mobile: {
    label: "Mobile · 390×844 @2×",
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  },
};

export const LIVE_SURFACE_ID = "agent-browser-prototype";
export const WORKFLOW_SURFACE_ID = "agent-browser-workflow";

interface TimelineItem {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly detail: string;
  readonly tone: "neutral" | "good" | "warn";
}

interface AgentBrowserProps {
  readonly preview?: boolean;
  readonly hostContext?: TapFederatedSurfaceMountContext;
  /** Host-owned bridge for this exact package's signed MCP contributions. */
  readonly callDeclaredTool?: CallDeclaredMcpTool;
  /** Host-owned OAuth recovery for this exact package's signed MCP contributions. */
  readonly authorizeDeclaredTool?: AuthorizeDeclaredMcpTool;
}

interface ActiveBrowserSession {
  readonly sessionHandle: string;
  readonly requestedUrl: string;
  readonly expiresAt: string | null;
  readonly frameUrl: string | null;
  readonly frameWidth: number | null;
  readonly frameHeight: number | null;
  readonly room: RemoteBrowserRoomState | null;
  readonly snapshot: {
    readonly control: RemoteBrowserControl;
    readonly documentRevision: number;
    readonly visibleOrigin: string;
  };
  readonly connectionState:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";
}

interface RoomInvitationView {
  readonly code: string;
  readonly expiresAt: string;
  readonly remainingUses: number;
}

interface BrowserElementSelectionView extends RemoteBrowserElementSelection {
  readonly pngUrl: string | null;
}

interface PendingBrowserScroll {
  readonly sessionHandle: string;
  readonly point: ElementPickPoint;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly expectedControlEpoch: number;
  readonly expectedDocumentRevision: number;
}

interface WorkspaceModel {
  readonly preview: boolean;
  readonly experience: SurfaceExperience;
  readonly remoteBrowserToolsReady: boolean;
  readonly elementPickerReady: boolean;
  readonly workflowRunsReady: boolean;
  readonly targetUrl: string;
  readonly setTargetUrl: (value: string) => void;
  readonly viewportPreset: ViewportPresetId;
  readonly setViewportPreset: (value: ViewportPresetId) => void;
  readonly gatewayOrigin: string;
  readonly setGatewayOrigin: (value: string) => void;
  readonly previewBearer: string;
  readonly setPreviewBearer: (value: string) => void;
  readonly workflows: readonly SavedWorkflowSummary[];
  readonly workflowId: string;
  readonly setWorkflowId: (value: string) => void;
  readonly loadWorkflows: () => void;
  readonly activeWorkflowRunId: string;
  readonly cancelWorkflowRun: () => void;
  readonly cancelPending: boolean;
  readonly snapshot: BrowserSnapshot | null;
  readonly session: ActiveBrowserSession | null;
  readonly roomInvitation: RoomInvitationView | null;
  readonly joinRoomCode: string;
  readonly setJoinRoomCode: (value: string) => void;
  readonly elementPickerActive: boolean;
  readonly elementRepresentation: ElementRepresentation;
  readonly elementSelection: BrowserElementSelectionView | null;
  readonly timeline: readonly TimelineItem[];
  readonly status: string;
  readonly error: string;
  readonly mcpAuthorizationRequired: boolean;
  readonly busy:
    | ""
    | "snapshot"
    | "session"
    | "close"
    | "element"
    | "authorize"
    | "workflows"
    | "share"
    | "join"
    | "control"
    | "leave";
  readonly evidenceTab: EvidenceTab;
  readonly setEvidenceTab: (value: EvidenceTab) => void;
  readonly runSnapshot: () => void;
  readonly startSession: () => void;
  readonly closeSession: () => void;
  readonly shareSession: () => void;
  readonly joinSession: () => void;
  readonly claimRoomControl: () => void;
  readonly releaseRoomControl: () => void;
  readonly leaveSession: () => void;
  readonly setElementRepresentation: (value: ElementRepresentation) => void;
  readonly toggleElementPicker: () => void;
  readonly selectBrowserElement: (point: ElementPickPoint) => void;
  readonly scrollBrowser: (
    point: ElementPickPoint,
    deltaX: number,
    deltaY: number,
  ) => void;
  readonly clearElementSelection: () => void;
  readonly authorizeKitesurf: () => void;
}

const VARIANT_NAMES: Readonly<Record<Variant, string>> = {
  A: "Mission control",
  B: "Evidence desk",
  C: "Live browser",
};

const initialTimeline: readonly TimelineItem[] = [
  {
    id: "ready",
    at: "now",
    label: "Workspace ready",
    detail: "No browser resources have been allocated.",
    tone: "neutral",
  },
];

function surfaceExperience(
  preview: boolean,
  contributionId: string | undefined,
): SurfaceExperience {
  if (preview) return "combined";
  return contributionId === WORKFLOW_SURFACE_ID ? "workflow" : "live";
}

function initialVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function target(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete http:// or https:// target URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Remote Browser supports only HTTP and HTTPS targets.");
  }
  if (url.username || url.password) {
    throw new Error("Target URLs cannot contain credentials.");
  }
  url.hash = "";
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const value = Reflect.get(error, "code");
  return typeof value === "string" ? value : null;
}

function clock(): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

export function wheelDeltaPixels(
  delta: number,
  deltaMode: number,
  pageSize: number,
): number {
  if (!Number.isFinite(delta) || !Number.isFinite(pageSize) || pageSize <= 0) {
    return 0;
  }
  const pixels = deltaMode === 1
    ? delta * 24
    : deltaMode === 2
      ? delta * pageSize
      : delta;
  if (Math.abs(pixels) < 0.01) return 0;
  return Math.max(-2_400, Math.min(2_400, pixels));
}

const KITESURF_LABEL = "Kitesurf";
const TERMINAL_ROOM_RECOVERY_CODES = new Set([
  "invitation_invalid",
  "participant_not_joined",
  "session_not_active",
  "session_not_found",
]);

function selfParticipant(
  room: RemoteBrowserRoomState | null | undefined,
): RemoteBrowserParticipant | null {
  return room?.participants.find((participant) => participant.self) ?? null;
}

function controllerParticipant(
  room: RemoteBrowserRoomState | null | undefined,
): RemoteBrowserParticipant | null {
  const participantId = room?.control.participantId;
  return participantId
    ? room.participants.find((participant) => participant.participantId === participantId) ?? null
    : null;
}

function humanSessionLabels(
  room: RemoteBrowserRoomState,
): ReadonlyMap<string, string> {
  const humans = room.participants
    .filter((participant) => participant.kind === "human")
    .sort(
      (left, right) =>
        left.joinedAt.localeCompare(right.joinedAt) ||
        left.participantId.localeCompare(right.participantId),
    );
  return new Map(
    humans.map((participant, index) => [
      participant.participantId,
      `App ${index + 1}`,
    ]),
  );
}

function participantLabel(
  participant: RemoteBrowserParticipant | null,
  humanLabels?: ReadonlyMap<string, string>,
): string {
  if (!participant) return "Available";
  if (participant.kind === "human") {
    const sessionLabel =
      humanLabels?.get(participant.participantId) ??
      `App ${participant.participantId.slice(-6).toUpperCase()}`;
    return participant.self ? `You · ${sessionLabel}` : `Human · ${sessionLabel}`;
  }
  return participant.principalId;
}

function participantTitle(
  participant: RemoteBrowserParticipant,
  humanLabels: ReadonlyMap<string, string>,
): string {
  if (participant.kind === "agent") return participant.principalId;
  const owner = participant.self ? "Your application session" : participant.principalId;
  const sessionLabel =
    humanLabels.get(participant.participantId) ??
    `App ${participant.participantId.slice(-6).toUpperCase()}`;
  return `${owner} · opaque ${sessionLabel}`;
}

function viewerCount(room: RemoteBrowserRoomState | null | undefined): number {
  if (!room) return 0;
  return room.participants.filter((participant) => participant.status === "connected").length;
}

function selfIsController(room: RemoteBrowserRoomState | null | undefined): boolean {
  const self = selfParticipant(room);
  return Boolean(self && self.participantId === room?.control.participantId);
}

function selfIsCreator(room: RemoteBrowserRoomState | null | undefined): boolean {
  return selfParticipant(room)?.creator === true;
}

export async function settleRemoteBrowserSession(
  client: Pick<RemoteBrowserMcpClient, "leave" | "close">,
  sessionHandle: string,
  disposition: "leave" | "close",
): Promise<void> {
  if (disposition === "close") {
    await client.close(sessionHandle);
  } else {
    await client.leave(sessionHandle);
  }
}

function workflowSnapshot(
  value: BrowserSnapshot | null,
): value is WorkflowBrowserSnapshot {
  return value !== null && "workflowRunId" in value;
}

function snapshotHeading(snapshot: BrowserSnapshot): string {
  if (snapshot.title === null) return "Title not reported";
  return snapshot.title.length === 0 ? "Empty page title" : snapshot.title;
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function inlinePngByteLength(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return payload.length / 4 * 3 - padding;
}

function evidenceTiming(snapshot: BrowserSnapshot): string {
  const values: string[] = [];
  if (snapshot.browserMs !== null) {
    values.push(`${snapshot.browserMs.toLocaleString()} ms browser`);
  }
  if (workflowSnapshot(snapshot) && snapshot.runDurationMs !== null) {
    values.push(`${snapshot.runDurationMs.toLocaleString()} ms workflow`);
  }
  return values.length === 0 ? "" : ` · ${values.join(" · ")}`;
}

function evidenceDetail(snapshot: BrowserSnapshot, tab: EvidenceTab): string {
  if (tab === "visual") {
    if (
      snapshot.screenshotDataUrl !== null &&
      snapshot.screenshotDataUrl.startsWith("data:image/png;base64,")
    ) {
      return `image/png · ${inlinePngByteLength(snapshot.screenshotDataUrl).toLocaleString()} bytes`;
    }
    if (workflowSnapshot(snapshot) && snapshot.screenshotArtifact) {
      return snapshot.screenshotArtifact.byteLength === null
        ? snapshot.screenshotArtifact.mediaType
        : `${snapshot.screenshotArtifact.mediaType} · ${snapshot.screenshotArtifact.byteLength.toLocaleString()} bytes`;
    }
    return "image/png";
  }
  if (tab === "markdown") {
    return `${encodedByteLength(snapshot.markdown ?? "").toLocaleString()} bytes`;
  }
  if (tab === "content") {
    return `${encodedByteLength(snapshot.content ?? "").toLocaleString()} bytes`;
  }
  return `${encodedByteLength(JSON.stringify(snapshot.accessibilityTree)).toLocaleString()} JSON bytes`;
}

export function AgentBrowserApp({
  preview = false,
  hostContext,
  callDeclaredTool,
  authorizeDeclaredTool,
}: AgentBrowserProps) {
  const experience = surfaceExperience(preview, hostContext?.contributionId);
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [targetUrl, setTargetUrl] = useState("https://blog.cloudflare.com/kitesurf/");
  const [viewportPreset, setViewportPreset] =
    useState<ViewportPresetId>("desktop");
  const [gatewayOrigin, setGatewayOrigin] = useState("http://localhost:8787");
  const [previewBearer, setPreviewBearer] = useState("");
  const [workflows, setWorkflows] = useState<readonly SavedWorkflowSummary[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [activeWorkflowRunId, setActiveWorkflowRunId] = useState("");
  const [cancelPending, setCancelPending] = useState(false);
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [session, setSession] = useState<ActiveBrowserSession | null>(null);
  const [roomInvitation, setRoomInvitation] =
    useState<RoomInvitationView | null>(null);
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [timeline, setTimeline] = useState<readonly TimelineItem[]>(initialTimeline);
  const [status, setStatus] = useState("Ready — no browser resources allocated");
  const [error, setError] = useState("");
  const [mcpAuthorizationRequired, setMcpAuthorizationRequired] =
    useState(false);
  const [busy, setBusy] = useState<WorkspaceModel["busy"]>("");
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("visual");
  const [elementPickerActive, setElementPickerActive] = useState(false);
  const [elementRepresentation, setElementRepresentationState] =
    useState<ElementRepresentation>("selector");
  const [elementSelection, setElementSelection] =
    useState<BrowserElementSelectionView | null>(null);
  const remoteBrowserClient = useMemo(
    () => callDeclaredTool ? createRemoteBrowserMcpClient(callDeclaredTool) : null,
    [callDeclaredTool],
  );
  const remoteBrowserClientRef = useRef<RemoteBrowserMcpClient | null>(null);
  const activeSessionHandleRef = useRef<string | null>(null);
  const recoveryAttemptedForRef = useRef<string | null>(null);
  const framePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBrowserScrollRef = useRef<PendingBrowserScroll | null>(null);
  const browserScrollInFlightRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const remoteBrowserToolsReady = !preview && remoteBrowserClient !== null;
  const elementPickerReady =
    remoteBrowserToolsReady && session?.connectionState === "connected";
  const workflowRunsReady = !preview && hasWorkflowRunsV1();
  const hostInstanceId = hostContext?.instanceId;

  const record = useCallback(
    (label: string, detail: string, tone: TimelineItem["tone"] = "neutral") => {
      setTimeline((current) => [
        {
          id: crypto.randomUUID(),
          at: clock(),
          label,
          detail,
          tone,
        },
        ...current,
      ].slice(0, 8));
    },
    [],
  );

  const gatewayContext = useMemo<GatewayContext>(
    () => ({ preview, previewBearer }),
    [preview, previewBearer],
  );

  const stopFramePolling = useCallback(() => {
    if (framePollTimerRef.current !== null) {
      clearTimeout(framePollTimerRef.current);
      framePollTimerRef.current = null;
    }
  }, []);

  const clearElementSelection = useCallback(() => {
    setElementSelection(null);
  }, []);

  const releaseActiveBrowser = useCallback(
    async (
      disposition: "leave" | "close",
      updateUi = true,
      clearRecovery = true,
    ): Promise<void> => {
      sessionGenerationRef.current += 1;
      pendingBrowserScrollRef.current = null;
      stopFramePolling();
      const client = remoteBrowserClientRef.current;
      const sessionHandle = activeSessionHandleRef.current;
      remoteBrowserClientRef.current = null;
      activeSessionHandleRef.current = null;
      try {
        if (client && sessionHandle) {
          await settleRemoteBrowserSession(client, sessionHandle, disposition);
        }
      } finally {
        if (clearRecovery) {
          forgetRemoteBrowserSession(hostInstanceId);
        }
        if (updateUi) {
          setSession(null);
          setRoomInvitation(null);
          setElementPickerActive(false);
          clearElementSelection();
        }
      }
    },
    [clearElementSelection, hostInstanceId, stopFramePolling],
  );

  useEffect(() => {
    const leaveRoom = () => {
      void releaseActiveBrowser("leave", false, false).catch(() => undefined);
    };
    window.addEventListener("pagehide", leaveRoom);
    return () => {
      window.removeEventListener("pagehide", leaveRoom);
      leaveRoom();
    };
  }, [releaseActiveBrowser]);

  useEffect(() => {
    if (
      elementSelection &&
      session?.snapshot &&
      elementSelection.documentRevision !== session.snapshot.documentRevision
    ) {
      clearElementSelection();
    }
  }, [
    clearElementSelection,
    elementSelection,
    session?.snapshot?.documentRevision,
  ]);

  async function perform(
    kind: Exclude<WorkspaceModel["busy"], "">,
    work: () => Promise<void>,
  ): Promise<void> {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      await work();
    } catch (cause) {
      const message = errorMessage(cause);
      if (errorCode(cause) === "mcp_oauth_required") {
        setMcpAuthorizationRequired(true);
      }
      setError(message);
      setStatus("Action failed");
      record("Action blocked", message, "warn");
    } finally {
      setBusy("");
    }
  }

  function loadWorkflows(): void {
    void perform("workflows", async () => {
      if (preview) {
        setStatus("Preview uses the direct gateway and has no saved workflows");
        return;
      }
      const available = await listSavedWorkflows(hostContext?.workspaceId);
      setWorkflows(available);
      if (!available.some((item) => item.id === workflowId)) {
        setWorkflowId(available[0]?.id ?? "");
      }
      setStatus(
        `Found ${available.length} saved workflow${available.length === 1 ? "" : "s"}`,
      );
      record(
        "Saved workflows loaded",
        "Choose a workflow containing universal.browser.snapshot.",
        "good",
      );
    });
  }

  function runSnapshot(): void {
    void perform("snapshot", async () => {
      const url = target(targetUrl);
      setStatus(`Capturing ${KITESURF_LABEL} evidence…`);
      record("Snapshot requested", `${KITESURF_LABEL} · ${new URL(url).hostname}`);
      let result: BrowserSnapshot;
      if (preview) {
        result = await captureSnapshot(
          {
            gatewayOrigin,
            url,
            formats: ["screenshot", "markdown", "accessibilityTree", "content"],
          },
          gatewayContext,
        );
      } else {
        if (!workflowId) {
          throw new Error(
            "Load and select a saved workflow containing universal.browser.snapshot.",
          );
        }
        try {
          const workflowResult = await runSavedBrowserSnapshot({
            workflowId,
            url,
            formats: ["screenshot", "markdown", "accessibilityTree", "content"],
            waitUntil: "domcontentloaded",
            timeoutMs: 30_000,
            onRunStarted: (runId) => {
              setActiveWorkflowRunId(runId);
              record(
                "Workflow run started",
                `${runId} · durable host execution`,
                "good",
              );
            },
          });
          result = workflowResult;
          if (
            workflowResult.screenshotArtifact &&
            canOpenWorkflowRunArtifact()
          ) {
            try {
              const dataUrl = await readWorkflowRunArtifact(
                workflowResult.workflowRunId,
                workflowResult.screenshotArtifact,
              );
              if (dataUrl) {
                result = {
                  ...workflowResult,
                  screenshotDataUrl: dataUrl,
                };
              }
            } catch (cause) {
              record(
                "Screenshot retained",
                `${workflowResult.screenshotArtifact.artifactRef} · ${errorMessage(cause)}`,
                "warn",
              );
            }
          }
        } finally {
          setActiveWorkflowRunId("");
        }
      }

      const capturedChannels = availableEvidenceChannels(result);
      if (capturedChannels.length === 0) {
        throw new Error("Kitesurf returned none of the requested evidence formats.");
      }

      setSnapshot(result);
      setEvidenceTab(capturedChannels[0].id);
      setStatus(`Evidence captured${evidenceTiming(result)}`);
      record(
        "Evidence captured",
        `${snapshotHeading(result)} · ${capturedChannels.map(({ label }) => label).join(", ")}`,
        "good",
      );
    });
  }

  function cancelWorkflowRun(): void {
    if (!activeWorkflowRunId || cancelPending) return;
    const runId = activeWorkflowRunId;
    setCancelPending(true);
    setError("");
    void cancelSavedBrowserSnapshotRun(runId)
      .then((run) => {
        setStatus(`Workflow run ${run.status}`);
        record("Workflow cancellation requested", runId, "warn");
      })
      .catch((cause) => {
        const message = errorMessage(cause);
        setError(message);
        setStatus("Workflow cancellation was denied");
        record("Cancellation blocked", message, "warn");
      })
      .finally(() => setCancelPending(false));
  }

  const beginSessionPolling = useCallback(async (input: {
    readonly client: RemoteBrowserMcpClient;
    readonly generation: number;
    readonly sessionHandle: string;
    readonly requestedUrl: string;
    readonly expiresAt: string | null;
    readonly visibleOrigin: string;
    readonly initialControl: RemoteBrowserControl;
    readonly initialDocumentRevision: number;
    readonly initialRoom: RemoteBrowserRoomState | null;
    readonly retainRecoveryOnFailure?: boolean;
  }): Promise<void> => {
    remoteBrowserClientRef.current = input.client;
    activeSessionHandleRef.current = input.sessionHandle;
    rememberRemoteBrowserSession(hostInstanceId, input.sessionHandle);
    setSession(() => ({
      sessionHandle: input.sessionHandle,
      requestedUrl: input.requestedUrl,
      expiresAt: input.expiresAt,
      frameUrl: null,
      frameWidth: null,
      frameHeight: null,
      room: input.initialRoom,
      snapshot: {
        control: input.initialControl,
        documentRevision: input.initialDocumentRevision,
        visibleOrigin: input.visibleOrigin,
      },
      connectionState: "connecting",
    }));

    let firstFrame = true;
    let consecutiveParticipantRejoins = 0;

    const failClosedParticipantRecovery = async (cause: unknown): Promise<void> => {
      const code = errorCode(cause);
      await releaseActiveBrowser(
        "leave",
        true,
        code !== null && TERMINAL_ROOM_RECOVERY_CODES.has(code),
      ).catch(() => undefined);
      const message = errorMessage(cause);
      if (code === "mcp_oauth_required") {
        setMcpAuthorizationRequired(true);
      }
      setError(message);
      setStatus("This application session left the shared browser room");
      record("Room rejoin stopped", message, "warn");
    };

    const refreshFrame = async (): Promise<void> => {
      if (
        sessionGenerationRef.current !== input.generation ||
        activeSessionHandleRef.current !== input.sessionHandle
      ) {
        return;
      }
      let pollImmediately = false;
      try {
        const [frame, room] = await Promise.all([
          input.client.screenshot(input.sessionHandle),
          input.client.room(input.sessionHandle),
        ]);
        if (
          sessionGenerationRef.current !== input.generation ||
          activeSessionHandleRef.current !== input.sessionHandle
        ) {
          return;
        }
        const nextFrameUrl = frame.pngDataUrl;
        setSession((current) =>
          current?.sessionHandle === input.sessionHandle
            ? {
                ...current,
                frameUrl: nextFrameUrl,
                frameWidth: frame.width,
                frameHeight: frame.height,
                room,
                snapshot: {
                  ...current.snapshot,
                  control: frame.control,
                  documentRevision: frame.documentRevision,
                },
                connectionState: "connected",
              }
            : current,
        );
        setError("");
        setMcpAuthorizationRequired(false);
        setStatus(
          `Shared Remote Browser connected · ${viewerCount(room)} viewing`,
        );
        consecutiveParticipantRejoins = 0;
        firstFrame = false;
      } catch (cause) {
        if (errorCode(cause) === "participant_disconnected") {
          try {
            consecutiveParticipantRejoins = nextParticipantRejoinCycle(
              consecutiveParticipantRejoins,
            );
          } catch (budgetFailure) {
            await failClosedParticipantRecovery(budgetFailure);
            return;
          }

          setElementPickerActive(false);
          clearElementSelection();
          setError("");
          setStatus("Rejoining this application session to the shared browser…");
          setSession((current) =>
            current?.sessionHandle === input.sessionHandle
              ? { ...current, connectionState: "reconnecting" }
              : current,
          );

          try {
            const joined = await rejoinRemoteBrowserParticipant(
              input.client,
              input.sessionHandle,
              {
                isCurrent: () =>
                  sessionGenerationRef.current === input.generation &&
                  activeSessionHandleRef.current === input.sessionHandle,
              },
            );
            if (!joined) return;
            setSession((current) =>
              current?.sessionHandle === input.sessionHandle
                ? {
                    ...current,
                    room: joined,
                    snapshot: {
                      ...current.snapshot,
                      control: joined.control,
                      documentRevision: joined.documentRevision,
                    },
                    connectionState: "reconnecting",
                  }
                : current,
            );
            setStatus("Application session rejoined · refreshing browser frame…");
            record(
              "Application session rejoined",
              `${participantLabel(selfParticipant(joined))} · document ${joined.documentRevision}`,
              "good",
            );
            firstFrame = false;
            pollImmediately = true;
          } catch (rejoinFailure) {
            const rejectInitialConnection = firstFrame;
            await failClosedParticipantRecovery(rejoinFailure);
            if (rejectInitialConnection) throw rejoinFailure;
            return;
          }
        } else {
          if (firstFrame) throw cause;
          const message = errorMessage(cause);
          if (errorCode(cause) === "mcp_oauth_required") {
            setMcpAuthorizationRequired(true);
          }
          setError(message);
          setStatus("Remote browser room refresh failed");
          setSession((current) =>
            current?.sessionHandle === input.sessionHandle
              ? { ...current, connectionState: "error" }
              : current,
          );
          record("Room refresh blocked", message, "warn");
        }
      }
      if (
        sessionGenerationRef.current === input.generation &&
        activeSessionHandleRef.current === input.sessionHandle
      ) {
        framePollTimerRef.current = setTimeout(() => {
          framePollTimerRef.current = null;
          void refreshFrame();
        }, pollImmediately ? 0 : firstFrame ? 3_000 : 1_500);
      }
    };
    try {
      await refreshFrame();
    } catch (cause) {
      await releaseActiveBrowser(
        "leave",
        true,
        input.retainRecoveryOnFailure !== true,
      );
      throw cause;
    }
  }, [clearElementSelection, hostInstanceId, record, releaseActiveBrowser]);

  useEffect(() => {
    if (
      preview ||
      !remoteBrowserClient ||
      !hostInstanceId ||
      session ||
      recoveryAttemptedForRef.current === hostInstanceId
    ) {
      return;
    }
    recoveryAttemptedForRef.current = hostInstanceId;
    const sessionHandle = recalledRemoteBrowserSession(hostInstanceId);
    if (!sessionHandle) return;

    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    setStatus("Reconnecting to the shared Remote Browser room…");
    void remoteBrowserClient
      .join({ sessionHandle })
      .then(async (joined) => {
        if (sessionGenerationRef.current !== generation) return;
        await beginSessionPolling({
          client: remoteBrowserClient,
          generation,
          sessionHandle: joined.sessionHandle,
          requestedUrl: "Shared Remote Browser room",
          expiresAt: null,
          visibleOrigin: "Shared room",
          initialControl: joined.control,
          initialDocumentRevision: joined.documentRevision,
          initialRoom: joined,
          retainRecoveryOnFailure: true,
        });
        record(
          "Shared room restored",
          `${viewerCount(joined)} connected participants`,
          "good",
        );
      })
      .catch((cause) => {
        if (sessionGenerationRef.current !== generation) return;
        const code = errorCode(cause);
        if (code && TERMINAL_ROOM_RECOVERY_CODES.has(code)) {
          forgetRemoteBrowserSession(hostInstanceId);
        }
        const message = errorMessage(cause);
        if (code === "mcp_oauth_required") {
          setMcpAuthorizationRequired(true);
        }
        setError(message);
        setStatus("Could not restore the previous Remote Browser room");
        record("Room recovery blocked", message, "warn");
      });
  }, [
    beginSessionPolling,
    hostInstanceId,
    preview,
    record,
    remoteBrowserClient,
    session,
  ]);

  function startSession(): void {
    void perform("session", async () => {
      const url = target(targetUrl);
      if (session) {
        await releaseActiveBrowser(selfIsCreator(session.room) ? "close" : "leave");
      }
      setStatus("Allocating a Remote Browser session…");
      if (preview) {
        throw new Error("Live sessions require a TAP host with mcpTools.v1.");
      }
      if (!remoteBrowserClient) {
        throw new Error(
          "This TAP host does not expose signed declared MCP tool calls to miniapps.",
        );
      }

      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;
      const started: RemoteBrowserSessionState = await remoteBrowserClient.start({
        url,
        keepAliveMs: 600_000,
        viewport: VIEWPORT_PRESETS[viewportPreset].viewport,
      });
      setMcpAuthorizationRequired(false);
      if (sessionGenerationRef.current !== generation) {
        await remoteBrowserClient.close(started.sessionHandle);
        return;
      }
      await beginSessionPolling({
        client: remoteBrowserClient,
        generation,
        sessionHandle: started.sessionHandle,
        requestedUrl: url,
        expiresAt: started.expiresAt,
        visibleOrigin: new URL(started.url).origin,
        initialControl: started.control,
        initialDocumentRevision: started.documentRevision,
        initialRoom: null,
      });
      record(
        "Live room allocated",
        `${KITESURF_LABEL} · browser expires ${new Date(started.expiresAt).toLocaleTimeString()}`,
        "good",
      );
    });
  }

  function joinSession(): void {
    void perform("join", async () => {
      if (preview || !remoteBrowserClient) {
        throw new Error("Joining a room requires a TAP host with signed Remote Browser tools.");
      }
      if (session) await releaseActiveBrowser("leave");
      const invitation = decodeRemoteBrowserRoomCode(joinRoomCode);
      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;
      setStatus("Joining shared Remote Browser room…");
      const joined = await remoteBrowserClient.join(invitation);
      if (sessionGenerationRef.current !== generation) {
        await remoteBrowserClient.leave(joined.sessionHandle);
        return;
      }
      setJoinRoomCode("");
      setRoomInvitation(null);
      await beginSessionPolling({
        client: remoteBrowserClient,
        generation,
        sessionHandle: joined.sessionHandle,
        requestedUrl: "Shared Remote Browser room",
        expiresAt: null,
        visibleOrigin: "Shared room",
        initialControl: joined.control,
        initialDocumentRevision: joined.documentRevision,
        initialRoom: joined,
      });
      record(
        "Shared room joined",
        `${joined.participants.filter((participant) => participant.status === "connected").length} connected participants`,
        "good",
      );
    });
  }

  function shareSession(): void {
    void perform("share", async () => {
      const client = remoteBrowserClientRef.current;
      if (!client || !session || !selfIsCreator(session.room)) {
        throw new Error("Only the browser owner can create a room code.");
      }
      const invitation = await client.share(session.sessionHandle);
      setRoomInvitation({
        code: encodeRemoteBrowserRoomCode(invitation),
        expiresAt: invitation.invitationExpiresAt,
        remainingUses: invitation.remainingUses,
      });
      setStatus("Room code ready to share");
      record(
        "Room code created",
        `${invitation.remainingUses} joins · expires ${new Date(invitation.invitationExpiresAt).toLocaleTimeString()}`,
        "good",
      );
    });
  }

  function claimRoomControl(): void {
    void perform("control", async () => {
      const client = remoteBrowserClientRef.current;
      if (!client || !session?.room) {
        throw new Error("The shared browser room is unavailable.");
      }
      const claimed = await client.claimControl({
        sessionHandle: session.sessionHandle,
        expectedControlEpoch: session.room.control.epoch,
        leaseMs: 120_000,
      });
      setSession((current) =>
        current?.sessionHandle === claimed.sessionHandle && current.room
          ? {
              ...current,
              room: { ...current.room, control: claimed.control },
              snapshot: { ...current.snapshot, control: claimed.control },
            }
          : current,
      );
      setStatus("You control the shared browser for up to 2 minutes");
      record("Control claimed", `epoch ${claimed.control.epoch}`, "good");
    });
  }

  function releaseRoomControl(): void {
    void perform("control", async () => {
      const client = remoteBrowserClientRef.current;
      if (!client || !session?.room || !selfIsController(session.room)) {
        throw new Error("You do not hold browser control.");
      }
      const released = await client.releaseControl({
        sessionHandle: session.sessionHandle,
        expectedControlEpoch: session.room.control.epoch,
      });
      setSession((current) =>
        current?.sessionHandle === released.sessionHandle && current.room
          ? {
              ...current,
              room: { ...current.room, control: released.control },
              snapshot: { ...current.snapshot, control: released.control },
            }
          : current,
      );
      setStatus("Browser control released");
      record("Control released", `epoch ${released.control.epoch}`, "good");
    });
  }

  function leaveSession(): void {
    if (!session) return;
    void perform("leave", async () => {
      await releaseActiveBrowser("leave");
      setStatus("Left the shared room; the browser is still running");
      record("Room left", "Browser resources remain available to the room.", "good");
    });
  }

  function closeSession(): void {
    if (!session) return;
    void perform("close", async () => {
      if (!selfIsCreator(session.room)) {
        throw new Error("Only the browser owner can end this browser.");
      }
      await releaseActiveBrowser("close");
      setStatus("Remote Browser ended and resources released");
      record("Browser ended", "Remote resources released.", "good");
    });
  }

  function authorizeKitesurf(): void {
    void perform("authorize", async () => {
      if (!authorizeDeclaredTool) {
        throw new Error(
          "This TAP host cannot start Kitesurf authorization for miniapps.",
        );
      }
      await authorizeDeclaredTool({
        toolContributionId: "remote-browser-start",
      });
      setMcpAuthorizationRequired(false);
      setError("");
      setStatus("Remote Browser authorization opened — complete it, then start again");
      record(
        "Kitesurf authorization opened",
        "The host opened its OAuth flow; credentials never enter this miniapp.",
        "good",
      );
    });
  }

  function changeElementRepresentation(value: ElementRepresentation): void {
    setElementRepresentationState(value);
    clearElementSelection();
  }

  function toggleElementPicker(): void {
    if (elementPickerActive) {
      setElementPickerActive(false);
      setStatus("Element selection cancelled");
      return;
    }
    if (!session?.frameUrl) {
      setError("Start a live session and wait for its first frame before selecting an element.");
      setStatus("Element picker unavailable");
      return;
    }
    if (session.connectionState !== "connected") {
      setError("Wait for this application session to rejoin the shared browser room.");
      setStatus("Element picker unavailable while reconnecting");
      return;
    }
    if (!remoteBrowserClientRef.current) {
      setError(
        "This TAP host does not expose signed Remote Browser tool calls.",
      );
      setStatus("Element picker unavailable");
      return;
    }
    setError("");
    setElementPickerActive(true);
    setStatus(
      `Select an element to return its ${representationLabel(elementRepresentation)} representation`,
    );
  }

  function selectBrowserElement(point: ElementPickPoint): void {
    if (!elementPickerActive) return;
    void perform("element", async () => {
      const client = remoteBrowserClientRef.current;
      if (!client || !session || session.connectionState !== "connected") {
        throw new Error("The live browser session is unavailable.");
      }
      const expectedControlEpoch = session.snapshot.control.epoch;
      const expectedDocumentRevision = session.snapshot.documentRevision;
      const selected = await client.selectElement({
        sessionHandle: session.sessionHandle,
        point,
        representation: elementRepresentation,
        expectedControlEpoch,
        expectedDocumentRevision,
      });
      let pngUrl: string | null = null;
      if (selected.pngDataUrl) pngUrl = selected.pngDataUrl;
      setElementSelection({ ...selected, pngUrl });
      setElementPickerActive(false);
      setStatus(
        `Element selected as ${representationLabel(selected.representation)}`,
      );
      record(
        "Element selected",
        `${selected.elementRef} · ${representationLabel(selected.representation)} · document ${selected.documentRevision}`,
        "good",
      );
    });
  }

  function scrollBrowser(
    point: ElementPickPoint,
    deltaX: number,
    deltaY: number,
  ): void {
    const client = remoteBrowserClientRef.current;
    if (
      !client ||
      !session ||
      session.connectionState !== "connected" ||
      !selfIsController(session.room) ||
      (deltaX === 0 && deltaY === 0)
    ) {
      return;
    }

    const next: PendingBrowserScroll = {
      sessionHandle: session.sessionHandle,
      point,
      deltaX,
      deltaY,
      expectedControlEpoch: session.snapshot.control.epoch,
      expectedDocumentRevision: session.snapshot.documentRevision,
    };
    const pending = pendingBrowserScrollRef.current;
    pendingBrowserScrollRef.current = pending &&
      pending.sessionHandle === next.sessionHandle &&
      pending.expectedControlEpoch === next.expectedControlEpoch &&
      pending.expectedDocumentRevision === next.expectedDocumentRevision
      ? {
          ...next,
          deltaX: Math.max(-2_400, Math.min(2_400, pending.deltaX + next.deltaX)),
          deltaY: Math.max(-2_400, Math.min(2_400, pending.deltaY + next.deltaY)),
        }
      : next;

    if (browserScrollInFlightRef.current) return;
    browserScrollInFlightRef.current = true;
    const generation = sessionGenerationRef.current;
    void (async () => {
      while (pendingBrowserScrollRef.current) {
        const scroll = pendingBrowserScrollRef.current;
        pendingBrowserScrollRef.current = null;
        if (scroll.deltaX === 0 && scroll.deltaY === 0) continue;
        await client.scroll(scroll);
      }
      if (
        generation !== sessionGenerationRef.current ||
        activeSessionHandleRef.current !== next.sessionHandle
      ) {
        return;
      }
      const frame = await client.screenshot(next.sessionHandle);
      setSession((current) =>
        current?.sessionHandle === next.sessionHandle
          ? {
              ...current,
              frameUrl: frame.pngDataUrl,
              frameWidth: frame.width,
              frameHeight: frame.height,
              snapshot: {
                ...current.snapshot,
                control: frame.control,
                documentRevision: frame.documentRevision,
              },
            }
          : current,
      );
      setError("");
      setStatus("Remote browser scrolled");
    })().catch((cause) => {
      if (generation !== sessionGenerationRef.current) return;
      const message = errorMessage(cause);
      pendingBrowserScrollRef.current = null;
      if (errorCode(cause) === "mcp_oauth_required") {
        setMcpAuthorizationRequired(true);
      }
      setError(message);
      setStatus("Remote browser scroll failed");
      record("Scroll blocked", message, "warn");
    }).finally(() => {
      browserScrollInFlightRef.current = false;
      if (pendingBrowserScrollRef.current) {
        const pendingScroll = pendingBrowserScrollRef.current;
        pendingBrowserScrollRef.current = null;
        scrollBrowser(
          pendingScroll.point,
          pendingScroll.deltaX,
          pendingScroll.deltaY,
        );
      }
    });
  }

  const model: WorkspaceModel = {
    preview,
    experience,
    remoteBrowserToolsReady,
    elementPickerReady,
    workflowRunsReady,
    targetUrl,
    setTargetUrl,
    viewportPreset,
    setViewportPreset,
    gatewayOrigin,
    setGatewayOrigin,
    previewBearer,
    setPreviewBearer,
    workflows,
    workflowId,
    setWorkflowId,
    loadWorkflows,
    activeWorkflowRunId,
    cancelWorkflowRun,
    cancelPending,
    snapshot,
    session,
    roomInvitation,
    joinRoomCode,
    setJoinRoomCode,
    elementPickerActive,
    elementRepresentation,
    elementSelection,
    timeline,
    status,
    error,
    mcpAuthorizationRequired,
    busy,
    evidenceTab,
    setEvidenceTab,
    runSnapshot,
    startSession,
    closeSession,
    shareSession,
    joinSession,
    claimRoomControl,
    releaseRoomControl,
    leaveSession,
    setElementRepresentation: changeElementRepresentation,
    toggleElementPicker,
    selectBrowserElement,
    scrollBrowser,
    clearElementSelection,
    authorizeKitesurf,
  };

  const effectiveVariant =
    experience === "workflow" ? "B" : experience === "live" ? "C" : variant;

  return (
    <div className="agent-browser-root">
      {effectiveVariant === "A" ? <VariantA model={model} /> : null}
      {effectiveVariant === "B" ? <VariantB model={model} /> : null}
      {effectiveVariant === "C" ? <VariantC model={model} /> : null}
      {experience === "combined" ? (
        <PrototypeSwitcher current={variant} onChange={setVariant} />
      ) : null}
    </div>
  );
}

type RoomHeaderModel = Pick<
  WorkspaceModel,
  | "experience"
  | "session"
  | "roomInvitation"
  | "joinRoomCode"
  | "setJoinRoomCode"
  | "busy"
  | "joinSession"
  | "shareSession"
  | "claimRoomControl"
  | "releaseRoomControl"
>;

export function RoomHeaderControls({ model }: { readonly model: RoomHeaderModel }) {
  if (model.experience === "workflow") return null;
  if (!model.session) {
    return (
      <div className="room-join" data-browser-input="true">
        <label>
          <span className="sr-only">Room code</span>
          <input
            value={model.joinRoomCode}
            onChange={(event) => model.setJoinRoomCode(event.target.value)}
            placeholder="Room code"
            spellCheck={false}
            autoComplete="off"
            aria-label="Room code"
            onKeyDown={(event) => {
              if (event.key === "Enter") model.joinSession();
            }}
          />
        </label>
        <button
          className="button button--secondary"
          onClick={model.joinSession}
          disabled={Boolean(model.busy) || model.joinRoomCode.trim().length === 0}
        >
          {model.busy === "join" ? "Joining…" : "Join"}
        </button>
      </div>
    );
  }

  const room = model.session.room;
  if (!room) {
    return <span className="room-loading">Loading room…</span>;
  }
  const controller = controllerParticipant(room);
  const controlling = selfIsController(room);
  const creator = selfIsCreator(room);
  const viewers = viewerCount(room);
  const connectedParticipants = room.participants.filter(
    (participant) => participant.status === "connected",
  );
  const humanLabels = humanSessionLabels(room);
  const roomInteractive = model.session.connectionState === "connected";
  return (
    <div className="room-controls" aria-label="Shared browser room">
      <span className="room-presence" title={`${room.state} room`}>
        <strong>{viewers}</strong> viewing
      </span>
      <div
        className="room-roster"
        role="list"
        aria-label={`Connected participants (${viewers})`}
      >
        {connectedParticipants.map((participant) => (
          <span
            key={participant.participantId}
            className={`room-participant room-participant--${participant.kind}`}
            role="listitem"
            title={participantTitle(participant, humanLabels)}
          >
            <i aria-hidden="true" />
            {participantLabel(participant, humanLabels)}
            {participant.participantId === room.control.participantId ? (
              <span className="sr-only"> (controller)</span>
            ) : null}
          </span>
        ))}
      </div>
      <span className="room-controller" title={controller?.principalId ?? "No current controller"}>
        Controller <strong>{participantLabel(controller, humanLabels)}</strong>
      </span>
      {creator ? (
        <button
          className="button button--quiet room-action"
          onClick={model.shareSession}
          disabled={Boolean(model.busy) || !roomInteractive}
        >
          {model.busy === "share" ? "Sharing…" : "Share"}
        </button>
      ) : null}
      {!controlling ? (
        <button
          className="button button--primary room-action"
          onClick={model.claimRoomControl}
          disabled={Boolean(model.busy) || !roomInteractive}
        >
          {model.busy === "control" ? "Claiming…" : "Take control"}
        </button>
      ) : (
        <button
          className="button button--quiet room-action"
          onClick={model.releaseRoomControl}
          disabled={Boolean(model.busy) || !roomInteractive}
        >
          {model.busy === "control" ? "Releasing…" : "Release"}
        </button>
      )}
      {model.roomInvitation ? (
        <label
          className="room-code"
          title={`Expires ${new Date(model.roomInvitation.expiresAt).toLocaleTimeString()} · ${model.roomInvitation.remainingUses} joins remaining`}
        >
          <span className="sr-only">Shareable room code</span>
          <input
            readOnly
            value={model.roomInvitation.code}
            aria-label="Shareable room code"
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      ) : null}
    </div>
  );
}

function UrlControls({ model, compact = false }: {
  readonly model: WorkspaceModel;
  readonly compact?: boolean;
}) {
  const allowsWorkflow = model.experience !== "live";
  const allowsLive = model.experience !== "workflow";
  return (
    <div className={`url-controls${compact ? " url-controls--compact" : ""}`}>
      <label className="url-field">
        <span className="sr-only">Target URL</span>
        <span className="url-lock" aria-hidden="true">◈</span>
        <input
          value={model.targetUrl}
          onChange={(event) => model.setTargetUrl(event.target.value)}
          placeholder="https://example.com"
          spellCheck={false}
        />
      </label>
      {allowsLive ? (
        <label className="viewport-preset">
          <span className="sr-only">Browser resolution</span>
          <select
            aria-label="Browser resolution"
            value={model.viewportPreset}
            onChange={(event) =>
              model.setViewportPreset(event.target.value as ViewportPresetId)
            }
            disabled={Boolean(model.busy)}
          >
            {(Object.keys(VIEWPORT_PRESETS) as ViewportPresetId[]).map((id) => (
              <option key={id} value={id}>{VIEWPORT_PRESETS[id].label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {allowsWorkflow ? (
        <button
          className="button button--primary"
          onClick={model.runSnapshot}
          disabled={Boolean(model.busy)}
        >
          {model.busy === "snapshot" ? "Capturing…" : "Capture"}
        </button>
      ) : null}
      {allowsLive ? (
        <button
          className="button button--secondary"
          onClick={model.startSession}
          disabled={Boolean(model.busy)}
        >
          {model.busy === "session" ? "Starting…" : "Start live"}
        </button>
      ) : null}
      {allowsWorkflow && model.activeWorkflowRunId ? (
        <button
          className="button button--danger"
          onClick={model.cancelWorkflowRun}
          disabled={model.cancelPending}
        >
          {model.cancelPending ? "Cancelling…" : "Cancel run"}
        </button>
      ) : null}
    </div>
  );
}

function ConnectionSettings({ model }: { readonly model: WorkspaceModel }) {
  const allowsWorkflow = model.experience !== "live";
  const allowsLive = model.experience !== "workflow";
  return (
    <details className="connection-settings">
      <summary>
        {model.experience === "workflow"
          ? "Workflow execution"
          : model.experience === "live"
            ? "Session runtime"
            : "Workflow & preview gateway"}
      </summary>
      <div className="settings-grid">
        <p className="settings-warning">
          {allowsWorkflow && allowsLive
            ? "Packaged snapshots run as durable saved workflows. Live sessions use this package's signed Remote Browser tools; gateway credentials never enter this frame."
            : allowsWorkflow
              ? "Durable captures invoke a saved workflow; browser and artifact credentials stay with the workflow host."
              : "Live sessions use host-owned signed Remote Browser tool calls; gateway credentials never enter this frame."}
        </p>
        {allowsWorkflow && !model.preview ? (
          <label>
            <span>Saved browser workflow</span>
            <select
              aria-label="Saved browser workflow"
              value={model.workflowId}
              onChange={(event) => model.setWorkflowId(event.target.value)}
            >
              <option value="">Choose a saved workflow</option>
              {model.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name} · {workflow.type}
                </option>
              ))}
            </select>
          </label>
        ) : allowsWorkflow ? (
          <label>
            <span>Preview gateway origin</span>
            <input
              value={model.gatewayOrigin}
              onChange={(event) => model.setGatewayOrigin(event.target.value)}
              spellCheck={false}
            />
          </label>
        ) : null}
        {model.preview ? (
          <label>
            <span>Preview gateway token</span>
            <input
              type="password"
              value={model.previewBearer}
              onChange={(event) => model.setPreviewBearer(event.target.value)}
              autoComplete="off"
            />
            <small>Kept only until this tab closes.</small>
          </label>
        ) : null}
        {allowsWorkflow && !model.preview ? (
          <button
            className="button button--quiet"
            onClick={model.loadWorkflows}
            disabled={Boolean(model.busy)}
          >
            {model.busy === "workflows" ? "Loading…" : "Load saved workflows"}
          </button>
        ) : null}
        {model.activeWorkflowRunId ? (
          <p className="settings-warning">
            Active durable run: <code>{model.activeWorkflowRunId}</code>
          </p>
        ) : null}
      </div>
    </details>
  );
}

const ELEMENT_REPRESENTATIONS: readonly ElementRepresentation[] = [
  "selector",
  "html",
  "png",
];

function ElementPickerToolbar({ model }: { readonly model: WorkspaceModel }) {
  const unavailableReason = !model.session?.frameUrl
    ? "Wait for the first live browser frame."
    : model.session.connectionState !== "connected"
      ? "Wait for this application session to rejoin the room."
    : !model.elementPickerReady
      ? "This host needs remote element hit-testing."
      : undefined;
  return (
    <div
      className="element-picker-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="element-format-toggle"
        role="group"
        aria-label="Element output format"
      >
        {ELEMENT_REPRESENTATIONS.map((representation) => (
          <button
            key={representation}
            type="button"
            aria-pressed={model.elementRepresentation === representation}
            className={
              model.elementRepresentation === representation ? "active" : ""
            }
            onClick={() => model.setElementRepresentation(representation)}
            disabled={model.busy === "element"}
          >
            {representationLabel(representation)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`element-picker-button${model.elementPickerActive ? " active" : ""}`}
        onClick={model.toggleElementPicker}
        disabled={Boolean(model.busy) || Boolean(unavailableReason)}
        title={unavailableReason}
        aria-pressed={model.elementPickerActive}
      >
        <span aria-hidden="true">⌖</span>
        {model.elementPickerActive ? "Cancel" : "Select element"}
      </button>
    </div>
  );
}

function ElementSelectionResult({ model }: { readonly model: WorkspaceModel }) {
  const selection = model.elementSelection;
  if (!selection) return null;
  return (
    <section
      className="element-selection-result"
      aria-label="Selected element output"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <span>Selected element</span>
          <strong>{representationLabel(selection.representation)}</strong>
        </div>
        <button
          type="button"
          onClick={model.clearElementSelection}
          aria-label="Close selected element output"
        >
          ×
        </button>
      </header>
      {selection.representation === "selector" && selection.selector ? (
        <pre>{selection.selector}</pre>
      ) : null}
      {selection.representation === "html" && selection.html ? (
        <pre>{selection.html}</pre>
      ) : null}
      {selection.representation === "png" && selection.pngUrl ? (
        <img src={selection.pngUrl} alt="Selected remote page element" />
      ) : null}
      <footer>
        <code>{selection.elementRef}</code>
        <span>
          document {selection.documentRevision}
          {selection.byteLength === null
            ? ""
            : ` · ${selection.byteLength.toLocaleString()} bytes`}
        </span>
      </footer>
    </section>
  );
}

function BrowserViewport({ model, liveFirst = false }: {
  readonly model: WorkspaceModel;
  readonly liveFirst?: boolean;
}) {
  const frameImageRef = useRef<HTMLImageElement | null>(null);

  const liveFrame = model.session?.frameUrl;
  if (liveFrame) {
    const controlled = selfIsController(model.session?.room);
    return (
      <div
        className={`browser-viewport browser-viewport--live${controlled ? " browser-viewport--controlled" : ""}${model.elementPickerActive ? " browser-viewport--picking" : ""}`}
        role="region"
        aria-label="Remote browser viewport"
        title={controlled
          ? "Scroll or use a trackpad over the remote page"
          : "Take control of the shared browser to scroll the remote page"}
        tabIndex={0}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          if (model.elementPickerActive) {
            event.preventDefault();
          }
        }}
        onPointerUp={(event) => {
          if (model.elementPickerActive) {
            const frameImage = frameImageRef.current;
            const frameWidth = model.session?.frameWidth;
            const frameHeight = model.session?.frameHeight;
            if (frameImage && frameWidth && frameHeight) {
              const selectedPoint = containedFramePoint(
                frameImage.getBoundingClientRect(),
                { width: frameWidth, height: frameHeight },
                event.clientX,
                event.clientY,
              );
              if (selectedPoint) model.selectBrowserElement(selectedPoint);
            }
          }
        }}
        onWheel={(event) => {
          if (!controlled || model.elementPickerActive) return;
          const frameImage = frameImageRef.current;
          const frameWidth = model.session?.frameWidth;
          const frameHeight = model.session?.frameHeight;
          if (!frameImage || !frameWidth || !frameHeight) return;
          const point = containedFramePoint(
            frameImage.getBoundingClientRect(),
            { width: frameWidth, height: frameHeight },
            event.clientX,
            event.clientY,
          );
          if (!point) return;
          const deltaX = wheelDeltaPixels(event.deltaX, event.deltaMode, frameWidth);
          const deltaY = wheelDeltaPixels(event.deltaY, event.deltaMode, frameHeight);
          if (deltaX === 0 && deltaY === 0) return;
          event.preventDefault();
          model.scrollBrowser(point, deltaX, deltaY);
        }}
        onKeyDown={(event) => {
          if (model.elementPickerActive) {
            if (event.key === "Escape") model.toggleElementPicker();
          }
        }}
      >
        <div className="viewport-chrome">
          <span><i /> {model.session?.snapshot?.visibleOrigin || "Remote browser"}</span>
          <div className="viewport-chrome__actions">
            <span>
              Remote Browser · {model.session?.connectionState}
            </span>
            <ElementPickerToolbar model={model} />
          </div>
        </div>
        <img
          ref={frameImageRef}
          src={liveFrame}
          draggable={false}
          alt="Current host-mediated remote browser frame"
        />
        {model.elementPickerActive ? (
          <div className="element-picker-instruction" role="status">
            Click an element for {representationLabel(model.elementRepresentation)}
            <kbd>Esc</kbd>
          </div>
        ) : null}
        <ElementSelectionResult model={model} />
      </div>
    );
  }

  if (model.snapshot?.screenshotDataUrl) {
    const name = snapshotHeading(model.snapshot);
    return (
      <div className="browser-viewport">
        <div className="viewport-chrome">
          <span><i /> {name}</span>
          <span>
            {model.snapshot.status === null
              ? model.snapshot.engine
              : `${model.snapshot.status} · ${model.snapshot.engine}`}
          </span>
        </div>
        <img
          src={model.snapshot.screenshotDataUrl}
          alt={`Captured page: ${name}`}
        />
        {model.session ? (
          <div className="browser-session-ribbon">
            Waiting for the first host-mediated frame
          </div>
        ) : null}
      </div>
    );
  }

  const liveExperience = liveFirst || model.experience === "live";
  return (
    <div className="browser-viewport browser-viewport--empty">
      <div className="empty-orbit" aria-hidden="true"><span>↗</span></div>
      <p className="eyebrow">No remote browser allocated</p>
      <h2>
        {model.experience === "workflow"
          ? "Collect durable browser evidence."
          : liveExperience
            ? "Open a remote browser for live inspection."
            : "Give the agent a view of the web."}
      </h2>
      <p>
        {model.experience === "workflow"
          ? "Capture invokes a saved workflow and returns bounded, durable evidence."
          : liveExperience
            ? "Start live opens a shared session through this package's signed Remote Browser tools."
            : "Capture produces bounded evidence. Start live opens a shared session through signed Remote Browser tools."}
      </p>
      <button
        className="button button--primary"
        onClick={
          liveExperience ? model.startSession : model.runSnapshot
        }
        disabled={Boolean(model.busy)}
      >
        {liveExperience ? "Start remote browser" : "Capture first evidence"}
      </button>
    </div>
  );
}

function EvidencePanel({ model }: { readonly model: WorkspaceModel }) {
  const channels = availableEvidenceChannels(model.snapshot);
  if (!model.snapshot) {
    return (
      <section className="evidence-panel evidence-panel--empty">
        <p className="eyebrow">Evidence</p>
        <h3>No capture yet</h3>
        <p>Capture evidence to populate this panel with data returned by Kitesurf.</p>
      </section>
    );
  }

  const activeTab = channels.some(({ id }) => id === model.evidenceTab)
    ? model.evidenceTab
    : channels[0]?.id;
  const activeChannel = channels.find(({ id }) => id === activeTab);
  return (
    <section className="evidence-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Captured evidence</p>
          <h3>{snapshotHeading(model.snapshot)}</h3>
        </div>
        <span className="verified-chip">
          {channels.length} {channels.length === 1 ? "format" : "formats"}
        </span>
      </div>
      <p className="evidence-meta">
        <span>
          {model.snapshot.finalUrl ? "Final URL" : "Requested URL"}: {model.snapshot.finalUrl ?? model.snapshot.requestedUrl}
        </span>
        <time dateTime={model.snapshot.receivedAt}>
          Received locally {new Date(model.snapshot.receivedAt).toLocaleTimeString()}
        </time>
      </p>
      <p className="evidence-provenance-note">
        {model.snapshot.engine}
        {model.snapshot.status === null ? "" : ` · HTTP ${model.snapshot.status}`}
        {evidenceTiming(model.snapshot)} · {channels.length} independently loaded {channels.length === 1 ? "format" : "formats"}; this is a capture set, not one atomic page state.
      </p>
      {channels.length > 1 ? (
        <div className="tab-row" role="tablist" aria-label="Available evidence formats">
          {channels.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              className={activeTab === id ? "active" : ""}
              onClick={() => model.setEvidenceTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {activeTab && activeChannel ? (
        <p className="evidence-channel-meta">
          <span>{activeChannel.label}</span>
          <span>{evidenceDetail(model.snapshot, activeTab)}</span>
        </p>
      ) : null}
      {activeTab ? (
        <EvidenceBody model={model} tab={activeTab} />
      ) : (
        <div className="evidence-empty">Kitesurf returned no evidence fields.</div>
      )}
    </section>
  );
}

function EvidenceBody({ model, tab }: {
  readonly model: WorkspaceModel;
  readonly tab: EvidenceTab;
}) {
  if (!model.snapshot) {
    return <div className="evidence-empty">No captured data is available.</div>;
  }
  if (tab === "visual") {
    return model.snapshot.screenshotDataUrl ? (
      <img className="evidence-image" src={model.snapshot.screenshotDataUrl} alt="Browser snapshot evidence" />
    ) : workflowSnapshot(model.snapshot) && model.snapshot.screenshotArtifact ? (
      <div className="evidence-empty">
        Screenshot stored as durable artifact.
        <code>{model.snapshot.screenshotArtifact.artifactRef}</code>
        <small>
          {model.snapshot.screenshotArtifact.mediaType}
          {model.snapshot.screenshotArtifact.byteLength === null
            ? ""
            : ` · ${model.snapshot.screenshotArtifact.byteLength.toLocaleString()} bytes`}
        </small>
      </div>
    ) : <div className="evidence-empty">No screenshot returned.</div>;
  }
  const text =
    tab === "markdown"
      ? model.snapshot.markdown
      : tab === "content"
        ? model.snapshot.content
        : model.snapshot.accessibilityTree === null
          ? null
          : JSON.stringify(model.snapshot.accessibilityTree, null, 2);
  return text === null ? (
    <div className="evidence-empty">No {tab} field was returned.</div>
  ) : text.length === 0 ? (
    <div className="evidence-empty">Kitesurf returned an empty {tab} document.</div>
  ) : (
    <pre className="evidence-code">{text}</pre>
  );
}

function Timeline({ model }: { readonly model: WorkspaceModel }) {
  const activityScope =
    model.experience === "workflow"
      ? "Durable workflow"
      : model.session
        ? "Shared session"
        : "Activity";
  return (
    <section className="timeline-panel">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">{activityScope}</p>
          <h3>Activity</h3>
        </div>
        <span className="count-chip">{model.timeline.length}</span>
      </div>
      <ol>
        {model.timeline.map((item) => (
          <li key={item.id} className={`timeline-item timeline-item--${item.tone}`}>
            <span className="timeline-node" aria-hidden="true" />
            <div><strong>{item.label}</strong><p>{item.detail}</p></div>
            <time>{item.at}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StatusStrip({ model }: { readonly model: WorkspaceModel }) {
  return (
    <div
      className={`status-strip${model.error ? " status-strip--error" : ""}`}
      role={model.error ? "alert" : "status"}
    >
      <span>{model.error ? "!" : "●"}</span>
      <p>{model.error || model.status}</p>
      {model.mcpAuthorizationRequired ? (
        <button
          className="button button--quiet status-strip__action"
          onClick={model.authorizeKitesurf}
          disabled={Boolean(model.busy)}
        >
          {model.busy === "authorize" ? "Opening…" : "Connect Remote Browser"}
        </button>
      ) : null}
      <span className="status-scope">
        {workflowSnapshot(model.snapshot)
          ? "Workflow-owned evidence"
          : model.snapshot
            ? "Current tab only"
            : "No evidence"}
      </span>
    </div>
  );
}

export function VariantA({ model }: { readonly model: WorkspaceModel }) {
  return (
    <main className="variant variant-a">
      <header className="mission-header">
        <RoomHeaderControls model={model} />
        {model.session ? (
          <div className="mission-header-actions">
            <button
              className="button button--danger"
              onClick={selfIsCreator(model.session.room) ? model.closeSession : model.leaveSession}
              disabled={Boolean(model.busy)}
            >
              {selfIsCreator(model.session.room)
                ? model.busy === "close" ? "Ending…" : "End browser"
                : model.busy === "leave" ? "Leaving…" : "Leave room"}
            </button>
          </div>
        ) : null}
      </header>
      <section className="mission-command">
        <UrlControls model={model} />
        <ConnectionSettings model={model} />
      </section>
      <div className="mission-grid">
        <section className="mission-stage">
          <BrowserViewport model={model} />
          <StatusStrip model={model} />
        </section>
        <aside className="mission-rail">
          <Timeline model={model} />
          <EvidencePanel model={model} />
        </aside>
      </div>
    </main>
  );
}

export function VariantB({ model }: { readonly model: WorkspaceModel }) {
  const channels = availableEvidenceChannels(model.snapshot);
  const captureName = model.snapshot ? snapshotHeading(model.snapshot) : model.targetUrl;
  return (
    <main className="variant variant-b">
      <header className="evidence-header">
        <div className="evidence-header__artifact">
          <p className="eyebrow">{model.snapshot ? "Evidence" : "Target"}</p>
          <h1>{captureName}</h1>
        </div>
      </header>
      <div className="evidence-workspace">
        <aside className="evidence-request">
          <p className="eyebrow">01 · Request</p>
          <h2>Frame the run</h2>
          <label>
            <span>Target</span>
            <textarea
              value={model.targetUrl}
              onChange={(event) => model.setTargetUrl(event.target.value)}
              rows={4}
            />
          </label>
          <button className="button button--primary button--wide" onClick={model.runSnapshot} disabled={Boolean(model.busy)}>
            {model.busy === "snapshot" ? "Collecting evidence…" : "Collect evidence"}
          </button>
          {model.activeWorkflowRunId ? (
            <button
              className="button button--danger button--wide"
              onClick={model.cancelWorkflowRun}
              disabled={model.cancelPending}
            >
              {model.cancelPending ? "Cancelling…" : "Cancel workflow run"}
            </button>
          ) : null}
          <ConnectionSettings model={model} />
          <StatusStrip model={model} />
        </aside>
        <section className={`evidence-canvas evidence-canvas--${channels.length || "empty"}`}>
          {model.snapshot && channels.length > 0 ? channels.map(({ id, label }) => (
            <div key={id} className={`artifact artifact--${id}`}>
              <div className="artifact-heading">
                <span>{label}</span>
                <small>{evidenceDetail(model.snapshot as BrowserSnapshot, id)}</small>
              </div>
              <EvidenceBody model={model} tab={id} />
            </div>
          )) : (
            <div className="artifact artifact--empty">
              <p className="eyebrow">Evidence</p>
              <h2>No capture yet</h2>
              <p>Collect evidence to display only the formats returned by Kitesurf.</p>
            </div>
          )}
        </section>
        <aside className="provenance-rail">
          <p className="eyebrow">02 · Provenance</p>
          {model.snapshot ? (
            <dl>
              <div><dt>Engine</dt><dd>{model.snapshot.engine}</dd></div>
              <div><dt>Formats</dt><dd>{channels.map(({ label }) => label).join(", ")}</dd></div>
              <div><dt>Capture model</dt><dd>Independent Kitesurf loads</dd></div>
              <div><dt>Requested URL</dt><dd>{model.snapshot.requestedUrl}</dd></div>
              <div><dt>Final URL</dt><dd>{model.snapshot.finalUrl ?? "Not reported"}</dd></div>
              <div><dt>Browser time</dt><dd>{model.snapshot.browserMs === null ? "Not reported" : `${model.snapshot.browserMs.toLocaleString()} ms`}</dd></div>
              {workflowSnapshot(model.snapshot) ? (
                <div><dt>Workflow run time</dt><dd>{model.snapshot.runDurationMs === null ? "Not reported" : `${model.snapshot.runDurationMs.toLocaleString()} ms`}</dd></div>
              ) : null}
              <div><dt>Received locally</dt><dd>{new Date(model.snapshot.receivedAt).toLocaleTimeString()}</dd></div>
              <div>
                <dt>App retention</dt>
                <dd>
                  {workflowSnapshot(model.snapshot)
                    ? model.snapshot.screenshotArtifact
                      ? "Workflow-owned durable screenshot"
                      : "Workflow-owned output"
                    : "Current tab only"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="provenance-empty">Capture evidence to see provenance reported by Kitesurf and the workflow host.</p>
          )}
          <Timeline model={model} />
        </aside>
      </div>
    </main>
  );
}

export function VariantC({ model }: { readonly model: WorkspaceModel }) {
  return (
    <main className="variant variant-c">
      <header className="handoff-header">
        <div
          className={`handoff-header__workspace${model.session ? " handoff-header__workspace--active" : ""}`}
        >
          {!model.session ? <UrlControls model={model} compact /> : null}
          <RoomHeaderControls model={model} />
        </div>
        {model.session ? (
          <button
            className="button button--danger room-terminal-action"
            onClick={selfIsCreator(model.session.room) ? model.closeSession : model.leaveSession}
            disabled={Boolean(model.busy)}
          >
            {selfIsCreator(model.session.room)
              ? model.busy === "close" ? "Ending…" : "End browser"
              : model.busy === "leave" ? "Leaving…" : "Leave room"}
          </button>
        ) : null}
      </header>
      <section className="handoff-stage">
        <BrowserViewport model={model} liveFirst />
        <div className="handoff-overlay">
          <span className="live-pill"><i /> {model.session ? "Remote Browser live" : "offline"}</span>
          {model.session?.expiresAt ? (
            <span>expires {new Date(model.session.expiresAt).toLocaleTimeString()}</span>
          ) : null}
        </div>
      </section>
      {model.error ? (
        <div className="handoff-error" role="alert">
          <span>{model.error}</span>
          {model.mcpAuthorizationRequired ? (
            <button
              className="button button--quiet"
              onClick={model.authorizeKitesurf}
              disabled={Boolean(model.busy)}
            >
              {model.busy === "authorize" ? "Opening…" : "Connect Remote Browser"}
            </button>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function PrototypeSwitcher({ current, onChange }: {
  readonly current: Variant;
  readonly onChange: (variant: Variant) => void;
}) {
  const variants: readonly Variant[] = ["A", "B", "C"];
  const change = useCallback((direction: -1 | 1) => {
    const index = variants.indexOf(current);
    const next = variants[(index + direction + variants.length) % variants.length];
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.history.replaceState(null, "", url);
    onChange(next);
  }, [current, onChange]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (
        element?.matches("input, textarea, select, [contenteditable='true']") ||
        element?.closest("[data-browser-input='true']")
      ) return;
      if (event.key === "ArrowLeft") change(-1);
      if (event.key === "ArrowRight") change(1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [change]);

  if (process.env.NODE_ENV === "production") return null;
  return (
    <nav className="prototype-switcher" aria-label="Prototype variant switcher">
      <button onClick={() => change(-1)} aria-label="Previous variant">←</button>
      <span><strong>{current}</strong> — {VARIANT_NAMES[current]}</span>
      <button onClick={() => change(1)} aria-label="Next variant">→</button>
    </nav>
  );
}
