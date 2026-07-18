import "@theaiplatform/miniapp-sdk/ui/styles.css";
import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import type {
  MiniAppChannel,
  MiniAppPresenceParticipant,
  MiniAppSpecialistSummary,
  MiniAppWorkflow,
} from "@theaiplatform/miniapp-sdk/sdk";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  CodeBlock,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  H1,
  H2,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  MiniAppStatusBar,
  MiniAppToolbar,
  NativeSelect,
  Progress,
  Separator,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  AlertTriangle,
  AudioLines,
  Check,
  ChevronLeft,
  Clipboard,
  Disc3,
  Download,
  ExternalLink,
  EyeOff,
  Heart,
  Import,
  ListMusic,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Music2,
  Pause,
  Play,
  Radio,
  Redo2,
  RefreshCw,
  Repeat,
  Repeat1,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  WandSparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildSpecialistSummaryPrompt,
  extractTimelineCandidates,
  parseSpecialistSummary,
  specialistResponseText,
  type SummaryDraftFields,
  type TimelineCandidate,
} from "./conversation";
import {
  actorFeedback,
  applyChannelOperation,
  applyPreferenceOperation,
  buildPrompt,
  can,
  createDefaultPreferences,
  createEmptyChannelState,
  deriveRole,
  digestFile,
  digestText,
  importTrack as importTrackTransition,
  isQueueLow,
  markBriefExported,
  parsePlayerPreferences,
  promptFingerprint,
  recordBriefVote,
  recordTrackSkip,
  restoreRetiredTrack,
  retireTrack,
  reviewTrackVisibility,
  saveBriefVersion,
  saveSummary,
  selectNextTrackId,
  toggleTrackHidden,
  toggleTrackLike,
  trackLikeCount,
  validatePolicy,
  type BriefVote,
  type ChannelState,
  type ConversationSummary,
  type PlayerPreferences,
  type PlaylistPolicy,
  type PrivacyReview,
  type Role,
  type SongBrief,
  type SongBriefDraft,
  type SourceWindow,
  type Track,
  type TrackImportInput,
  type Visibility,
} from "./domain";
import { registerLifecycleParticipant, type LifecycleJson } from "./lifecycle-state";
import { getMediaStore } from "./media";
import {
  StorageConflictError,
  createPreviewStoragePort,
  createSdkStoragePort,
  loadChannelState,
  loadPlayerPreferences,
  saveChannelState,
  savePlayerPreferences,
  type StoragePort,
} from "./storage";
import { useAudioAnalysis, Visualizer } from "./visualizer";

type SurfaceStatus = "awaiting-authority" | "loading" | "ready" | "saving" | "running" | "error" | "conflict";
type TabName = "player" | "album" | "briefs" | "context" | "settings";

interface ImportFormState {
  title: string;
  contributor: string;
  provider: string;
  sourceUrl: string;
  sourcePeriod: string;
  rightsBasis: string;
  visibility: "private-draft" | "channel-only";
  explicit: boolean;
  instrumental: boolean;
  contentWarning: string;
  batchId: string;
  rights: boolean;
}

interface SummaryEditorState {
  summary: ConversationSummary;
  checks: Omit<PrivacyReview, "reviewedAt">;
}

interface BriefVoteEditorState extends BriefVote {
  briefTitle: string;
}

const operationId = (prefix: string): string => `${prefix}:${crypto.randomUUID()}`;
const now = (): string => new Date().toISOString();
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const errorMessage = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;
const formatTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
};
const channelTitle = (channels: readonly MiniAppChannel[], channelId: string): string => channels.find((channel) => channel.roomId === channelId)?.title ?? channelId;
const initialImportForm = (): ImportFormState => ({
  title: "",
  contributor: "",
  provider: "",
  sourceUrl: "",
  sourcePeriod: "",
  rightsBasis: "",
  visibility: "channel-only",
  explicit: false,
  instrumental: false,
  contentWarning: "",
  batchId: "",
  rights: false,
});
const initialPrivacyChecks = (): Omit<PrivacyReview, "reviewedAt"> => ({
  personalDataRemoved: false,
  secretsRemoved: false,
  sensitiveMomentsExcluded: false,
  quotationsApproved: false,
});

const createSummaryRecord = (
  sourceWindow: SourceWindow,
  provenance: "manual" | "tap-specialist",
  fields?: SummaryDraftFields,
  specialist?: MiniAppSpecialistSummary,
): ConversationSummary => ({
  id: crypto.randomUUID(),
  status: "draft",
  sourceWindow,
  safeSummary: fields?.safeSummary ?? "",
  themes: fields?.themes ?? "",
  emotionalArc: fields?.emotionalArc ?? "",
  privateDetailsRemoved: fields?.privateDetailsRemoved ?? "",
  candidateConcepts: fields?.candidateConcepts ?? "",
  exclusions: fields?.exclusions ?? "Personal data, secrets, credentials, customer names, project codenames, sensitive conflict, and unapproved direct quotations",
  provenance,
  specialistId: specialist?.id ?? null,
  specialistName: specialist?.displayName ?? null,
  privacyReview: null,
  createdAt: now(),
  approvedAt: null,
  rejectedAt: null,
});

const createBriefDraft = (state: ChannelState, summary?: ConversationSummary, previous?: SongBrief): SongBriefDraft => {
  const id = crypto.randomUUID();
  const candidateCount = state.policy.songsPerBatch;
  const draft: SongBriefDraft = {
    id,
    seriesId: previous?.seriesId ?? id,
    version: previous ? previous.version + 1 : 1,
    supersedesId: previous?.id ?? null,
    summaryId: summary?.id ?? previous?.summaryId ?? null,
    title: previous?.title ?? "",
    concept: previous?.concept ?? summary?.candidateConcepts ?? "",
    genre: previous?.genre ?? "",
    mood: previous?.mood ?? summary?.emotionalArc ?? "",
    instrumentation: previous?.instrumentation ?? "",
    tempo: previous?.tempo ?? "",
    vocalStyle: previous?.vocalStyle ?? "",
    structure: previous?.structure ?? "",
    lyricDirection: previous?.lyricDirection ?? "lyrics",
    explicitAllowed: previous?.explicitAllowed ?? false,
    desiredDuration: previous?.desiredDuration ?? "",
    sourcePeriod: previous?.sourcePeriod ?? summary?.sourceWindow.label ?? "",
    channelSummary: previous?.channelSummary ?? summary?.safeSummary ?? "",
    exclusions: previous?.exclusions ?? summary?.exclusions ?? "Personal data, secrets, credentials, customer names, project codenames, sensitive conflict, and unapproved direct quotations",
    outboundPrompt: "",
    candidateCount,
    createdAt: now(),
  };
  return draft;
};

const editDraft = (brief: SongBrief): SongBriefDraft => {
  const {
    status: _status,
    approvedAt: _approvedAt,
    exportedAt: _exportedAt,
    promptFingerprint: _promptFingerprint,
    ...draft
  } = brief;
  return draft;
};

const publish = async (
  context: TapFederatedSurfaceMountContext | undefined,
  name: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (context) await context.events.publish(name, payload);
};

export function PlayerApp({ preview, context }: { preview: boolean; context?: TapFederatedSurfaceMountContext }) {
  const mediaStore = useMemo(() => getMediaStore(preview), [preview]);
  const [authority, setAuthority] = useState(preview || (context?.hostAuthority.getSnapshot() ?? false));
  const [channels, setChannels] = useState<MiniAppChannel[]>([]);
  const [channelId, setChannelId] = useState(preview ? "browser-preview-channel" : context?.channelId ?? "");
  const [userKey, setUserKey] = useState(preview ? "browser-preview-user" : "");
  const [actorKey, setActorKey] = useState(preview ? "browser-preview-actor" : "");
  const [role, setRole] = useState<Role>(preview ? "channel-dj" : "listener");
  const [channelState, setChannelState] = useState<ChannelState | null>(null);
  const [preferences, setPreferences] = useState<PlayerPreferences | null>(null);
  const [status, setStatus] = useState<SurfaceStatus>(authority ? "loading" : "awaiting-authority");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<TabName>("player");
  const [conflict, setConflict] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mediaReady, setMediaReady] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<ChannelState | null>(null);
  const preferencesRef = useRef<PlayerPreferences | null>(null);
  const channelRevisionRef = useRef<number | null>(null);
  const preferencesRevisionRef = useRef<number | null>(null);
  const channelWriteRef = useRef<Promise<unknown>>(Promise.resolve());
  const preferencesWriteRef = useRef<Promise<unknown>>(Promise.resolve());
  const noticeTimerRef = useRef<number | null>(null);
  const lastPositionCheckpointRef = useRef(0);
  const attachAudio = useCallback((node: HTMLAudioElement | null): void => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);
  const currentTrack = channelState?.tracks.find((track) => track.id === preferences?.currentTrackId) ?? null;
  const analysis = useAudioAnalysis(audioElement);
  const storagePort = useMemo<StoragePort | null>(() => {
    if (preview) return createPreviewStoragePort();
    if (!authority) return null;
    return createSdkStoragePort();
  }, [authority, preview]);

  const showNotice = useCallback((message: string): void => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, 4_000);
  }, []);

  const reportError = useCallback((caught: unknown, fallback: string): void => {
    const isRevisionConflict = caught instanceof StorageConflictError;
    setConflict(isRevisionConflict);
    setStatus(isRevisionConflict ? "conflict" : "error");
    setError(errorMessage(caught, fallback));
  }, []);

  const installChannel = useCallback((value: ChannelState, revision: number | null): void => {
    channelRef.current = value;
    channelRevisionRef.current = revision;
    setChannelState(value);
  }, []);

  const installPreferences = useCallback((value: PlayerPreferences, revision: number | null): void => {
    preferencesRef.current = value;
    preferencesRevisionRef.current = revision;
    setPreferences(value);
  }, []);

  const commitChannel = useCallback((
    id: string,
    transition: (current: ChannelState) => ChannelState,
    successMessage: string,
  ): Promise<ChannelState> => {
    const write = channelWriteRef.current.then(async () => {
      const port = storagePort;
      const current = channelRef.current;
      if (!port || !current || !authority) throw new Error("TAP host authority is unavailable. No channel data was changed.");
      const next = transition(current);
      if (next === current) return current;
      setStatus("saving");
      setError("");
      const revision = await saveChannelState(port, next, channelRevisionRef.current);
      installChannel(next, revision);
      setStatus("ready");
      setConflict(false);
      showNotice(successMessage);
      return next;
    });
    channelWriteRef.current = write.catch(() => null);
    return write.catch((caught: unknown) => {
      reportError(caught, "The channel soundtrack could not be saved.");
      throw caught;
    });
  }, [authority, installChannel, reportError, showNotice, storagePort]);

  const commitPreferences = useCallback((
    id: string,
    transition: (current: PlayerPreferences) => PlayerPreferences,
    successMessage = "Player preferences saved",
    announce = false,
  ): Promise<PlayerPreferences> => {
    const write = preferencesWriteRef.current.then(async () => {
      const port = storagePort;
      const current = preferencesRef.current;
      if (!port || !current || !authority) throw new Error("TAP host authority is unavailable. No player preferences were changed.");
      const next = transition(current);
      if (next === current) return current;
      setStatus("saving");
      const revision = await savePlayerPreferences(port, next, preferencesRevisionRef.current);
      installPreferences(next, revision);
      setStatus("ready");
      setConflict(false);
      if (announce) showNotice(successMessage);
      return next;
    });
    preferencesWriteRef.current = write.catch(() => null);
    return write.catch((caught: unknown) => {
      reportError(caught, "Player preferences could not be saved.");
      throw caught;
    });
  }, [authority, installPreferences, reportError, showNotice, storagePort]);

  useEffect(() => {
    if (preview || !context) return;
    const update = (): void => setAuthority(context.hostAuthority.getSnapshot());
    update();
    return context.hostAuthority.subscribe(update);
  }, [context, preview]);

  useEffect(() => {
    if (authority) {
      if (status === "awaiting-authority") setStatus("loading");
      return;
    }
    audioRef.current?.pause();
    setPlaying(false);
    setStatus("awaiting-authority");
    setError("TAP has not granted this verified surface host authority. Protected controls remain disabled.");
  }, [authority, status]);

  useEffect(() => {
    let active = true;
    if (preview) {
      setChannels([{ roomId: "browser-preview-channel", title: "Browser preview", visibility: "private", archived: false, createdAt: Date.now(), updatedAt: Date.now() }]);
      return;
    }
    if (!authority) return;
    const loadChannels = async (): Promise<void> => {
      try {
        const result = await sdk.channels.list(context?.workspaceId ? { workspaceId: context.workspaceId } : {});
        if (active) setChannels(result.rooms.filter((channel) => !channel.archived));
      } catch (caught) {
        if (active) reportError(caught, "Visible channels could not be loaded.");
      }
    };
    void loadChannels();
    return () => {
      active = false;
    };
  }, [authority, context?.workspaceId, preview, reportError]);

  useEffect(() => {
    let active = true;
    if (preview) return;
    if (!authority || !context) return;
    const loadIdentity = async (): Promise<void> => {
      let identity = `installation:${context.installationId}`;
      try {
        const profile = await sdk.auth?.getUserProfile();
        if (profile?.sub) identity = `user:${profile.sub}`;
      } catch (caught) {
        if (active) setError(`Public profile was unavailable; preferences are installation-scoped. ${errorMessage(caught, "Profile access failed.")}`);
      }
      const digest = await digestText(identity);
      if (active) {
        setUserKey(digest.slice(0, 24));
        setActorKey(digest.slice(24, 48));
      }
    };
    void loadIdentity();
    return () => {
      active = false;
    };
  }, [authority, context, preview]);

  const reload = useCallback(async (): Promise<void> => {
    if (!channelId || !userKey || !storagePort || !authority) return;
    setStatus("loading");
    setError("");
    setConflict(false);
    try {
      let effectiveRole = role;
      if (!preview) {
        const access = await sdk.channels.getAccess(context?.workspaceId ? { workspaceId: context.workspaceId, channelId } : { channelId });
        if (!access.isParticipant || !access.capabilities.some((capability) => /read|view|timeline|message:create/i.test(capability))) {
          throw new Error("You do not have current access to this channel soundtrack.");
        }
        effectiveRole = deriveRole(access.capabilities);
        setRole(effectiveRole);
      }
      const [storedChannel, storedPreferences] = await Promise.all([
        loadChannelState(storagePort, channelId),
        loadPlayerPreferences(storagePort, userKey, channelId),
      ]);
      const nextChannel = storedChannel.value ?? createEmptyChannelState(channelId);
      const nextPreferences = storedPreferences.value ?? createDefaultPreferences(userKey, channelId);
      if (nextPreferences.currentTrackId && !nextChannel.tracks.some((track) => track.id === nextPreferences.currentTrackId && !track.retired)) {
        nextPreferences.currentTrackId = null;
        nextPreferences.position = 0;
      }
      installChannel(nextChannel, storedChannel.revision);
      installPreferences(nextPreferences, storedPreferences.revision);
      setProgress(nextPreferences.position);
      setStatus("ready");
    } catch (caught) {
      reportError(caught, "This channel soundtrack could not be loaded.");
    }
  }, [actorKey, authority, channelId, context?.workspaceId, installChannel, installPreferences, preview, reportError, role, storagePort, userKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const audio = audioRef.current;
    let active = true;
    if (!audio) return;
    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      setPlaying(false);
      setMediaReady(false);
      return;
    }
    const loadMedia = async (): Promise<void> => {
      try {
        const url = await mediaStore.getUrl(currentTrack.id);
        if (!active) return;
        if (!url) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          setPlaying(false);
          setMediaReady(false);
          return;
        }
        if (audio.src !== url) {
          audio.src = url;
          audio.load();
        }
        audio.volume = preferencesRef.current?.volume ?? 0.75;
        audio.muted = preferencesRef.current?.muted ?? false;
        const seek = (): void => {
          const position = Math.min(preferencesRef.current?.position ?? 0, Math.max(0, currentTrack.duration - 0.1));
          if (Number.isFinite(position)) audio.currentTime = position;
          setProgress(position);
          setMediaReady(true);
        };
        if (audio.readyState >= 1) seek();
        else audio.addEventListener("loadedmetadata", seek, { once: true });
      } catch (caught) {
        if (active) reportError(caught, "The owned audio file could not be restored.");
      }
    };
    void loadMedia();
    return () => {
      active = false;
    };
  }, [currentTrack, mediaStore, reportError]);

  const chooseTrack = useCallback(async (trackId: string, autoplay = false): Promise<void> => {
    const track = channelRef.current?.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.retired || actorFeedback(track, actorKey)?.hidden) {
      reportError(new Error("That track is not eligible for your current queue."), "Track selection failed.");
      return;
    }
    audioRef.current?.pause();
    setPlaying(false);
    setProgress(0);
    await commitPreferences(operationId("select-track"), (current) => applyPreferenceOperation(current, operationId("select-track-state"), (value) => ({ ...value, currentTrackId: trackId, position: 0 })), "Track selected");
    if (autoplay) window.setTimeout(() => void togglePlayRef.current?.(), 0);
  }, [actorKey, commitPreferences, reportError]);

  const skipTrack = useCallback(async (recordFeedback: boolean): Promise<void> => {
    const state = channelRef.current;
    const prefs = preferencesRef.current;
    if (!state || !prefs) return;
    const currentId = prefs.currentTrackId;
    if (recordFeedback && currentId) {
      await commitChannel(operationId("skip-feedback"), (current) => recordTrackSkip(current, currentId, actorKey, role, operationId("skip-transition")), "Skip preference recorded");
    }
    const nextId = selectNextTrackId(channelRef.current ?? state, preferencesRef.current ?? prefs, actorKey, 1);
    if (!nextId) {
      audioRef.current?.pause();
      setPlaying(false);
      showNotice("End of the eligible queue");
      return;
    }
    await chooseTrack(nextId, true);
  }, [actorKey, chooseTrack, commitChannel, role, showNotice]);

  const togglePlayRef = useRef<(() => Promise<void>) | null>(null);
  const togglePlay = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    const track = channelRef.current?.tracks.find((candidate) => candidate.id === preferencesRef.current?.currentTrackId);
    if (!audio || !track) return;
    if (!authority) {
      reportError(new Error("Playback is disabled while TAP host authority is absent."), "Playback could not start.");
      return;
    }
    const url = await mediaStore.getUrl(track.id);
    if (!url) {
      reportError(new Error(preview ? "The browser preview audio record is missing. Import the owned file again." : "TAP SDK 0.0.1 cannot read packaged binary artifacts after a page reload. Re-import this owned file to restore session playback."), "Audio is unavailable.");
      return;
    }
    if (!audio.src) {
      audio.src = url;
      audio.load();
    }
    if (audio.paused) {
      try {
        await analysis.resume();
        await audio.play();
        setPlaying(true);
        try {
          await publish(context, "player.track.started", { channelId, trackId: track.id });
        } catch (caught) {
          setError(`Playback started, but TAP could not publish the declared track event: ${errorMessage(caught, "event publication failed")}`);
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) reportError(caught, "Playback could not start.");
      }
    } else {
      audio.pause();
      setPlaying(false);
      const position = audio.currentTime;
      await commitPreferences(operationId("pause"), (current) => applyPreferenceOperation(current, operationId("pause-state"), (value) => ({ ...value, position })), "Playback position saved");
    }
  }, [analysis, authority, channelId, commitPreferences, context, mediaStore, preview, reportError]);
  togglePlayRef.current = togglePlay;

  const previousTrack = useCallback(async (): Promise<void> => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    const state = channelRef.current;
    const prefs = preferencesRef.current;
    if (!state || !prefs) return;
    const previousId = selectNextTrackId(state, prefs, actorKey, -1);
    if (previousId) await chooseTrack(previousId, true);
  }, [actorKey, chooseTrack]);

  useEffect(() => {
    const audio = audioElement;
    if (!audio) return;
    const onTimeUpdate = (): void => {
      setProgress(audio.currentTime);
      if (Math.abs(audio.currentTime - lastPositionCheckpointRef.current) >= 10 && preferencesRef.current) {
        lastPositionCheckpointRef.current = audio.currentTime;
        const position = audio.currentTime;
        void commitPreferences(operationId("position-checkpoint"), (current) => applyPreferenceOperation(current, operationId("position-state"), (value) => ({ ...value, position }))).catch(() => null);
      }
    };
    const onEnded = (): void => {
      setPlaying(false);
      const current = preferencesRef.current;
      if (current?.currentTrackId) {
        const recentlyPlayedIds = [...current.recentlyPlayedIds, current.currentTrackId].slice(-50);
        void commitPreferences(operationId("track-ended"), (value) => applyPreferenceOperation(value, operationId("track-ended-state"), (next) => ({ ...next, position: 0, recentlyPlayedIds }))).then(() => skipTrack(false)).catch(() => null);
      }
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioElement, commitPreferences, skipTrack]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlay();
      }
      if (event.code === "ArrowRight" && audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || Infinity, audioRef.current.currentTime + 5);
      if (event.code === "ArrowLeft" && audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePlay]);

  useEffect(() => {
    if (!context) return;
    return registerLifecycleParticipant(`player:${context.instanceId}`, {
      capture(): LifecycleJson {
        return preferencesRef.current ? { preferences: preferencesRef.current as unknown as LifecycleJson } : null;
      },
      restore(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        const candidate = parsePlayerPreferences((value as { preferences?: unknown }).preferences);
        if (candidate && candidate.channelId === channelRef.current?.channelId) installPreferences(candidate, preferencesRevisionRef.current);
      },
      async pause() {
        const audio = audioRef.current;
        if (!audio) return;
        audio.pause();
        setPlaying(false);
        if (preferencesRef.current) {
          const position = audio.currentTime;
          await commitPreferences(operationId("lifecycle-pause"), (current) => applyPreferenceOperation(current, operationId("lifecycle-pause-state"), (next) => ({ ...next, position })));
        }
      },
      resume() {
        setPlaying(false);
      },
    });
  }, [commitPreferences, context, installPreferences]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    audioRef.current?.pause();
    mediaStore.disposeUrls();
  }, [mediaStore]);

  const [presenceParticipants, setPresenceParticipants] = useState<MiniAppPresenceParticipant[]>([]);
  const presenceJoinedRef = useRef(false);
  useEffect(() => {
    if (preview || !authority || !preferences?.broadcastPresence || !channelId) {
      setPresenceParticipants([]);
      presenceJoinedRef.current = false;
      return;
    }
    const address = { namespace: "unofficial-suno-player", room: `channel/${channelId}/listening` };
    let active = true;
    const unsubscribe = sdk.presence.subscribe(address, (snapshot) => {
      if (active) setPresenceParticipants(snapshot.participants);
    });
    const join = async (): Promise<void> => {
      try {
        const snapshot = await sdk.presence.join({ ...address, state: { listening: playing, trackId: currentTrack?.id ?? null } });
        presenceJoinedRef.current = true;
        if (active) setPresenceParticipants(snapshot.participants);
      } catch (caught) {
        if (active) reportError(caught, "Listening presence could not be joined.");
      }
    };
    void join();
    return () => {
      active = false;
      unsubscribe();
      presenceJoinedRef.current = false;
      void Promise.resolve(sdk.presence.leave(address)).catch((caught: unknown) => setError(`Listening presence cleanup failed: ${errorMessage(caught, "leave failed")}`));
    };
  }, [authority, channelId, preferences?.broadcastPresence, preview, reportError]);

  useEffect(() => {
    if (preview || !authority || !preferences?.broadcastPresence || !presenceJoinedRef.current) return;
    const address = { namespace: "unofficial-suno-player", room: `channel/${channelId}/listening` };
    void Promise.resolve(sdk.presence.update({ ...address, state: { listening: playing, trackId: currentTrack?.id ?? null } })).catch((caught: unknown) => reportError(caught, "Listening presence could not be updated."));
  }, [authority, channelId, currentTrack?.id, playing, preferences?.broadcastPresence, preview, reportError]);

  const switchChannel = useCallback(async (nextChannelId: string): Promise<void> => {
    if (!nextChannelId || nextChannelId === channelId || status === "saving") return;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      const originalVolume = audio.volume;
      for (const factor of [0.75, 0.5, 0.25, 0]) {
        audio.volume = originalVolume * factor;
        await wait(45);
      }
      audio.pause();
      audio.volume = originalVolume;
    }
    setPlaying(false);
    setChannelState(null);
    setPreferences(null);
    channelRef.current = null;
    preferencesRef.current = null;
    setChannelId(nextChannelId);
  }, [channelId, status]);

  const initialize = async (): Promise<void> => {
    if (!can(role, "manage")) {
      reportError(new Error("Only a channel DJ can initialize a channel soundtrack."), "Initialization was denied.");
      return;
    }
    await commitChannel(operationId("initialize"), (current) => applyChannelOperation(current, operationId("initialize-state"), (state) => ({ ...state, enabled: true })), "Channel soundtrack initialized");
  };

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importForm, setImportForm] = useState<ImportFormState>(initialImportForm);

  const decodeDuration = async (file: File): Promise<number> => {
    const url = URL.createObjectURL(file);
    try {
      const audio = new Audio(url);
      return await new Promise<number>((resolve, reject) => {
        audio.onloadedmetadata = () => Number.isFinite(audio.duration) && audio.duration > 0 ? resolve(audio.duration) : reject(new Error("The selected file has no playable duration."));
        audio.onerror = () => reject(new Error("The selected file could not be decoded as audio."));
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const submitImport = async (): Promise<void> => {
    const state = channelRef.current;
    const file = importFile;
    if (!state || !file) return;
    if (!file.type.startsWith("audio/")) {
      reportError(new Error("Choose a browser-decodable audio file."), "Import failed.");
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      reportError(new Error("Audio files are limited to 250 MiB for this local decoder."), "Import failed.");
      return;
    }
    if (!importForm.rights) {
      reportError(new Error("Confirm the rights attestation before importing audio."), "Import failed.");
      return;
    }
    setStatus("running");
    setError("");
    try {
      const digest = await digestFile(file);
      const existing = state.tracks.find((track) => track.audioDigest === digest);
      if (existing) {
        await mediaStore.put(existing.id, file);
        if (preferencesRef.current?.currentTrackId === existing.id) setMediaReady(true);
        setImportOpen(false);
        setImportFile(null);
        setStatus("ready");
        showNotice(`Restored owned media for “${existing.title}”; existing provenance was preserved.`);
        return;
      }
      const duration = await decodeDuration(file);
      const id = crypto.randomUUID();
      const batch = state.batches.find((candidate) => candidate.id === importForm.batchId) ?? null;
      const input: TrackImportInput = {
        id,
        title: importForm.title.trim(),
        contributor: importForm.contributor.trim(),
        provider: importForm.provider.trim(),
        sourceUrl: importForm.sourceUrl.trim() || null,
        sourcePeriod: importForm.sourcePeriod.trim(),
        createdAt: now(),
        importedAt: now(),
        rightsBasis: importForm.rightsBasis.trim(),
        rightsAttested: true,
        briefId: batch?.briefId ?? null,
        batchId: batch?.id ?? null,
        audioDigest: digest,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        duration,
        mediaPersistence: mediaStore.persistence,
        visibility: importForm.visibility,
        explicit: importForm.explicit,
        instrumental: importForm.instrumental,
        contentWarning: importForm.contentWarning.trim(),
      };
      await mediaStore.put(id, file);
      try {
        await commitChannel(operationId("import"), (current) => importTrackTransition(current, input, role, operationId("import-state")), "Owned track imported with provenance");
      } catch (caught) {
        await mediaStore.remove(id);
        throw caught;
      }
      if (!preferencesRef.current?.currentTrackId) {
        await commitPreferences(operationId("select-import"), (current) => applyPreferenceOperation(current, operationId("select-import-state"), (value) => ({ ...value, currentTrackId: id, position: 0 })));
      }
      setImportOpen(false);
      setImportFile(null);
      setImportForm(initialImportForm());
      setTab("album");
    } catch (caught) {
      reportError(caught, "Owned audio could not be imported.");
    }
  };

  const [briefEditor, setBriefEditor] = useState<SongBriefDraft | null>(null);
  const [briefReviewed, setBriefReviewed] = useState(false);
  const [briefErrors, setBriefErrors] = useState<string[]>([]);
  const openBriefEditor = (draft: SongBriefDraft): void => {
    setBriefErrors([]);
    setBriefReviewed(false);
    setBriefEditor(draft);
  };
  const closeBriefEditor = (): void => {
    setBriefEditor(null);
    setBriefErrors([]);
    setBriefReviewed(false);
  };
  const exactDraftPrompt = briefEditor ? (briefEditor.outboundPrompt.trim() || buildPrompt(briefEditor as SongBrief)) : "";

  const submitBrief = async (approve: boolean): Promise<void> => {
    const state = channelRef.current;
    const draft = briefEditor;
    if (!state || !draft) return;
    if (approve && !briefReviewed) {
      setBriefErrors(["Confirm that you reviewed the exact outbound prompt before approval."]);
      return;
    }
    try {
      const candidate = { ...draft, outboundPrompt: exactDraftPrompt };
      await commitChannel(operationId("brief"), (current) => saveBriefVersion(current, candidate, {
        role,
        operationId: operationId("brief-state"),
        approve,
        batchId: crypto.randomUUID(),
      }), approve ? "Exact prompt approved for human-mediated generation" : "Song brief draft saved");
      if (approve) {
        try {
          await publish(context, "player.brief.approved", { channelId, briefId: draft.id, version: draft.version });
        } catch (caught) {
          setError(`The brief was saved, but its declared TAP event could not be published: ${errorMessage(caught, "event publication failed")}`);
        }
      }
      setBriefEditor(null);
      setBriefReviewed(false);
      setBriefErrors([]);
    } catch (caught) {
      if (caught instanceof Error && "issues" in caught) setBriefErrors((caught as Error & { issues: string[] }).issues);
      else reportError(caught, "The song brief could not be saved.");
    }
  };

  const copyApprovedPrompt = async (brief: SongBrief): Promise<void> => {
    try {
      await navigator.clipboard.writeText(brief.outboundPrompt);
    } catch (caught) {
      reportError(caught, "Clipboard access was denied. The exact prompt remains selectable in the brief detail.");
      return;
    }
    try {
      await commitChannel(operationId("export-brief"), (current) => markBriefExported(current, brief.id, role, operationId("export-brief-state")), "Exact approved prompt copied and marked exported");
    } catch (caught) {
      reportError(caught, "The exact prompt was copied, but its TAP export audit state could not be saved. Reload before exporting again.");
    }
  };

  const [briefVoteEditor, setBriefVoteEditor] = useState<BriefVoteEditorState | null>(null);
  const openBriefVote = (brief: SongBrief): void => {
    const existing = channelRef.current?.briefVotes.find((vote) => vote.briefId === brief.id && vote.actorKey === actorKey);
    const timestamp = now();
    setBriefVoteEditor({
      id: existing?.id ?? crypto.randomUUID(),
      briefId: brief.id,
      actorKey,
      disposition: existing?.disposition ?? "support",
      suggestedTitle: existing?.suggestedTitle ?? "",
      suggestedMood: existing?.suggestedMood ?? "",
      suggestedGenre: existing?.suggestedGenre ?? "",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      briefTitle: brief.title,
    });
  };
  const submitBriefVote = async (): Promise<void> => {
    const editor = briefVoteEditor;
    if (!editor) return;
    const { briefTitle: _briefTitle, ...vote } = editor;
    try {
      await commitChannel(operationId("brief-vote"), (current) => recordBriefVote(current, vote, role, operationId("brief-vote-state")), "Participant brief feedback saved");
      setBriefVoteEditor(null);
    } catch (caught) {
      reportError(caught, "Participant brief feedback could not be saved.");
    }
  };

  const [timelineCandidates, setTimelineCandidates] = useState<TimelineCandidate[]>([]);
  const [timelineSequence, setTimelineSequence] = useState<number | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [sourceWindowLabel, setSourceWindowLabel] = useState("");
  const [specialists, setSpecialists] = useState<MiniAppSpecialistSummary[]>([]);
  const [selectedSpecialistId, setSelectedSpecialistId] = useState("");
  const [specialistModel, setSpecialistModel] = useState("");
  const [specialistConsent, setSpecialistConsent] = useState(false);
  const [workflows, setWorkflows] = useState<MiniAppWorkflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [workflowResult, setWorkflowResult] = useState("");
  const [capabilityError, setCapabilityError] = useState("");
  const [summaryEditor, setSummaryEditor] = useState<SummaryEditorState | null>(null);

  useEffect(() => {
    let active = true;
    if (preview || !authority || tab !== "context" || !context?.workspaceId) return;
    const loadCapabilities = async (): Promise<void> => {
      const failures: string[] = [];
      try {
        const api = sdk.specialist;
        if (api) {
          const result = await api.listWorkspace(context.workspaceId as string);
          if (active) setSpecialists(result);
        } else failures.push("This host does not expose the optional specialist API.");
      } catch (caught) {
        failures.push(`Specialists: ${errorMessage(caught, "unavailable")}`);
      }
      try {
        const result = await sdk.workflows.list(context.workspaceId ? { workspaceId: context.workspaceId } : {});
        if (active) setWorkflows(result.workflows);
      } catch (caught) {
        failures.push(`Saved workflows: ${errorMessage(caught, "unavailable")}`);
      }
      if (active) setCapabilityError(failures.join(" "));
    };
    void loadCapabilities();
    return () => {
      active = false;
    };
  }, [authority, context?.workspaceId, preview, tab]);

  const enableConversationContext = async (): Promise<void> => {
    if (!can(role, "manage")) {
      reportError(new Error("Only a channel DJ can enable conversation-derived music."), "Consent could not be changed.");
      return;
    }
    if (!authority || preview) {
      await commitChannel(operationId("enable-context-preview"), (current) => applyChannelOperation(current, operationId("enable-context-preview-state"), (state) => ({ ...state, consent: { conversationContextEnabled: true, notifiedAt: now() } })), "Conversation context enabled in browser preview");
      return;
    }
    const message = "Unofficial Suno Player conversation context is now enabled for this channel. Participants must review selected source windows, privacy exclusions, summaries, and exact outbound song prompts before any human-mediated generation. No private Suno API is connected.";
    const messageId = `suno-player-context-notice:${channelId}`;
    try {
      await sdk.channels.sendMessage({
        ...(context?.workspaceId ? { workspaceId: context.workspaceId } : {}),
        channelId,
        clientMessageId: messageId,
        name: "Unofficial Suno Player",
        body: message,
        content: message,
      });
      await commitChannel(operationId("enable-context"), (current) => applyChannelOperation(current, operationId("enable-context-state"), (state) => ({ ...state, consent: { conversationContextEnabled: true, notifiedAt: now() } })), "Channel notified and conversation context enabled");
    } catch (caught) {
      reportError(caught, "The channel notice failed, so conversation context was not enabled.");
    }
  };

  const loadTimeline = async (): Promise<void> => {
    if (preview) {
      setTimelineCandidates([]);
      setTimelineSequence(0);
      setSelectedMessageIds([]);
      showNotice("Browser preview has no platform channel messages. Use the manual summary path.");
      return;
    }
    setStatus("running");
    try {
      const access = await sdk.channels.getAccess(context?.workspaceId ? { workspaceId: context.workspaceId, channelId } : { channelId });
      if (!access.isParticipant) throw new Error("Channel access was revoked before the timeline request.");
      const result = await sdk.channels.getTimeline(context?.workspaceId ? { workspaceId: context.workspaceId, channelId } : { channelId });
      setTimelineCandidates(extractTimelineCandidates(result.timeline.messages).slice(-100));
      setTimelineSequence(result.timeline.sequence);
      setSelectedMessageIds([]);
      setStatus("ready");
      showNotice("Visible timeline loaded. No message is selected by default.");
    } catch (caught) {
      reportError(caught, "The visible channel timeline could not be loaded.");
    }
  };

  const selectedMessages = timelineCandidates.filter((candidate) => selectedMessageIds.includes(candidate.id));

  const makeSourceWindow = async (): Promise<SourceWindow> => {
    if (sourceWindowLabel.trim().length < 2) throw new Error("Describe the source period before drafting a summary.");
    if (selectedMessages.length === 0) {
      return { kind: "manual", label: sourceWindowLabel.trim(), timelineSequence: null, messages: [] };
    }
    const messages = await Promise.all(selectedMessages.map(async (candidate) => ({
      id: candidate.id,
      digest: await digestText(candidate.text),
      sequence: candidate.sequence,
    })));
    return { kind: "channel-timeline", label: sourceWindowLabel.trim(), timelineSequence, messages };
  };

  const openManualSummary = async (): Promise<void> => {
    try {
      const sourceWindow = await makeSourceWindow();
      setSummaryEditor({ summary: createSummaryRecord(sourceWindow, "manual"), checks: initialPrivacyChecks() });
    } catch (caught) {
      reportError(caught, "A manual summary draft could not be started.");
    }
  };

  const draftWithSpecialist = async (): Promise<void> => {
    if (preview) return;
    const api = sdk.specialist;
    if (!api?.runTurnWithTools) {
      reportError(new Error("This host does not expose specialist turn execution."), "Specialist draft unavailable.");
      return;
    }
    const specialist = specialists.find((candidate) => candidate.id === selectedSpecialistId);
    if (!specialist || !specialistConsent || selectedMessages.length === 0 || specialistModel.trim().length < 2) {
      reportError(new Error("Select messages, a TAP specialist, a valid model ID, and approve the bounded excerpt handoff."), "Specialist draft unavailable.");
      return;
    }
    try {
      const sourceWindow = await makeSourceWindow();
      setStatus("running");
      const content = buildSpecialistSummaryPrompt(channelTitle(channels, channelId), sourceWindow.label, selectedMessages);
      const result = await api.runTurnWithTools({
        workspaceId: context?.workspaceId ?? "",
        channelId,
        specialistId: specialist.id,
        content,
        modelOverride: specialistModel.trim(),
        messageId: null,
        interactionMode: "planning",
        timeoutMs: 90_000,
      });
      const response = specialistResponseText(result.completionEvent.parts);
      if (!response) throw new Error("The specialist completed without a text summary draft.");
      const fields = parseSpecialistSummary(response);
      setSummaryEditor({ summary: createSummaryRecord(sourceWindow, "tap-specialist", fields, specialist), checks: initialPrivacyChecks() });
      setStatus("ready");
      showNotice("Specialist draft received. Human privacy approval is still required.");
    } catch (caught) {
      reportError(caught, "The TAP specialist could not draft a summary.");
    }
  };

  const submitSummary = async (statusValue: "draft" | "approved" | "rejected"): Promise<void> => {
    if (!summaryEditor) return;
    const at = now();
    const summary: ConversationSummary = {
      ...summaryEditor.summary,
      status: statusValue,
      privacyReview: statusValue === "approved" ? { ...summaryEditor.checks, reviewedAt: at } : null,
      approvedAt: statusValue === "approved" ? at : null,
      rejectedAt: statusValue === "rejected" ? at : null,
    };
    try {
      await commitChannel(operationId("summary"), (current) => saveSummary(current, summary, role, operationId("summary-state")), statusValue === "approved" ? "Conversation summary approved" : statusValue === "rejected" ? "Summary rejected and retained for audit" : "Summary draft saved");
      setSummaryEditor(null);
    } catch (caught) {
      reportError(caught, "The conversation summary could not be saved.");
    }
  };

  const invokeWorkflow = async (): Promise<void> => {
    if (!selectedWorkflowId) return;
    setStatus("running");
    setWorkflowResult("");
    try {
      const result = await sdk.workflows.invokeSaved({ workflowId: selectedWorkflowId, payload: { source: "unofficial-suno-player", channelId, requestedOperation: "prepare-reviewable-song-summary" } });
      if (!result.success) throw new Error(result.error ?? result.message);
      const run = result.runId ? ` Run ${result.runId}.` : "";
      setWorkflowResult(`${result.status}: ${result.message}.${run}`);
      setStatus("ready");
    } catch (caught) {
      reportError(caught, "The selected saved workflow did not start successfully.");
    }
  };

  const reactToTrack = async (track: Track): Promise<void> => {
    const reaction = actorFeedback(track, actorKey)?.liked ? "unlike" : "like";
    await commitChannel(operationId("like"), (current) => toggleTrackLike(current, track.id, actorKey, role, operationId("like-state")), actorFeedback(track, actorKey)?.liked ? "Like removed" : "Track liked");
    try {
      await publish(context, "player.track.reacted", { channelId, trackId: track.id, reaction });
    } catch (caught) {
      setError(`The reaction was saved, but its declared TAP event failed: ${errorMessage(caught, "event publication failed")}`);
    }
  };

  const hideTrack = async (track: Track): Promise<void> => {
    const willHide = !actorFeedback(track, actorKey)?.hidden;
    await commitChannel(operationId("hide"), (current) => toggleTrackHidden(current, track.id, actorKey, role, operationId("hide-state")), willHide ? "Track hidden from your queue" : "Track restored to your queue");
    if (willHide && preferencesRef.current?.currentTrackId === track.id) await skipTrack(false);
  };

  const [retireTarget, setRetireTarget] = useState<Track | null>(null);
  const [undoRetiredTrack, setUndoRetiredTrack] = useState<Track | null>(null);
  const confirmRetire = async (): Promise<void> => {
    const target = retireTarget;
    if (!target) return;
    try {
      await commitChannel(operationId("retire"), (current) => retireTrack(current, target.id, role, operationId("retire-state")), "Track retired from playback");
      if (preferencesRef.current?.currentTrackId === target.id) {
        audioRef.current?.pause();
        setPlaying(false);
        await commitPreferences(operationId("retire-selection"), (current) => applyPreferenceOperation(current, operationId("retire-selection-state"), (value) => ({ ...value, currentTrackId: null, position: 0 })));
      }
      setUndoRetiredTrack(target);
      setRetireTarget(null);
    } catch (caught) {
      reportError(caught, "The track could not be retired.");
    }
  };

  const undoRetire = async (): Promise<void> => {
    const target = undoRetiredTrack;
    if (!target) return;
    await commitChannel(operationId("restore-retired"), (current) => restoreRetiredTrack(current, target.id, role, operationId("restore-retired-state")), "Retired track restored");
    setUndoRetiredTrack(null);
  };

  const [visibilityTarget, setVisibilityTarget] = useState<Track | null>(null);
  const [visibilityChecks, setVisibilityChecks] = useState({ rights: false, privacy: false });
  const confirmVisibility = async (): Promise<void> => {
    const target = visibilityTarget;
    if (!target || !visibilityChecks.rights || !visibilityChecks.privacy) return;
    const next: "channel-only" | "workspace-visible" = target.visibility === "private-draft" ? "channel-only" : "workspace-visible";
    await commitChannel(operationId("visibility"), (current) => reviewTrackVisibility(current, target.id, next, role, operationId("visibility-state")), `Track visibility changed to ${next.replaceAll("-", " ")}`);
    setVisibilityTarget(null);
    setVisibilityChecks({ rights: false, privacy: false });
  };

  const [policyDraft, setPolicyDraft] = useState<PlaylistPolicy | null>(null);
  useEffect(() => {
    if (channelState) setPolicyDraft(channelState.policy);
  }, [channelState?.channelId, channelState?.policy]);
  const savePolicy = async (): Promise<void> => {
    if (!policyDraft) return;
    const issues = validatePolicy(policyDraft);
    if (issues.length > 0) {
      reportError(new Error(issues.join(" ")), "Programming policy is invalid.");
      return;
    }
    await commitChannel(operationId("policy"), (current) => applyChannelOperation(current, operationId("policy-state"), (state) => ({ ...state, policy: policyDraft })), "Manual programming policy saved");
  };

  const updatePreferences = async (patch: Partial<PlayerPreferences>, message = "Player preference saved"): Promise<void> => {
    await commitPreferences(operationId("preferences"), (current) => applyPreferenceOperation(current, operationId("preferences-state"), (value) => ({ ...value, ...patch })), message, true);
  };

  if (!authority && !preview) {
    return <main className="shell centered" aria-busy="true">
      <LockKeyhole aria-hidden />
      <H1>Waiting for TAP authority</H1>
      <p className="muted">This verified surface will not read channels or storage until the host grants authority.</p>
      <Progress value={20} aria-label="Waiting for host authority" />
    </main>;
  }

  if (status === "loading" && !channelState) {
    return <main className="shell centered" aria-busy="true">
      <LoaderCircle className="spin" aria-hidden />
      <H1>Loading your soundtrack</H1>
      <Progress value={55} aria-label="Loading channel soundtrack" />
    </main>;
  }

  if (!channelId) {
    return <main className="shell">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><Radio /></EmptyMedia>
          <EmptyTitle>Choose a channel soundtrack</EmptyTitle>
          <EmptyDescription>Only channels returned by TAP are shown. No soundtrack records are preloaded.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <NativeSelect aria-label="Channel" value={channelId} onChange={(event) => setChannelId(event.target.value)}>
            <option value="">Select a channel</option>
            {channels.map((channel) => <option key={channel.roomId} value={channel.roomId}>{channel.title ?? channel.roomId}</option>)}
          </NativeSelect>
        </EmptyContent>
      </Empty>
    </main>;
  }

  if (!channelState || !preferences) {
    return <main className="shell error-shell">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Soundtrack unavailable</AlertTitle>
        <AlertDescription>{error || "No valid soundtrack state is available."}</AlertDescription>
      </Alert>
      <Button onClick={() => void reload()}><RefreshCw /> Reload TAP state</Button>
    </main>;
  }

  if (!channelState.enabled) {
    return <main className="shell retro-shell onboarding">
      <MiniAppToolbar className="app-toolbar">
        <div className="app-identity"><span className="app-mark" aria-hidden><i /><i /><i /><i /></span><div><strong>SONORA</strong><span>Unofficial channel player</span></div></div>
        <Badge variant="secondary">Independent · not endorsed by Suno</Badge>
      </MiniAppToolbar>
      {error ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>Action required</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      <section className="retro-window onboarding-window" aria-labelledby="first-run-title">
        <div className="retro-titlebar"><div><span className="mini-spectrum" aria-hidden><i /><i /><i /><i /><i /></span>FIRST RUN · CHANNEL SOUNDTRACK</div><div className="window-controls" aria-hidden><span>_</span><span>□</span><span>×</span></div></div>
        <div className="onboarding-body">
          <div className="onboarding-readout"><span>STATUS 00</span><strong id="first-run-title">NO SOUNDTRACK CONFIGURED</strong><p>Build a governed channel album from approved song briefs and audio you have the right to play.</p></div>
          <div className="onboarding-grid">
            <section><span className="step-number">01</span><Music2 /><h2>Draft the brief</h2><p>Review the exact outbound text, then generate through your own authorized account.</p></section>
            <section><span className="step-number">02</span><AudioLines /><h2>Import owned audio</h2><p>Local decoding drives the spectrum. Audio analysis never leaves this device.</p></section>
            <section><span className="step-number">03</span><Users /><h2>Govern by channel</h2><p>Rights, provenance, visibility, approval, and source period stay attached.</p></section>
          </div>
          <Alert><ShieldCheck /><AlertTitle>Provider boundary</AlertTitle><AlertDescription>Private Suno APIs and your signed-in browser session are not used. Direct connectivity remains disabled until Suno authorizes an official integration.</AlertDescription></Alert>
          <div className="onboarding-action"><div><strong>READY FOR INITIALIZATION</strong><span>No music, summaries, briefs, batches, or channel records are preloaded.</span></div><Button disabled={!can(role, "manage") || status === "saving"} onClick={() => void initialize()}><WandSparkles /> Initialize player</Button></div>
          {!can(role, "manage") ? <p className="muted" role="status">A channel DJ must opt this channel into a soundtrack.</p> : null}
        </div>
      </section>
    </main>;
  }

  const queueLow = isQueueLow(channelState, preferences, actorKey);
  const activeBatches = channelState.batches.filter((batch) => batch.status !== "complete");
  const approvedSummaries = channelState.summaries.filter((summary) => summary.status === "approved");
  const visibleQueue = channelState.queue.flatMap((id) => {
    const track = channelState.tracks.find((candidate) => candidate.id === id);
    return track && !track.retired && !actorFeedback(track, actorKey)?.hidden ? [track] : [];
  });

  return <main className="shell retro-shell">
    <audio ref={attachAudio} data-testid="player-audio" preload="metadata" aria-label="Owned audio player" />
    <MiniAppToolbar className="app-toolbar">
      <div className="app-identity"><span className="app-mark" aria-hidden><i /><i /><i /><i /></span><div><strong>SONORA</strong><span>Unofficial channel player</span></div></div>
      <Field className="toolbar-channel"><FieldLabel htmlFor="channel-switcher">Channel</FieldLabel><NativeSelect id="channel-switcher" density="compact" value={channelId} disabled={status === "saving"} onChange={(event) => void switchChannel(event.target.value)}>{channels.length === 0 ? <option value={channelId}>{channelId}</option> : channels.map((channel) => <option key={channel.roomId} value={channel.roomId}>{channel.title ?? channel.roomId}</option>)}</NativeSelect></Field>
      <ButtonGroup><Button variant="outline" size="sm" onClick={() => openBriefEditor(createBriefDraft(channelState, approvedSummaries.at(-1)))} disabled={!can(role, "contribute") || !authority}><WandSparkles /> New brief</Button><Button size="sm" onClick={() => setImportOpen(true)} disabled={!can(role, "contribute") || !authority}><Upload /> Import audio</Button></ButtonGroup>
    </MiniAppToolbar>

    <MiniAppStatusBar className="app-status" tone={status === "error" || status === "conflict" ? "error" : notice ? "success" : "neutral"} role="status" aria-live="polite">
      <span className={`status-led ${status === "saving" || status === "running" ? "pulse" : ""}`} aria-hidden />
      {status === "saving" ? "SAVING TO AUTHORITATIVE STORAGE" : status === "running" ? "PLATFORM OPERATION IN PROGRESS" : status === "conflict" ? "REVISION CONFLICT" : notice || `${preview ? "BROWSER PREVIEW STORAGE" : "TAP REVISIONED STORAGE"} · ${role.toUpperCase()}`}
    </MiniAppStatusBar>

    {error ? <Alert variant="destructive" className="state-alert"><AlertTriangle /><AlertTitle>{conflict ? "Reload required" : "Operation failed"}</AlertTitle><AlertDescription>{error}</AlertDescription>{conflict ? <Button size="sm" variant="outline" onClick={() => void reload()}><RefreshCw /> Reload current TAP state</Button> : null}</Alert> : null}
    {undoRetiredTrack ? <MiniAppStatusBar tone="success" className="undo-bar">“{undoRetiredTrack.title}” was retired.<Button size="sm" variant="outline" onClick={() => void undoRetire()}><Redo2 /> Undo retirement</Button></MiniAppStatusBar> : null}
    {queueLow ? <Alert className="queue-alert"><ListMusic /><AlertTitle>Queue below its manual watermark</AlertTitle><AlertDescription>{visibleQueue.length} eligible track{visibleQueue.length === 1 ? "" : "s"} remain; policy requests {channelState.policy.lowWatermark}. No generation or spending will run automatically.</AlertDescription></Alert> : null}

    <Tabs className="app-tabs" value={tab} onValueChange={(value) => setTab(value as TabName)}>
      <TabsList className="retro-tabs" aria-label="Player views">
        <TabsTrigger value="player">Player</TabsTrigger>
        <TabsTrigger value="album">Album <Badge>{channelState.tracks.length}</Badge></TabsTrigger>
        <TabsTrigger value="briefs">Briefs <Badge>{channelState.briefs.length}</Badge></TabsTrigger>
        <TabsTrigger value="context">Context <Badge>{channelState.summaries.length}</Badge></TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="player">
        <div className="retro-workstation">
          <section className="retro-window player-window" data-playback-state={playing ? "playing" : "paused"} aria-label="Audio deck">
            <div className="retro-titlebar"><div><span className="mini-spectrum" aria-hidden><i /><i /><i /><i /><i /></span>SONORA AUDIO DECK</div><div className="window-controls" aria-hidden><span>_</span><span>□</span><span>×</span></div></div>
            <div className="deck-body">
              <div className="display-panel">
                <div className="time-block"><span className="digital-time">{formatTime(progress)}</span><span className="time-caption">ELAPSED</span></div>
                <div className="track-readout"><span className="readout-index">{currentTrack ? `${String(Math.max(1, visibleQueue.findIndex((track) => track.id === currentTrack.id) + 1)).padStart(2, "0")} / ${String(visibleQueue.length).padStart(2, "0")}` : "00 / 00"}</span><strong>{currentTrack?.title ?? "NO TRACK LOADED"}</strong><span>{currentTrack ? `${currentTrack.contributor} · ${currentTrack.provider}` : "IMPORT OWNED AUDIO TO START"}</span></div>
                <div className="signal-flags"><span className={playing ? "lit" : ""}>PLAY</span><span>{mediaReady ? "MEDIA" : "FILE?"}</span><span>LOCAL</span></div>
              </div>
              <div className="visualizer-bezel"><Visualizer analyserRef={analysis.analyserRef} mode={preferences.visualization} palette={preferences.visualizationPalette} sensitivity={preferences.sensitivity} fps={preferences.fps} lowPower={preferences.lowPower} reducedMotion={preferences.reducedMotion} playing={playing} />{analysis.error ? <div className="visualizer-error" role="alert">{analysis.error}</div> : null}<div className="scanlines" aria-hidden /></div>
              <div className="deck-label-row"><span>SOURCE · {currentTrack?.sourcePeriod ?? "—"}</span><span>{currentTrack ? `${Math.round(currentTrack.size / 1024)} KB · ${currentTrack.mimeType.replace("audio/", "").toUpperCase()}` : "LOCAL DECODER STANDBY"}</span></div>
              <div className="seek-row"><span>{formatTime(progress)}</span><Slider aria-label="Seek" min={0} max={currentTrack?.duration || 1} step={0.1} value={[progress]} disabled={!currentTrack || !mediaReady} onValueChange={([value]) => { if (audioRef.current && value !== undefined) { audioRef.current.currentTime = value; setProgress(value); } }} onValueCommit={([value]) => { if (value !== undefined) void commitPreferences(operationId("seek"), (current) => applyPreferenceOperation(current, operationId("seek-state"), (next) => ({ ...next, position: value })), "Playback position saved"); }} /><span>-{formatTime(Math.max(0, (currentTrack?.duration ?? 0) - progress))}</span></div>
              <div className="control-bay">
                <div className="transport"><Button variant="outline" size="icon" aria-label="Previous track or restart" disabled={!currentTrack} onClick={() => void previousTrack()}><SkipBack /></Button><Button variant="outline" size="icon" className="play" aria-label={playing ? "Pause" : "Play"} disabled={!currentTrack || !authority} onClick={() => void togglePlay()}>{playing ? <Pause /> : <Play />}</Button><Button variant="outline" size="icon" aria-label="Skip to next track" disabled={!currentTrack} onClick={() => void skipTrack(true)}><SkipForward /></Button><Button variant={preferences.shuffle ? "default" : "outline"} size="icon" aria-label={preferences.shuffle ? "Disable shuffle" : "Enable shuffle"} onClick={() => void updatePreferences({ shuffle: !preferences.shuffle }, preferences.shuffle ? "Shuffle disabled" : "Shuffle enabled")}><Shuffle /></Button><Button variant={preferences.repeatMode !== "off" ? "default" : "outline"} size="icon" aria-label={`Repeat ${preferences.repeatMode}`} onClick={() => void updatePreferences({ repeatMode: preferences.repeatMode === "off" ? "all" : preferences.repeatMode === "all" ? "one" : "off" }, `Repeat ${preferences.repeatMode === "off" ? "all" : preferences.repeatMode === "all" ? "one" : "off"}`)}>{preferences.repeatMode === "one" ? <Repeat1 /> : <Repeat />}</Button></div>
                <div className="volume-bank"><div><span>{preferences.muted ? "MUTE" : "VOL"}</span><strong>{Math.round(preferences.volume * 100).toString().padStart(2, "0")}</strong></div><Button variant="ghost" size="icon" aria-label={preferences.muted ? "Unmute" : "Mute"} onClick={() => { if (audioRef.current) audioRef.current.muted = !preferences.muted; void updatePreferences({ muted: !preferences.muted }, preferences.muted ? "Audio unmuted" : "Audio muted"); }}>{preferences.muted ? <VolumeX /> : <Volume2 />}</Button><Slider aria-label="Volume" min={0} max={1} step={0.01} value={[preferences.volume]} onValueChange={([value]) => { if (value !== undefined) { if (audioRef.current) audioRef.current.volume = value; installPreferences({ ...preferences, volume: value }, preferencesRevisionRef.current); } }} onValueCommit={([value]) => { if (value !== undefined) void updatePreferences({ volume: value }, "Volume saved"); }} /></div>
                <div className="mode-bank"><label htmlFor="player-viz">VIS</label><NativeSelect id="player-viz" density="compact" value={preferences.visualization} onChange={(event) => void updatePreferences({ visualization: event.target.value as PlayerPreferences["visualization"] }, "Visualization saved")}><option value="frequency">Spectrum</option><option value="waveform">Scope</option><option value="stereo">Stereo</option><option value="particles">Tunnel</option><option value="kaleidoscope">Kaleido</option><option value="pixel">Pixel</option><option value="color">Color</option></NativeSelect></div>
              </div>
            </div>
          </section>
          <section className="retro-window queue-window" aria-label="Channel queue">
            <div className="retro-titlebar"><div>CHANNEL QUEUE</div><div className="queue-counter">{visibleQueue.length} ELIGIBLE</div></div>
            <div className="queue-display">{visibleQueue.length ? <ol>{visibleQueue.map((track, index) => <li key={track.id} className={track.id === currentTrack?.id ? "active" : ""}><button type="button" onClick={() => void chooseTrack(track.id)} aria-label={`Select ${track.title}`}><span className="queue-status" aria-hidden>{track.id === currentTrack?.id && playing ? "▶" : String(index + 1).padStart(2, "0")}</span><span className="queue-copy"><strong>{track.title}</strong><small>{track.contributor}</small></span><time>{formatTime(track.duration)}</time>{track.mediaPersistence === "session-only" && !mediaReady && track.id === currentTrack?.id ? <Badge variant="destructive">FILE?</Badge> : null}</button></li>)}</ol> : <div className="queue-empty"><Disc3 /><strong>QUEUE EMPTY</strong><span>No demo tracks. Import audio you own.</span></div>}</div>
            <div className="queue-footer"><Button variant="outline" size="sm" onClick={() => setImportOpen(true)} disabled={!can(role, "contribute")}><Import /> Add file</Button><span>{currentTrack ? `SHA ${currentTrack.audioDigest.slice(0, 8).toUpperCase()}` : "NO MEDIA"}</span></div>
          </section>
        </div>
      </TabsContent>

      <TabsContent value="album">
        <Card className="content-card"><CardHeader><CardTitle>Channel album</CardTitle><CardDescription>Every item comes from a participant import. Provenance and sharing scope remain attached.</CardDescription></CardHeader><CardContent>{channelState.tracks.length ? <ItemGroup>{channelState.tracks.map((track) => {
          const feedback = actorFeedback(track, actorKey);
          const batch = channelState.batches.find((candidate) => candidate.id === track.batchId);
          const brief = channelState.briefs.find((candidate) => candidate.id === track.briefId);
          const summary = brief?.summaryId ? channelState.summaries.find((candidate) => candidate.id === brief.summaryId) : undefined;
          return <Item key={track.id} variant="outline" className={track.retired ? "retired-item" : ""}><ItemContent><ItemTitle>{track.title} {track.retired ? <Badge variant="secondary">Retired</Badge> : null} {feedback?.hidden ? <Badge variant="outline">Hidden for you</Badge> : null} {track.instrumental ? <Badge variant="outline">Instrumental</Badge> : null}</ItemTitle><ItemDescription className="track-description">{track.contributor} · {track.provider} · {track.visibility.replaceAll("-", " ")}<br />{track.sourcePeriod} · {formatTime(track.duration)} · {track.fileName} · SHA-256 {track.audioDigest.slice(0, 12)}…{brief ? <><br />Brief “{brief.title}” v{brief.version} · {brief.genre} · {brief.mood}</> : null}{summary ? <><br />Approved context: {summary.sourceWindow.label} · Themes: {summary.themes}</> : null}{batch ? <><br />Batch {batch.importedTrackIds.length}/{batch.targetCount} · {batch.status.replaceAll("-", " ")}</> : null}{track.contentWarning ? <><br />Content warning: {track.contentWarning}</> : null}{track.sourceUrl ? <><br /><a href={track.sourceUrl} target="_blank" rel="noreferrer">Open participant-provided source link <ExternalLink aria-hidden /></a></> : null}</ItemDescription></ItemContent><ItemActions><Button variant={feedback?.liked ? "default" : "ghost"} size="sm" aria-label={`${feedback?.liked ? "Unlike" : "Like"} ${track.title}`} onClick={() => void reactToTrack(track)}><Heart /> {trackLikeCount(track)}</Button><Button variant="ghost" size="sm" onClick={() => void hideTrack(track)} disabled={track.retired}><EyeOff /> {feedback?.hidden ? "Unhide" : "Hide"}</Button><Button variant="ghost" size="sm" onClick={() => void chooseTrack(track.id)} disabled={track.retired}><Play /> Play</Button>{can(role, "manage") && !track.retired && track.visibility !== "workspace-visible" ? <Button variant="outline" size="sm" onClick={() => { setVisibilityTarget(track); setVisibilityChecks({ rights: false, privacy: false }); }}><ShieldCheck /> Review visibility</Button> : null}{can(role, "manage") && !track.retired ? <Button variant="ghost" size="icon" aria-label={`Retire ${track.title}`} onClick={() => setRetireTarget(track)}><Trash2 /></Button> : null}</ItemActions></Item>;
        })}</ItemGroup> : <Empty><EmptyHeader><EmptyMedia variant="icon"><Disc3 /></EmptyMedia><EmptyTitle>The album is empty</EmptyTitle><EmptyDescription>Tracks appear only after a participant imports an owned audio file with a rights attestation.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => setImportOpen(true)} disabled={!can(role, "contribute")}><Upload /> Import owned audio</Button></EmptyContent></Empty>}</CardContent></Card>
      </TabsContent>

      <TabsContent value="briefs">
        <div className="section-heading"><div><H2>Reviewable song briefs</H2><p>Drafts stay inside TAP. Only exact approved text can be copied to an authorized account.</p></div><Button onClick={() => openBriefEditor(createBriefDraft(channelState, approvedSummaries.at(-1)))} disabled={!can(role, "contribute")}><WandSparkles /> New brief</Button></div>
        {channelState.briefs.length ? <ItemGroup>{[...channelState.briefs].reverse().map((brief) => {
          const votes = channelState.briefVotes.filter((vote) => vote.briefId === brief.id);
          const supports = votes.filter((vote) => vote.disposition === "support").length;
          const revisions = votes.length - supports;
          const suggestions = votes.flatMap((vote) => [
            vote.suggestedTitle ? `Title: ${vote.suggestedTitle}` : "",
            vote.suggestedMood ? `Mood: ${vote.suggestedMood}` : "",
            vote.suggestedGenre ? `Genre: ${vote.suggestedGenre}` : "",
          ]).filter(Boolean);
          const feedbackOpen = !["superseded", "rejected"].includes(brief.status);
          return <Item key={brief.id} variant="outline"><ItemContent><ItemTitle>{brief.title} <Badge variant={brief.status === "draft" ? "secondary" : brief.status === "rejected" ? "destructive" : "default"}>{brief.status}</Badge> <Badge variant="outline">v{brief.version}</Badge></ItemTitle><ItemDescription className="brief-description">{brief.genre} · {brief.mood} · {brief.sourcePeriod} · {brief.candidateCount} candidate{brief.candidateCount === 1 ? "" : "s"}<br />Participant feedback: {supports} support · {revisions} need revision{suggestions.length ? <><br />Suggestions: {suggestions.join(" · ")}</> : null}<br />Fingerprint {brief.promptFingerprint || promptFingerprint(brief.outboundPrompt)}</ItemDescription><CodeBlock code={brief.outboundPrompt} language="text" highlight={false} collapsible defaultExpanded={false} /></ItemContent><ItemActions><Button size="sm" variant="ghost" onClick={() => openBriefVote(brief)} disabled={!feedbackOpen || !actorKey}><Users /> Vote / suggest</Button><Button size="sm" variant="outline" onClick={() => openBriefEditor(brief.status === "draft" ? editDraft(brief) : createBriefDraft(channelState, undefined, brief))} disabled={!can(role, "contribute") || brief.status === "superseded"}>Revise</Button>{["approved", "exported"].includes(brief.status) ? <Button size="sm" onClick={() => void copyApprovedPrompt(brief)}><Clipboard /> Copy exact prompt</Button> : null}</ItemActions></Item>;
        })}</ItemGroup> : <Empty><EmptyHeader><EmptyMedia variant="icon"><WandSparkles /></EmptyMedia><EmptyTitle>No song briefs</EmptyTitle><EmptyDescription>Start with an approved summary, safe themes, and explicit exclusions.</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => openBriefEditor(createBriefDraft(channelState, approvedSummaries.at(-1)))} disabled={!can(role, "contribute")}><WandSparkles /> Create brief</Button></EmptyContent></Empty>}
      </TabsContent>

      <TabsContent value="context">
        <div className="context-grid">
          <Card><CardHeader><CardTitle>Channel consent</CardTitle><CardDescription>Conversation-derived music is opt-in and reviewable.</CardDescription></CardHeader><CardContent>{channelState.consent.conversationContextEnabled ? <Alert><Check /><AlertTitle>{preview ? "Enabled for browser preview" : "Enabled with notice"}</AlertTitle><AlertDescription>{preview ? "This consent state exists only in separate preview storage; no TAP channel notice was sent. Packaged execution commits consent only after a real notice succeeds." : `Channel notice recorded ${channelState.consent.notifiedAt ? new Date(channelState.consent.notifiedAt).toLocaleString() : "without a timestamp"}.`} Source messages are still unselected by default.</AlertDescription></Alert> : <Empty><EmptyHeader><EmptyTitle>Conversation context is off</EmptyTitle><EmptyDescription>{preview ? "Preview can exercise the manual review flow without claiming that a TAP notice was sent." : "Enabling it sends a real channel notice before TAP state changes."}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={() => void enableConversationContext()} disabled={!can(role, "manage")}><ShieldCheck /> {preview ? "Enable preview-only context" : "Enable and notify channel"}</Button></EmptyContent></Empty>}</CardContent></Card>
          <Card><CardHeader><CardTitle>Source window</CardTitle><CardDescription>Select only messages participants permit for this draft.</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="source-window">Conversation period or milestone</FieldLabel><Input id="source-window" value={sourceWindowLabel} onChange={(event) => setSourceWindowLabel(event.target.value)} placeholder="Describe the approved period" /></Field><Button variant="outline" onClick={() => void loadTimeline()} disabled={!channelState.consent.conversationContextEnabled}><RefreshCw /> Load visible TAP timeline</Button>{timelineCandidates.length ? <div className="message-picker" role="group" aria-label="Select channel excerpts">{timelineCandidates.map((candidate) => <label key={candidate.id} className="message-choice"><Checkbox checked={selectedMessageIds.includes(candidate.id)} onCheckedChange={(checked) => setSelectedMessageIds((current) => checked === true ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} /><span><strong>{candidate.author}</strong><small>{candidate.text}</small></span></label>)}</div> : <p className="muted">No channel message excerpts are loaded. Manual summaries remain available without copying message text.</p>}<p className="selection-count">{selectedMessageIds.length} excerpt{selectedMessageIds.length === 1 ? "" : "s"} selected</p></FieldGroup></CardContent><CardFooter><Button onClick={() => void openManualSummary()} disabled={!channelState.consent.conversationContextEnabled || !can(role, "contribute")}><MessageSquareText /> Draft summary manually</Button></CardFooter></Card>
          <Card><CardHeader><CardTitle>TAP specialist draft</CardTitle><CardDescription>Optional. Only the selected excerpts shown above are sent to the real specialist.</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="specialist">Specialist</FieldLabel><NativeSelect id="specialist" value={selectedSpecialistId} onChange={(event) => setSelectedSpecialistId(event.target.value)} disabled={preview || specialists.length === 0}><option value="">Select a TAP specialist</option>{specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{specialist.displayName}</option>)}</NativeSelect></Field><Field><FieldLabel htmlFor="specialist-model">Model ID required by TAP</FieldLabel><Input id="specialist-model" value={specialistModel} onChange={(event) => setSpecialistModel(event.target.value)} placeholder="Enter an authorized model ID" disabled={preview} /></Field><label className="check rights"><Checkbox checked={specialistConsent} onCheckedChange={(checked) => setSpecialistConsent(checked === true)} disabled={preview} /> I approve sending only the selected excerpts and the displayed summarization instructions to this TAP specialist. No audio, lyrics, Suno output, or analysis data is included.</label>{capabilityError ? <Alert variant="destructive"><AlertTriangle /><AlertTitle>Optional capability unavailable</AlertTitle><AlertDescription>{capabilityError}</AlertDescription></Alert> : null}</FieldGroup></CardContent><CardFooter><Button onClick={() => void draftWithSpecialist()} disabled={preview || !specialistConsent || selectedMessageIds.length === 0 || !selectedSpecialistId || !specialistModel.trim()}><Sparkles /> Draft with specialist</Button></CardFooter></Card>
          <Card><CardHeader><CardTitle>Saved TAP workflows</CardTitle><CardDescription>Run an existing workflow. Its real status is shown; it is never treated as an approved summary automatically.</CardDescription></CardHeader><CardContent><Field><FieldLabel htmlFor="workflow">Saved workflow</FieldLabel><NativeSelect id="workflow" value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)} disabled={preview || workflows.length === 0}><option value="">Select a saved workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</NativeSelect></Field>{workflowResult ? <Alert><Check /><AlertTitle>Workflow accepted by TAP</AlertTitle><AlertDescription>{workflowResult}</AlertDescription></Alert> : null}</CardContent><CardFooter><Button variant="outline" onClick={() => void invokeWorkflow()} disabled={preview || !selectedWorkflowId || !can(role, "manage")}><Radio /> Invoke saved workflow</Button></CardFooter></Card>
        </div>
        <Card className="summary-list"><CardHeader><CardTitle>Summary artifacts</CardTitle><CardDescription>Drafts, approvals, rejections, provenance, and source digests remain separate from tracks.</CardDescription></CardHeader><CardContent>{channelState.summaries.length ? <ItemGroup>{[...channelState.summaries].reverse().map((summary) => <Item key={summary.id} variant="outline"><ItemContent><ItemTitle>{summary.sourceWindow.label} <Badge variant={summary.status === "approved" ? "default" : summary.status === "rejected" ? "destructive" : "secondary"}>{summary.status}</Badge></ItemTitle><ItemDescription>{summary.provenance === "tap-specialist" ? `TAP specialist: ${summary.specialistName ?? summary.specialistId}` : "Human-authored"} · {summary.sourceWindow.messages.length} source digest{summary.sourceWindow.messages.length === 1 ? "" : "s"}<br />{summary.safeSummary}</ItemDescription></ItemContent><ItemActions>{summary.status === "approved" ? <Button size="sm" onClick={() => openBriefEditor(createBriefDraft(channelState, summary))} disabled={!can(role, "contribute")}><WandSparkles /> Create brief</Button> : null}</ItemActions></Item>)}</ItemGroup> : <Empty><EmptyHeader><EmptyTitle>No summary artifacts</EmptyTitle><EmptyDescription>Nothing is synthesized until a participant starts a manual or specialist-backed draft.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
      </TabsContent>

      <TabsContent value="settings">
        <div className="settings-grid">
          <Card><CardHeader><CardTitle>Visualizer</CardTitle><CardDescription>Signal analysis stays local and is never sent to a model.</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="viz-mode">Mode</FieldLabel><NativeSelect id="viz-mode" value={preferences.visualization} onChange={(event) => void updatePreferences({ visualization: event.target.value as PlayerPreferences["visualization"] }, "Visualization saved")}>{[["frequency", "Frequency-bar EQ"], ["waveform", "Oscilloscope waveform"], ["stereo", "Stereo spectrum"], ["particles", "Particle tunnel"], ["kaleidoscope", "Geometric kaleidoscope"], ["pixel", "Pixel landscape"], ["color", "Signal color field"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field><Field><FieldLabel htmlFor="viz-palette">Color palette</FieldLabel><NativeSelect id="viz-palette" value={preferences.visualizationPalette} onChange={(event) => void updatePreferences({ visualizationPalette: event.target.value as PlayerPreferences["visualizationPalette"] }, "Color palette saved")}><option value="neon">Neon signal</option><option value="ocean">Ocean phosphor</option><option value="monochrome">Monochrome</option></NativeSelect></Field><Field><FieldLabel>Visualizer sensitivity</FieldLabel><Slider aria-label="Visualizer sensitivity" min={0.5} max={1.5} step={0.1} value={[preferences.sensitivity]} onValueCommit={([value]) => value !== undefined && void updatePreferences({ sensitivity: value }, "Sensitivity saved")} /></Field><Field><FieldLabel htmlFor="fps">Frame rate</FieldLabel><NativeSelect id="fps" value={String(preferences.fps)} onChange={(event) => void updatePreferences({ fps: Number(event.target.value) as 30 | 60 }, "Frame rate saved")}><option value="30">30 FPS</option><option value="60">60 FPS</option></NativeSelect></Field><label className="check"><Checkbox checked={preferences.lowPower} onCheckedChange={(checked) => void updatePreferences({ lowPower: checked === true }, "Low-power preference saved")} /> Low-power rendering</label><label className="check"><Checkbox checked={preferences.reducedMotion} onCheckedChange={(checked) => void updatePreferences({ reducedMotion: checked === true }, "Motion preference saved")} /> Reduced motion</label></FieldGroup></CardContent></Card>
          <Card><CardHeader><CardTitle>Listening privacy</CardTitle><CardDescription>Personal listening is the default. Presence is ephemeral and opt-in.</CardDescription></CardHeader><CardContent><label className="check rights"><Checkbox checked={preferences.broadcastPresence} disabled={preview} onCheckedChange={(checked) => void updatePreferences({ broadcastPresence: checked === true }, checked === true ? "Listening presence enabled" : "Listening presence disabled")} /> Broadcast my listening or paused state in this channel. Track identity is included only while I retain channel access.</label>{preview ? <Field><FieldLabel htmlFor="preview-role">Browser preview role</FieldLabel><NativeSelect id="preview-role" value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="listener">Listener</option><option value="contributor">Contributor</option><option value="channel-dj">Channel DJ</option></NativeSelect></Field> : <p className="muted">Effective role: {role}. TAP channel capabilities are rechecked on load and operations can still reject after this check.</p>}<Separator />{preview ? <p className="muted">Browser preview never joins or simulates TAP presence.</p> : preferences.broadcastPresence ? presenceParticipants.length ? <ItemGroup>{presenceParticipants.map((participant) => { const state = participant.state && typeof participant.state === "object" && !Array.isArray(participant.state) ? participant.state as Record<string, unknown> : {}; return <Item key={participant.participantId} variant="outline"><ItemContent><ItemTitle>{participant.displayName}</ItemTitle><ItemDescription>{state.listening === true ? "Listening" : "Paused"}{typeof state.trackId === "string" ? ` · track ${state.trackId.slice(0, 8)}…` : ""}</ItemDescription></ItemContent></Item>; })}</ItemGroup> : <p className="muted">Joined presence; no listeners are currently reported.</p> : <p className="muted">Presence is off. No listening state is broadcast.</p>}</CardContent></Card>
          <Card className="policy-card"><CardHeader><CardTitle>Manual programming policy</CardTitle><CardDescription>These stored limits drive queue warnings and brief batches. They never authorize automated Suno calls or spending.</CardDescription></CardHeader><CardContent>{policyDraft ? <FieldGroup><div className="form-grid"><Field><FieldLabel htmlFor="watermark">Queue low watermark</FieldLabel><Input id="watermark" type="number" min="1" max="25" value={policyDraft.lowWatermark} onChange={(event) => setPolicyDraft({ ...policyDraft, lowWatermark: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor="batch-size">Songs per approved batch</FieldLabel><Input id="batch-size" type="number" min="1" max="4" value={policyDraft.songsPerBatch} onChange={(event) => setPolicyDraft({ ...policyDraft, songsPerBatch: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor="repeat-limit">Recent-track repetition limit</FieldLabel><Input id="repeat-limit" type="number" min="0" max="25" value={policyDraft.repetitionLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, repetitionLimit: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor="weekly-limit">Maximum generations per week</FieldLabel><Input id="weekly-limit" type="number" min="0" max="100" value={policyDraft.maxGenerationsPerWeek} onChange={(event) => setPolicyDraft({ ...policyDraft, maxGenerationsPerWeek: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor="credit-budget">Credit budget</FieldLabel><Input id="credit-budget" type="number" min="0" step="1" value={policyDraft.creditBudget} onChange={(event) => setPolicyDraft({ ...policyDraft, creditBudget: Number(event.target.value) })} /></Field><Field><FieldLabel htmlFor="approval-mode">Approval mode</FieldLabel><NativeSelect id="approval-mode" value={policyDraft.approvalMode} disabled><option value="manual-only">Manual only</option></NativeSelect></Field><Field><FieldLabel htmlFor="quiet-start">Quiet hours start</FieldLabel><Input id="quiet-start" type="time" value={policyDraft.quietHoursStart} onChange={(event) => setPolicyDraft({ ...policyDraft, quietHoursStart: event.target.value })} /></Field><Field><FieldLabel htmlFor="quiet-end">Quiet hours end</FieldLabel><Input id="quiet-end" type="time" value={policyDraft.quietHoursEnd} onChange={(event) => setPolicyDraft({ ...policyDraft, quietHoursEnd: event.target.value })} /></Field></div><label className="check"><Checkbox checked={policyDraft.replenishmentPaused} onCheckedChange={(checked) => setPolicyDraft({ ...policyDraft, replenishmentPaused: checked === true })} /> Pause manual queue-low reminders</label><label className="check"><Checkbox checked={policyDraft.quietHoursEnabled} onCheckedChange={(checked) => setPolicyDraft({ ...policyDraft, quietHoursEnabled: checked === true })} /> Enable quiet hours</label><label className="check"><Checkbox checked={policyDraft.instrumentalOnlyDuringQuietHours} onCheckedChange={(checked) => setPolicyDraft({ ...policyDraft, instrumentalOnlyDuringQuietHours: checked === true })} /> Prefer only instrumental tracks during quiet hours</label></FieldGroup> : null}</CardContent><CardFooter><Button onClick={() => void savePolicy()} disabled={!policyDraft || !can(role, "manage")}><Save /> Save programming policy</Button></CardFooter></Card>
          <Card><CardHeader><CardTitle>Capability boundaries</CardTitle><CardDescription>Unavailable features are omitted from executable controls.</CardDescription></CardHeader><CardContent><ItemGroup><Item variant="outline"><ItemContent><ItemTitle>Direct Suno integration</ItemTitle><ItemDescription>Blocked pending provider authorization and an official API. Captured browser cookies and private endpoints are never replayed.</ItemDescription></ItemContent><Badge variant="destructive">Blocked</Badge></Item><Item variant="outline"><ItemContent><ItemTitle>Packaged binary reload</ItemTitle><ItemDescription>SDK 0.0.1 provides JSON storage and write-only VFS, not readable channel artifacts. Browser preview media uses a separately named IndexedDB only.</ItemDescription></ItemContent><Badge variant="destructive">Blocked</Badge></Item><Item variant="outline"><ItemContent><ItemTitle>Global dock, pop-out, and channel sync</ItemTitle><ItemDescription>The descriptor requests a singleton surface, but SDK 0.0.1 exposes no host playback session, docking, pop-out, current-channel subscription, or canonical shared queue.</ItemDescription></ItemContent><Badge variant="destructive">Blocked</Badge></Item></ItemGroup></CardContent></Card>
        </div>
      </TabsContent>
    </Tabs>

    <Dialog open={briefEditor !== null} onOpenChange={(open) => { if (!open) closeBriefEditor(); }}>
      <DialogContent className="dialog-wide"><DialogHeader><DialogTitle>{briefEditor?.supersedesId ? `Revise song brief · v${briefEditor.version}` : "Draft a song brief"}</DialogTitle><DialogDescription>Review the exact outbound text. No channel message text is included unless it was summarized and approved first.</DialogDescription></DialogHeader>{briefEditor ? <FieldGroup><div className="form-grid"><Field><FieldLabel htmlFor="brief-title">Proposed title</FieldLabel><Input id="brief-title" value={briefEditor.title} onChange={(event) => setBriefEditor({ ...briefEditor, title: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-period">Source period</FieldLabel><Input id="brief-period" value={briefEditor.sourcePeriod} onChange={(event) => setBriefEditor({ ...briefEditor, sourcePeriod: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-genre">Genre / musical family</FieldLabel><Input id="brief-genre" value={briefEditor.genre} onChange={(event) => setBriefEditor({ ...briefEditor, genre: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-mood">Mood and arc</FieldLabel><Input id="brief-mood" value={briefEditor.mood} onChange={(event) => setBriefEditor({ ...briefEditor, mood: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-instrumentation">Instrumentation</FieldLabel><Input id="brief-instrumentation" value={briefEditor.instrumentation} onChange={(event) => setBriefEditor({ ...briefEditor, instrumentation: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-tempo">Tempo range</FieldLabel><Input id="brief-tempo" value={briefEditor.tempo} onChange={(event) => setBriefEditor({ ...briefEditor, tempo: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-vocals">Vocal direction</FieldLabel><Input id="brief-vocals" value={briefEditor.vocalStyle} onChange={(event) => setBriefEditor({ ...briefEditor, vocalStyle: event.target.value, outboundPrompt: "" })} disabled={briefEditor.lyricDirection === "instrumental"} /></Field><Field><FieldLabel htmlFor="brief-structure">Song structure</FieldLabel><Input id="brief-structure" value={briefEditor.structure} onChange={(event) => setBriefEditor({ ...briefEditor, structure: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-duration">Desired duration or form</FieldLabel><Input id="brief-duration" value={briefEditor.desiredDuration} onChange={(event) => setBriefEditor({ ...briefEditor, desiredDuration: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-count">Candidate count</FieldLabel><Input id="brief-count" type="number" min="1" max="4" value={briefEditor.candidateCount} onChange={(event) => setBriefEditor({ ...briefEditor, candidateCount: Number(event.target.value), outboundPrompt: "" })} /></Field></div><Field><FieldLabel htmlFor="brief-concept">Song concept / original lyric themes</FieldLabel><Textarea id="brief-concept" value={briefEditor.concept} onChange={(event) => setBriefEditor({ ...briefEditor, concept: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-summary">Approved channel summary</FieldLabel><Textarea id="brief-summary" value={briefEditor.channelSummary} onChange={(event) => setBriefEditor({ ...briefEditor, channelSummary: event.target.value, outboundPrompt: "" })} /></Field><Field><FieldLabel htmlFor="brief-exclusions">Required exclusions and redactions</FieldLabel><Textarea id="brief-exclusions" value={briefEditor.exclusions} onChange={(event) => setBriefEditor({ ...briefEditor, exclusions: event.target.value, outboundPrompt: "" })} /></Field><div className="form-grid"><Field><FieldLabel htmlFor="brief-lyrics">Lyrics</FieldLabel><NativeSelect id="brief-lyrics" value={briefEditor.lyricDirection} onChange={(event) => setBriefEditor({ ...briefEditor, lyricDirection: event.target.value as SongBrief["lyricDirection"], outboundPrompt: "" })}><option value="lyrics">Lyrics</option><option value="instrumental">Instrumental only</option></NativeSelect></Field><label className="check"><Checkbox checked={briefEditor.explicitAllowed} onCheckedChange={(checked) => setBriefEditor({ ...briefEditor, explicitAllowed: checked === true, outboundPrompt: "" })} /> Explicit content permitted</label></div><Field><FieldLabel htmlFor="exact-prompt">Exact outbound prompt</FieldLabel><Textarea id="exact-prompt" className="prompt-editor" value={exactDraftPrompt} onChange={(event) => setBriefEditor({ ...briefEditor, outboundPrompt: event.target.value })} rows={12} /></Field><CodeBlock code={exactDraftPrompt} language="text" highlight={false} /><label className="check rights"><Checkbox checked={briefReviewed} onCheckedChange={(checked) => setBriefReviewed(checked === true)} /> I reviewed this exact outbound text and confirm it contains only approved context, no living-artist imitation request, and the required exclusions.</label>{briefErrors.length ? <FieldError>{briefErrors.join(" ")}</FieldError> : null}<Alert><Check /><AlertTitle>Human-mediated boundary</AlertTitle><AlertDescription>Approval creates a manual-only candidate batch. It does not contact Suno, spend credits, or imply provider success.</AlertDescription></Alert></FieldGroup> : null}<DialogFooter><Button variant="outline" onClick={closeBriefEditor}>Cancel</Button><Button variant="secondary" onClick={() => void submitBrief(false)}>Save draft</Button><Button onClick={() => void submitBrief(true)} disabled={!briefReviewed}><Check /> Approve exact prompt</Button></DialogFooter></DialogContent>
    </Dialog>

    <Dialog open={briefVoteEditor !== null} onOpenChange={(open) => { if (!open) setBriefVoteEditor(null); }}>
      <DialogContent><DialogHeader><DialogTitle>Vote on “{briefVoteEditor?.briefTitle}”</DialogTitle><DialogDescription>Your latest response replaces your earlier response for this brief. Suggestions are visible to participants who can read this channel soundtrack.</DialogDescription></DialogHeader>{briefVoteEditor ? <FieldGroup><Field><FieldLabel htmlFor="brief-vote">Response</FieldLabel><NativeSelect id="brief-vote" value={briefVoteEditor.disposition} onChange={(event) => setBriefVoteEditor({ ...briefVoteEditor, disposition: event.target.value as BriefVote["disposition"] })}><option value="support">Support this brief</option><option value="needs-revision">Needs revision</option></NativeSelect></Field><Field><FieldLabel htmlFor="suggested-title">Optional title suggestion</FieldLabel><Input id="suggested-title" maxLength={160} value={briefVoteEditor.suggestedTitle} onChange={(event) => setBriefVoteEditor({ ...briefVoteEditor, suggestedTitle: event.target.value })} /></Field><Field><FieldLabel htmlFor="suggested-mood">Optional mood suggestion</FieldLabel><Input id="suggested-mood" maxLength={160} value={briefVoteEditor.suggestedMood} onChange={(event) => setBriefVoteEditor({ ...briefVoteEditor, suggestedMood: event.target.value })} /></Field><Field><FieldLabel htmlFor="suggested-genre">Optional genre suggestion</FieldLabel><Input id="suggested-genre" maxLength={160} value={briefVoteEditor.suggestedGenre} onChange={(event) => setBriefVoteEditor({ ...briefVoteEditor, suggestedGenre: event.target.value })} /></Field></FieldGroup> : null}<DialogFooter><Button variant="outline" onClick={() => setBriefVoteEditor(null)}>Cancel</Button><Button onClick={() => void submitBriefVote()}><Users /> Save feedback</Button></DialogFooter></DialogContent>
    </Dialog>

    <Dialog open={summaryEditor !== null} onOpenChange={(open) => !open && setSummaryEditor(null)}>
      <DialogContent className="dialog-wide"><DialogHeader><DialogTitle>Review conversation summary</DialogTitle><DialogDescription>{summaryEditor?.summary.provenance === "tap-specialist" ? "A real TAP specialist drafted this text. It is unapproved until you complete every privacy check." : "This human-authored draft remains inside TAP until you approve it."}</DialogDescription></DialogHeader>{summaryEditor ? <FieldGroup><Field><FieldLabel htmlFor="summary-safe">Grounded safe summary</FieldLabel><Textarea id="summary-safe" value={summaryEditor.summary.safeSummary} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, safeSummary: event.target.value } })} /></Field><div className="form-grid"><Field><FieldLabel htmlFor="summary-themes">Safe themes</FieldLabel><Textarea id="summary-themes" value={summaryEditor.summary.themes} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, themes: event.target.value } })} /></Field><Field><FieldLabel htmlFor="summary-arc">Emotional arc</FieldLabel><Textarea id="summary-arc" value={summaryEditor.summary.emotionalArc} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, emotionalArc: event.target.value } })} /></Field><Field><FieldLabel htmlFor="summary-private">Private details removed</FieldLabel><Textarea id="summary-private" value={summaryEditor.summary.privateDetailsRemoved} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, privateDetailsRemoved: event.target.value } })} /></Field><Field><FieldLabel htmlFor="summary-concepts">Candidate song concepts</FieldLabel><Textarea id="summary-concepts" value={summaryEditor.summary.candidateConcepts} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, candidateConcepts: event.target.value } })} /></Field></div><Field><FieldLabel htmlFor="summary-exclusions">Required exclusions</FieldLabel><Textarea id="summary-exclusions" value={summaryEditor.summary.exclusions} onChange={(event) => setSummaryEditor({ ...summaryEditor, summary: { ...summaryEditor.summary, exclusions: event.target.value } })} /></Field><div className="privacy-checks"><label className="check"><Checkbox checked={summaryEditor.checks.personalDataRemoved} onCheckedChange={(checked) => setSummaryEditor({ ...summaryEditor, checks: { ...summaryEditor.checks, personalDataRemoved: checked === true } })} /> Personal and customer data removed</label><label className="check"><Checkbox checked={summaryEditor.checks.secretsRemoved} onCheckedChange={(checked) => setSummaryEditor({ ...summaryEditor, checks: { ...summaryEditor.checks, secretsRemoved: checked === true } })} /> Secrets, credentials, and codenames removed</label><label className="check"><Checkbox checked={summaryEditor.checks.sensitiveMomentsExcluded} onCheckedChange={(checked) => setSummaryEditor({ ...summaryEditor, checks: { ...summaryEditor.checks, sensitiveMomentsExcluded: checked === true } })} /> Conflict, grief, personnel matters, incidents, and harassment excluded</label><label className="check"><Checkbox checked={summaryEditor.checks.quotationsApproved} onCheckedChange={(checked) => setSummaryEditor({ ...summaryEditor, checks: { ...summaryEditor.checks, quotationsApproved: checked === true } })} /> No direct quotations remain, or every quoted participant approved them</label></div></FieldGroup> : null}<DialogFooter><Button variant="outline" onClick={() => void submitSummary("rejected")}>Reject and retain</Button><Button variant="secondary" onClick={() => void submitSummary("draft")}>Save draft</Button><Button onClick={() => void submitSummary("approved")} disabled={!summaryEditor || Object.values(summaryEditor.checks).some((checked) => !checked)}><ShieldCheck /> Approve summary</Button></DialogFooter></DialogContent>
    </Dialog>

    <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportFile(null); }}>
      <DialogContent className="dialog-wide"><DialogHeader><DialogTitle>Import user-owned audio</DialogTitle><DialogDescription>{preview ? "Browser preview stores this file in its separately named IndexedDB so reload can be tested." : "Audio is decoded locally and remains available for this packaged surface session. SDK 0.0.1 cannot read a persisted binary artifact after reload."}</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="audio-file">Audio file</FieldLabel><Input id="audio-file" type="file" accept="audio/*" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} /></Field><div className="form-grid"><Field><FieldLabel htmlFor="track-title">Track title</FieldLabel><Input id="track-title" value={importForm.title} onChange={(event) => setImportForm({ ...importForm, title: event.target.value })} /></Field><Field><FieldLabel htmlFor="track-contributor">Contributor</FieldLabel><Input id="track-contributor" value={importForm.contributor} onChange={(event) => setImportForm({ ...importForm, contributor: event.target.value })} /></Field><Field><FieldLabel htmlFor="track-provider">Source / provider</FieldLabel><Input id="track-provider" value={importForm.provider} onChange={(event) => setImportForm({ ...importForm, provider: event.target.value })} placeholder="Enter the actual source" /></Field><Field><FieldLabel htmlFor="track-period">Creation / source period</FieldLabel><Input id="track-period" value={importForm.sourcePeriod} onChange={(event) => setImportForm({ ...importForm, sourcePeriod: event.target.value })} /></Field><Field><FieldLabel htmlFor="track-source-url">Optional HTTPS source link</FieldLabel><Input id="track-source-url" type="url" value={importForm.sourceUrl} onChange={(event) => setImportForm({ ...importForm, sourceUrl: event.target.value })} /></Field><Field><FieldLabel htmlFor="track-batch">Approved manual batch</FieldLabel><NativeSelect id="track-batch" value={importForm.batchId} onChange={(event) => setImportForm({ ...importForm, batchId: event.target.value })}><option value="">No linked batch</option>{activeBatches.map((batch) => { const brief = channelState.briefs.find((candidate) => candidate.id === batch.briefId); return <option key={batch.id} value={batch.id}>{brief?.title ?? batch.id} · {batch.importedTrackIds.length}/{batch.targetCount}</option>; })}</NativeSelect></Field><Field><FieldLabel htmlFor="track-visibility">Initial visibility</FieldLabel><NativeSelect id="track-visibility" value={importForm.visibility} onChange={(event) => setImportForm({ ...importForm, visibility: event.target.value as ImportFormState["visibility"] })}><option value="private-draft">Private draft</option><option value="channel-only">Channel only</option></NativeSelect></Field><Field><FieldLabel htmlFor="track-warning">Content warning</FieldLabel><Input id="track-warning" value={importForm.contentWarning} onChange={(event) => setImportForm({ ...importForm, contentWarning: event.target.value })} /></Field></div><Field><FieldLabel htmlFor="track-rights">Subscription or license basis</FieldLabel><Textarea id="track-rights" value={importForm.rightsBasis} onChange={(event) => setImportForm({ ...importForm, rightsBasis: event.target.value })} /></Field><div className="form-grid"><label className="check"><Checkbox checked={importForm.instrumental} onCheckedChange={(checked) => setImportForm({ ...importForm, instrumental: checked === true })} /> Instrumental track</label><label className="check"><Checkbox checked={importForm.explicit} onCheckedChange={(checked) => setImportForm({ ...importForm, explicit: checked === true })} /> Contains explicit content</label></div><label className="check rights"><Checkbox checked={importForm.rights} onCheckedChange={(checked) => setImportForm({ ...importForm, rights: checked === true })} /> I confirm I have the rights necessary to store, play, and share this exact track with the selected audience.</label></FieldGroup><DialogFooter><Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button><Button disabled={!importFile || !importForm.rights || status === "saving" || status === "running"} onClick={() => void submitImport()}>{status === "running" ? <LoaderCircle className="spin" /> : <Download />} Import owned track</Button></DialogFooter></DialogContent>
    </Dialog>

    <AlertDialog open={retireTarget !== null} onOpenChange={(open) => !open && setRetireTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Retire “{retireTarget?.title}”?</AlertDialogTitle><AlertDialogDescription>The track leaves every playback queue but remains in the album history. You can undo immediately after retirement.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void confirmRetire()}>Retire track</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

    <AlertDialog open={visibilityTarget !== null} onOpenChange={(open) => !open && setVisibilityTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Review broader visibility</AlertDialogTitle><AlertDialogDescription>Move “{visibilityTarget?.title}” from {visibilityTarget?.visibility.replaceAll("-", " ")} to {visibilityTarget?.visibility === "private-draft" ? "channel only" : "workspace visible"}. Public publication is not available.</AlertDialogDescription></AlertDialogHeader><div className="privacy-checks"><label className="check"><Checkbox checked={visibilityChecks.rights} onCheckedChange={(checked) => setVisibilityChecks({ ...visibilityChecks, rights: checked === true })} /> Rights and attribution remain valid for the broader audience</label><label className="check"><Checkbox checked={visibilityChecks.privacy} onCheckedChange={(checked) => setVisibilityChecks({ ...visibilityChecks, privacy: checked === true })} /> Source context and participant privacy were reviewed for this audience</label></div><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={!visibilityChecks.rights || !visibilityChecks.privacy} onClick={() => void confirmVisibility()}>Confirm visibility</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
