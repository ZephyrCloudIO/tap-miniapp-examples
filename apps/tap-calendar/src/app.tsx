import { WorkspaceBookingPanel } from "./workspace-booking-panel";
import { applyPublicBookingAnalytics } from "./public-booking-analytics";
import { usePublicBookingAnalytics } from "./use-public-booking-analytics";
import type { TapFederatedSurfaceMountContext } from "@theaiplatform/miniapp-sdk/surface";
import { isMiniAppHostActionError, sdk } from "@theaiplatform/miniapp-sdk/sdk";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Textarea,
} from "@theaiplatform/miniapp-sdk/ui";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  Globe2,
  Link2,
  ListFilter,
  LockKeyhole,
  Menu,
  MessageSquareText,
  Minus,
  MoreHorizontal,
  MousePointerClick,
  Plus,
  Radio,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  SquareCheckBig,
  Unplug,
  Users,
  Video,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useEffect,
  useEffectEvent,
  useContext,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { CalendarBoard } from "./calendar-board";
import { CalendarContextMenu } from "./calendar-context-menu";
import { copyTextToClipboard } from "./clipboard";
import {
  horizontalCalendarWheelDelta,
  shiftCalendarAnchor,
  type CalendarRangeDirection,
} from "./calendar-navigation";
import {
  CALENDAR_APPROVE_ACTION,
  CALENDAR_MANAGE_ACTION,
  CALENDAR_PUBLISH_ACTION,
  CHANNELS_READ_ACTION,
  NETWORK_REQUEST_ACTION,
  requireCalendarAuthority,
  requireCalendarMountAuthority,
  type CalendarAuthorityAction,
} from "./authority";
import {
  addCalendarsToAccount,
  addAvailabilitySchedule,
  addBookingProfile,
  addConnectedAccount,
  addEventType,
  allCalendars,
  applyAvailabilityBookingPolicy,
  availabilityForDate,
  conversionRate,
  createAdditionalAvailabilityWindow,
  createWorkBlock,
  decideBookingRequest,
  disconnectCalendarAccount,
  expireBookingRequest,
  deriveBookingProfilePublicationState,
  isEventTypePublicationLive,
  enforceImmutablePublicationSlugs,
  findAvailableSlotsAcrossWindows,
  preferredDestinationCalendar,
  publicBookingUrl,
  removeCalendarFromTap,
  renameCalendarAccount,
  resolveEventTypeAvailabilityScheduleId,
  scheduleMeeting,
  schedulePublicBooking,
  setCalendarView,
  trackFunnel,
  updateCalendar,
  updateCalendarAccountCalendars,
  updateNotificationPreferences,
  validateAvailabilityWindows,
  validateGuestCompatibility,
  validateSlug,
  visibleEvents,
  type AvailabilitySchedule,
  type AvailabilityOverride,
  type AvailabilityWindow,
  type AvailableSlot,
  type BookingProfile,
  type CalendarAccount,
  type CalendarAttendee,
  type CalendarEvent,
  type CalendarProvider,
  type CalendarRole,
  type CalendarState,
  type CalendarView,
  type ConnectedCalendar,
  type ConnectedCalendarInput,
  type EventType,
  type MeetingLocation,
  type NewEventType,
} from "./domain";
import {
  CalendarStorageConflictError,
  loadCalendarState,
  resetPreviewCalendar,
  saveCalendarState,
} from "./storage";
import {
  createCalendarPlatform,
  createPreviewCalendarHostRuntime,
  type CalendarPlatform,
  type TapTaskWorkBlockSource,
} from "./platform";
import {
  calendarGatewayPrincipalAccess,
  CalendarGatewayError,
  createCalendarGatewayClient,
  createFetchCalendarGatewayTransport,
  createTapCalendarGatewayTransport,
  resolveCalendarGatewayUrl,
  type CalendarGatewayClient,
  type CalendarGatewayBookingStatus,
  type CalendarGatewayCommittedBooking,
  type CalendarGatewayConnection,
  type CalendarGatewayMeetingProviderConnection,
  type CalendarGatewayPrincipalAccess,
  type CalendarGatewayProviderCatalog,
  type LocalCalendarGatewayInput,
} from "./gateway";
import { providerConnectionCapabilities } from "./provider-connection-capabilities";
import {
  providerConnectionErrorMessage,
  providerUnavailableDescription,
} from "./provider-connection-copy";
import {
  openProviderAuthorization,
  providerExternalNavigationErrorMessage,
  type OAuthNavigationProvider,
  type ProviderExternalNavigationApi,
} from "./provider-external-navigation";
import {
  enqueuePublicBookingProfileSync,
  reconcilePublicBookingProfilePublication,
  type PublicBookingProfileSyncOperation,
} from "./publication-sync";
import { markChangedPublicBookingProfilesPending } from "./publication-state";
import {
  CALENDAR_EVENT_REFRESH_INTERVAL_MS,
  useCalendarEventCache,
  type ProviderEventSyncState,
} from "./use-calendar-event-cache";
import {
  createProviderBookingOutbox,
  type CommittedProviderApprovalResolutionOutboxRecord,
  type CommittedProviderBookingOutboxRecord,
  type ProviderApprovalResolutionOutboxPreparation,
  type ProviderBookingOutboxProviderRequest,
  type ProviderBookingReconciliation,
} from "./provider-booking-outbox";
import {
  channelInviteCandidates,
  channelParticipantsCapability,
  loadChannelParticipants,
  type TapChannelParticipant,
} from "./channel-participants";
import { TimeZoneCombobox } from "./time-zone-combobox";
import {
  detectedTimeZone,
  isSupportedTimeZone,
  timeZoneDisplayLabel,
  timeZoneDisplayLabelForDate,
} from "./time-zone";

type Section =
  | "calendar"
  | "availability"
  | "booking-pages"
  | "notifications"
  | "automations"
  | "settings";

interface TapCalendarAppProps {
  readonly preview?: boolean;
  readonly context?: TapFederatedSurfaceMountContext;
}

export const CHANNEL_SCHEDULER_SURFACE_ID =
  "tap-calendar-channel-scheduler";
const CALENDAR_CHANGED_SUBSCRIPTION =
  "tap-pkg.examples-tap-calendar.calendar.changed";

type ChannelParticipantRoster =
  | { readonly status: "loading"; readonly participants: readonly [] }
  | { readonly status: "unavailable"; readonly participants: readonly [] }
  | {
      readonly status: "error";
      readonly participants: readonly [];
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly participants: readonly TapChannelParticipant[];
    };

type EntityIdFactory = (prefix: string) => string;

const EntityIdContext = createContext<EntityIdFactory>(prefix =>
  `${prefix}-${globalThis.crypto.randomUUID()}`,
);

const useEntityId = (): EntityIdFactory => useContext(EntityIdContext);

type StateMutation = (current: CalendarState) => CalendarState;
type CommitCalendarState = (
  mutation: StateMutation,
  successMessage?: string,
  actionId?: CalendarAuthorityAction,
) => Promise<boolean>;

type PersistCalendarState = (
  mutation: StateMutation,
  successMessage?: string,
) => Promise<boolean>;

interface ProviderBackedSubmissionResult {
  readonly error: string | null;
  readonly retrySameAttempt: boolean;
}

type CalendarConnectionTarget =
  | { readonly kind: "account" }
  | { readonly kind: "calendars"; readonly accountId: string };

type MeetingProviderConnectionsState =
  | {
      readonly status: "loading" | "ready";
      readonly connections: readonly CalendarGatewayMeetingProviderConnection[];
      readonly message: null;
    }
  | {
      readonly status: "error";
      readonly connections: readonly CalendarGatewayMeetingProviderConnection[];
      readonly message: string;
    };

type RefreshMeetingProviderConnections = () => Promise<
  readonly CalendarGatewayMeetingProviderConnection[]
>;

type RequireCalendarManage = () => Promise<void>;

interface ProviderBookingReservationInput {
  readonly actionId: CalendarAuthorityAction;
  readonly idempotencyKey: string;
  readonly destinationCalendarId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly conflictTimeMin?: string;
  readonly conflictTimeMax?: string;
  readonly bookingKind: "meeting" | "approval-hold" | "work-block";
  readonly location?: MeetingLocation | null;
  readonly attendees?: readonly CalendarAttendee[];
  readonly expiresAt?: string;
  readonly reconciliation: ProviderBookingReconciliation;
}

type ReserveProviderBooking = (
  input: ProviderBookingReservationInput,
) => Promise<
  | { readonly ok: true; readonly booking: CalendarGatewayCommittedBooking }
  | {
      readonly ok: false;
      readonly error: string;
      readonly retrySameAttempt: boolean;
    }
>;

const conflictCalendarIdsForSlot = (
  state: CalendarState,
  destinationCalendarId: string,
): readonly string[] => [
  ...new Set(
    allCalendars(state)
      .filter(calendar => calendar.conflicts || calendar.id === destinationCalendarId)
      .map(calendar => calendar.id),
  ),
].sort();

const accountForCalendar = (
  state: CalendarState,
  calendarId: string,
): CalendarAccount | undefined =>
  state.accounts.find(account =>
    account.calendars.some(calendar => calendar.id === calendarId)
  );

const supportsProviderBookingWrites = (
  state: CalendarState,
  calendar: ConnectedCalendar,
): boolean =>
  calendar.writable &&
  accountForCalendar(state, calendar.id)?.provider === "google";

const providerWritableDestination = (
  state: CalendarState,
): ConnectedCalendar | undefined =>
  allCalendars(state).find(calendar =>
    calendar.destination && supportsProviderBookingWrites(state, calendar)
  );

type ProviderPrincipalAccessState =
  | {
      readonly status: "loading";
      readonly value: CalendarGatewayPrincipalAccess;
    }
  | {
      readonly status: "ready";
      readonly value: CalendarGatewayPrincipalAccess;
    }
  | {
      readonly status: "error";
      readonly value: CalendarGatewayPrincipalAccess;
      readonly message: string;
    };

const EMPTY_PRINCIPAL_ACCESS: CalendarGatewayPrincipalAccess = {
  calendarIds: [],
  writableGoogleDestinationIds: [],
};

const principalWritableDestination = (
  state: CalendarState,
  access: ProviderPrincipalAccessState,
): ConnectedCalendar | undefined => {
  if (access.status !== "ready") return undefined;
  const allowed = new Set(access.value.writableGoogleDestinationIds);
  return allCalendars(state).find(calendar =>
    allowed.has(calendar.id) &&
    calendar.destination &&
    supportsProviderBookingWrites(state, calendar)
  );
};

const isActivePendingRequest = (
  request: CalendarState["bookingRequests"][number],
  now = Date.now(),
): boolean =>
  request.status === "pending" && Date.parse(request.expiresAt) > now;

interface ProviderBookingLocalReconciliationResult {
  readonly state: CalendarState;
  readonly error: string | null;
  readonly localEventId: string;
  readonly alreadyReconciled: boolean;
}

function reconcileCommittedProviderBooking(
  state: CalendarState,
  record: CommittedProviderBookingOutboxRecord,
): ProviderBookingLocalReconciliationResult {
  const { booking } = record.providerCommit;
  const intent = record.reconciliation;
  if (intent.kind === "work-block") {
    const existing = state.events.find(event => event.id === booking.event.id);
    if (existing) {
      const exact =
        existing.calendarId === intent.calendarId &&
        existing.title === intent.title &&
        existing.start === intent.start &&
        existing.end === intent.end &&
        existing.kind === "work-block" &&
        existing.source?.kind === intent.sourceKind &&
        existing.source.id === intent.sourceId &&
        existing.source.label === intent.sourceLabel;
      return {
        state: exact && booking.providerHtmlLink &&
            existing.providerHtmlLink !== booking.providerHtmlLink
          ? {
              ...state,
              events: state.events.map(event =>
                event.id === existing.id
                  ? { ...event, providerHtmlLink: booking.providerHtmlLink! }
                  : event,
              ),
            }
          : state,
        error: exact
          ? null
          : "The provider Work Block conflicts with an existing local Event identifier.",
        localEventId: booking.event.id,
        alreadyReconciled: exact,
      };
    }
    const next = createWorkBlock(state, {
      id: booking.event.id,
      calendarId: intent.calendarId,
      title: intent.title,
      start: intent.start,
      end: intent.end,
      sourceKind: intent.sourceKind,
      sourceId: intent.sourceId,
      sourceLabel: intent.sourceLabel,
      ...(booking.providerHtmlLink
        ? { providerHtmlLink: booking.providerHtmlLink }
        : {}),
    });
    return {
      state: next,
      error: next === state
        ? "The provider Work Block could not be reconciled into TAP Calendar."
        : null,
      localEventId: booking.event.id,
      alreadyReconciled: false,
    };
  }

  const input = {
    id: booking.event.id,
    ...(intent.approvalRequired
      ? { bookingRequestId: record.idempotencyKey }
      : {}),
    ...(booking.providerHtmlLink
      ? { providerHtmlLink: booking.providerHtmlLink }
      : {}),
    ...(booking.providerJoinUrl
      ? { providerJoinUrl: booking.providerJoinUrl }
      : {}),
    title: intent.title,
    calendarId: intent.calendarId,
    start: intent.start,
    end: intent.end,
    location: intent.location,
    attendees: intent.attendees,
    approvalRequired: intent.approvalRequired,
    ...(intent.eventTypeId ? { eventTypeId: intent.eventTypeId } : {}),
    requestedAt: intent.requestedAt,
  };
  const scheduled = intent.kind === "public-booking"
    ? schedulePublicBooking(state, {
        ...input,
        eventTypeId: intent.eventTypeId!,
      })
    : scheduleMeeting(state, input);
  const stateWithProviderLinks = scheduled.error === null
    ? {
        ...scheduled.state,
        events: scheduled.state.events.map(event =>
          event.id === booking.event.id
            ? {
                ...event,
                ...(booking.providerHtmlLink
                  ? { providerHtmlLink: booking.providerHtmlLink }
                  : {}),
                ...(booking.providerJoinUrl
                  ? { providerJoinUrl: booking.providerJoinUrl }
                  : {}),
              }
            : event,
        ),
      }
    : scheduled.state;
  const changedOnlyForIdentity = JSON.stringify(stateWithProviderLinks) ===
    JSON.stringify(state);
  return {
    state: changedOnlyForIdentity ? state : stateWithProviderLinks,
    error: scheduled.error,
    localEventId: booking.event.id,
    alreadyReconciled: scheduled.error === null && scheduled.state === state,
  };
}

function committedProviderBookingIsReconciled(
  state: CalendarState,
  record: CommittedProviderBookingOutboxRecord,
): boolean {
  const result = reconcileCommittedProviderBooking(state, record);
  return result.error === null && result.state === state;
}

const approvalBookingEventMatchesIntent = (
  event: CalendarEvent,
  record: CommittedProviderBookingOutboxRecord,
): boolean => {
  const intent = record.reconciliation;
  if (intent.kind === "work-block" || !intent.approvalRequired) return false;
  return event.id === record.providerCommit.booking.event.id &&
    event.title === intent.title &&
    event.calendarId === intent.calendarId &&
    event.start === intent.start &&
    event.end === intent.end &&
    event.location === intent.location &&
    JSON.stringify(event.attendees) === JSON.stringify(intent.attendees);
};

const restoreExpiredApproval = (
  state: CalendarState,
  requestId: string,
  eventId: string,
): CalendarState => ({
  ...state,
  bookingRequests: state.bookingRequests.map(request =>
    request.id === requestId ? { ...request, status: "pending" } : request,
  ),
  events: state.events.map(event =>
    event.id === eventId
      ? { ...event, status: "pending", kind: "hold", busy: true }
      : event,
  ),
  notificationChannels: state.notificationChannels.map(channel => ({
    ...channel,
    entries: channel.entries.filter(entry => entry.id !== `${requestId}-expired`),
  })),
});

function reconcileProviderBookingLifecycle(
  state: CalendarState,
  record: CommittedProviderBookingOutboxRecord,
  status: CalendarGatewayBookingStatus,
): ProviderBookingLocalReconciliationResult {
  const intent = record.reconciliation;
  if (intent.kind === "work-block" || !intent.approvalRequired) {
    return {
      state,
      error: "The provider returned an approval lifecycle for a non-approval booking.",
      localEventId: record.providerCommit.booking.event.id,
      alreadyReconciled: false,
    };
  }

  let next = state;
  let request = next.bookingRequests.find(candidate => candidate.id === record.idempotencyKey);
  let event = next.events.find(
    candidate => candidate.id === record.providerCommit.booking.event.id,
  );
  if (!request && !event) {
    const initial = reconcileCommittedProviderBooking(next, record);
    if (initial.error) return initial;
    next = initial.state;
    request = next.bookingRequests.find(candidate => candidate.id === record.idempotencyKey);
    event = next.events.find(
      candidate => candidate.id === record.providerCommit.booking.event.id,
    );
  }
  if (
    !request ||
    !event ||
    request.eventId !== record.providerCommit.booking.event.id ||
    !approvalBookingEventMatchesIntent(event, record)
  ) {
    return {
      state,
      error: "The local approval request no longer matches the provider booking.",
      localEventId: record.providerCommit.booking.event.id,
      alreadyReconciled: false,
    };
  }

  const lifecycle = status.lifecycle.state;
  const targetStatus = lifecycle === "approved"
    ? "confirmed"
    : lifecycle === "declined"
      ? "declined"
      : lifecycle === "expired"
        ? "cancelled"
        : "pending";
  if (lifecycle === "active") {
    return reconcileCommittedProviderBooking(next, record);
  }
  if (request.status === targetStatus && event.status === targetStatus) {
    const joinUrl = lifecycle === "approved"
      ? status.currentEvent?.providerJoinUrl ?? status.commit.booking.providerJoinUrl
      : null;
    const withLink = joinUrl && event.providerJoinUrl !== joinUrl
      ? {
          ...next,
          events: next.events.map(candidate =>
            candidate.id === event!.id
              ? { ...candidate, providerJoinUrl: joinUrl }
              : candidate,
          ),
        }
      : next;
    return {
      state: withLink,
      error: null,
      localEventId: event.id,
      alreadyReconciled: withLink === state,
    };
  }
  if (
    request.status === "cancelled" &&
    event.status === "cancelled" &&
    lifecycle !== "expired"
  ) {
    next = restoreExpiredApproval(next, request.id, event.id);
    request = next.bookingRequests.find(candidate => candidate.id === request!.id)!;
    event = next.events.find(candidate => candidate.id === event!.id)!;
  }
  if (request.status !== "pending" || event.kind !== "hold" || event.status !== "pending") {
    return {
      state,
      error: "The local approval changed before the provider lifecycle could be reconciled.",
      localEventId: event.id,
      alreadyReconciled: false,
    };
  }

  const resolvedAt = status.lifecycle.resolvedAt ?? new Date().toISOString();
  let reconciled = lifecycle === "expired"
    ? expireBookingRequest(next, request.id, resolvedAt)
    : decideBookingRequest(
        next,
        request.id,
        lifecycle === "approved" ? "confirmed" : "declined",
        resolvedAt,
      );
  const joinUrl = lifecycle === "approved"
    ? status.currentEvent?.providerJoinUrl ?? status.commit.booking.providerJoinUrl
    : null;
  if (joinUrl) {
    reconciled = {
      ...reconciled,
      events: reconciled.events.map(candidate =>
        candidate.id === event!.id
          ? { ...candidate, providerJoinUrl: joinUrl }
          : candidate,
      ),
    };
  }
  return {
    state: reconciled,
    error: null,
    localEventId: event.id,
    alreadyReconciled: false,
  };
}

interface ProviderApprovalLocalReconciliationResult {
  readonly state: CalendarState;
  readonly error: string | null;
  readonly localEventId: string;
}

const approvalEventMatchesExpected = (
  event: CalendarEvent,
  expected: CommittedProviderApprovalResolutionOutboxRecord["reconciliation"]["expectedEvent"],
): boolean =>
  event.id === expected.id &&
  event.title === expected.title &&
  event.calendarId === expected.calendarId &&
  event.start === expected.start &&
  event.end === expected.end &&
  event.location === expected.location &&
  JSON.stringify(event.attendees) === JSON.stringify(expected.attendees);

function reconcileApprovalStatusLifecycle(
  state: CalendarState,
  bookingRequestId: string,
  expected: CommittedProviderApprovalResolutionOutboxRecord["reconciliation"]["expectedEvent"],
  status: CalendarGatewayBookingStatus,
): ProviderApprovalLocalReconciliationResult {
  if (status.lifecycle.state === "active") {
    return {
      state,
      error: "The provider approval is still active.",
      localEventId: expected.id,
    };
  }
  let next = state;
  let request = next.bookingRequests.find(candidate => candidate.id === bookingRequestId);
  let event = next.events.find(candidate => candidate.id === expected.id);
  if (
    !request ||
    !event ||
    request.eventId !== event.id ||
    !approvalEventMatchesExpected(event, expected)
  ) {
    return {
      state,
      error: "The local approval no longer matches the provider lifecycle.",
      localEventId: expected.id,
    };
  }
  const targetStatus = status.lifecycle.state === "approved"
    ? "confirmed"
    : status.lifecycle.state === "declined"
      ? "declined"
      : "cancelled";
  if (request.status === targetStatus && event.status === targetStatus) {
    const joinUrl = status.lifecycle.state === "approved"
      ? status.currentEvent?.providerJoinUrl ?? status.commit.booking.providerJoinUrl
      : null;
    const withLink = joinUrl && event.providerJoinUrl !== joinUrl
      ? {
          ...next,
          events: next.events.map(candidate =>
            candidate.id === event!.id
              ? { ...candidate, providerJoinUrl: joinUrl }
              : candidate,
          ),
        }
      : next;
    return { state: withLink, error: null, localEventId: event.id };
  }
  if (
    request.status === "cancelled" &&
    event.status === "cancelled" &&
    status.lifecycle.state !== "expired"
  ) {
    next = restoreExpiredApproval(next, request.id, event.id);
    request = next.bookingRequests.find(candidate => candidate.id === request!.id)!;
    event = next.events.find(candidate => candidate.id === event!.id)!;
  }
  if (request.status !== "pending" || event.kind !== "hold" || event.status !== "pending") {
    return {
      state,
      error: "The local approval changed before the provider lifecycle was recovered.",
      localEventId: event.id,
    };
  }
  const resolvedAt = status.lifecycle.resolvedAt ?? request.expiresAt;
  let reconciled = status.lifecycle.state === "expired"
    ? expireBookingRequest(next, request.id, resolvedAt)
    : decideBookingRequest(
        next,
        request.id,
        status.lifecycle.state === "approved" ? "confirmed" : "declined",
        resolvedAt,
      );
  const joinUrl = status.lifecycle.state === "approved"
    ? status.currentEvent?.providerJoinUrl ?? status.commit.booking.providerJoinUrl
    : null;
  if (joinUrl) {
    reconciled = {
      ...reconciled,
      events: reconciled.events.map(candidate =>
        candidate.id === event!.id
          ? { ...candidate, providerJoinUrl: joinUrl }
          : candidate,
      ),
    };
  }
  return { state: reconciled, error: null, localEventId: event.id };
}

function reconcileMissingApprovalHold(
  state: CalendarState,
  bookingRequestId: string,
  expected: CommittedProviderApprovalResolutionOutboxRecord["reconciliation"]["expectedEvent"],
  removedAt: string,
): ProviderApprovalLocalReconciliationResult {
  const request = state.bookingRequests.find(candidate => candidate.id === bookingRequestId);
  const event = state.events.find(candidate => candidate.id === expected.id);
  if (
    !request ||
    !event ||
    request.eventId !== event.id ||
    !approvalEventMatchesExpected(event, expected)
  ) {
    return {
      state,
      error: "The missing provider Hold no longer matches the local approval.",
      localEventId: expected.id,
    };
  }
  if (
    request.status === "cancelled" &&
    event.status === "cancelled" &&
    event.busy === false
  ) {
    return { state, error: null, localEventId: event.id };
  }
  if (request.status !== "pending" || event.kind !== "hold" || event.status !== "pending") {
    return {
      state,
      error: "The local approval changed after its provider Hold disappeared.",
      localEventId: event.id,
    };
  }
  return {
    state: expireBookingRequest(state, request.id, removedAt),
    error: null,
    localEventId: event.id,
  };
}

function reconcileCommittedApprovalResolution(
  state: CalendarState,
  record: CommittedProviderApprovalResolutionOutboxRecord,
): ProviderApprovalLocalReconciliationResult {
  const { reconciliation, providerResolution } = record;
  const request = state.bookingRequests.find(
    candidate => candidate.id === reconciliation.bookingRequestId,
  );
  const event = request
    ? state.events.find(candidate => candidate.id === request.eventId)
    : undefined;
  if (!request || !event || event.id !== reconciliation.expectedEvent.id) {
    return {
      state,
      error: "The local approval request no longer matches its provider resolution.",
      localEventId: reconciliation.expectedEvent.id,
    };
  }
  const targetStatus = reconciliation.decision === "approve"
    ? "confirmed"
    : "declined";
  if (
    request.status === "cancelled" &&
    event.status === "cancelled" &&
    approvalEventMatchesExpected(event, reconciliation.expectedEvent)
  ) {
    const restored: CalendarState = {
      ...state,
      bookingRequests: state.bookingRequests.map(candidate =>
        candidate.id === request.id ? { ...candidate, status: "pending" } : candidate,
      ),
      events: state.events.map(candidate =>
        candidate.id === event.id
          ? { ...candidate, status: "pending", kind: "hold", busy: true }
          : candidate,
      ),
      notificationChannels: state.notificationChannels.map(channel => ({
        ...channel,
        entries: channel.entries.filter(entry => entry.id !== `${request.id}-expired`),
      })),
    };
    return reconcileCommittedApprovalResolution(restored, record);
  }
  if (
    request.status === targetStatus &&
    event.status === targetStatus &&
    approvalEventMatchesExpected(event, reconciliation.expectedEvent)
  ) {
    const joinUrl = providerResolution.resolution.providerJoinUrl;
    const next = reconciliation.decision === "approve" && joinUrl &&
        event.providerJoinUrl !== joinUrl
      ? {
          ...state,
          events: state.events.map(candidate =>
            candidate.id === event.id
              ? { ...candidate, providerJoinUrl: joinUrl }
              : candidate,
          ),
        }
      : state;
    return { state: next, error: null, localEventId: event.id };
  }
  if (
    request.status !== "pending" ||
    event.kind !== "hold" ||
    event.status !== "pending" ||
    !approvalEventMatchesExpected(event, reconciliation.expectedEvent)
  ) {
    return {
      state,
      error: "The local approval changed before its provider resolution could be reconciled.",
      localEventId: event.id,
    };
  }
  const decided = decideBookingRequest(
    state,
    request.id,
    reconciliation.decision === "approve" ? "confirmed" : "declined",
    providerResolution.resolvedAt,
  );
  const joinUrl = providerResolution.resolution.providerJoinUrl;
  return {
    state: reconciliation.decision === "approve" && joinUrl
      ? {
          ...decided,
          events: decided.events.map(candidate =>
            candidate.id === event.id
              ? { ...candidate, providerJoinUrl: joinUrl }
              : candidate,
          ),
        }
      : decided,
    error: null,
    localEventId: event.id,
  };
}

function committedApprovalResolutionIsReconciled(
  state: CalendarState,
  record: CommittedProviderApprovalResolutionOutboxRecord,
): boolean {
  const result = reconcileCommittedApprovalResolution(state, record);
  return result.error === null && result.state === state;
}

const navigation = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "availability", label: "Availability", icon: CalendarClock },
  { id: "booking-pages", label: "Booking pages", icon: Globe2 },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "automations", label: "Automations", icon: Workflow },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;

const sectionCopy: Readonly<Record<Section, { title: string; description: string }>> = {
  calendar: {
    title: "Calendar",
    description: "Every calendar, meeting, task, and channel block in one place.",
  },
  availability: {
    title: "Availability",
    description: "Shape when people can book you across every connected calendar.",
  },
  "booking-pages": {
    title: "Booking pages",
    description: "Publish accountless scheduling at cal.with-tap.ai and understand conversion.",
  },
  notifications: {
    title: "Calendar notifications",
    description: "Approvals, meeting changes, reminders, and shared scheduling summaries.",
  },
  automations: {
    title: "Automations & tools",
    description: "Use TAP workflow nodes and specialist-safe calendar tools.",
  },
  settings: {
    title: "Calendar settings",
    description: "Manage connections, calendar roles, reminders, privacy, and defaults.",
  },
};

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function calendarEventAgeLabel(value: string, now: number): string {
  const elapsedMinutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

const calendarDateKey = (date: Date): string => date.toISOString().slice(0, 10);
const calendarDateAfter = (amount: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + amount);
  return calendarDateKey(date);
};
const parseCalendarDate = (value: string): Date =>
  new Date(`${value}T12:00:00.000Z`);
const addCalendarDays = (value: string, amount: number): string => {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return calendarDateKey(date);
};
const calendarDateInTimeZone = (instant: Date, timeZone: string): string => {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      values[part.type] = part.value;
    }
  }
  return `${values.year ?? "0000"}-${values.month ?? "00"}-${values.day ?? "00"}`;
};
const addCalendarMonths = (value: string, amount: number): string => {
  const date = parseCalendarDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return calendarDateKey(date);
};
const mondayFor = (value: string): Date => {
  const date = parseCalendarDate(value);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (weekday === 0 ? 6 : weekday - 1));
  return date;
};

function calendarRangeLabel(view: CalendarView, anchorDate: string): string {
  const anchor = parseCalendarDate(anchorDate);
  if (view === "month") {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(anchor);
  }
  if (view === "day" || view === "team") {
    return new Intl.DateTimeFormat(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(anchor);
  }
  if (view === "agenda") {
    return `Upcoming from ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(anchor)}`;
  }
  const start = mondayFor(anchorDate);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(start, end);
}

const providerNames: Readonly<Record<string, string>> = {
  google: "Google Calendar",
  microsoft: "Microsoft 365",
  icloud: "Apple iCloud",
  caldav: "CalDAV",
  exchange: "Exchange Server",
  ics: "ICS subscription",
};

const meetingLocationNames: Readonly<Record<MeetingLocation, string>> = {
  "tap-room": "TAP meeting room",
  "tap-huddle": "Scheduled TAP Voice Huddle",
  "google-meet": "Google Meet",
  "microsoft-teams": "Microsoft Teams",
  zoom: "Zoom",
  webex: "Webex",
  goto: "GoTo Meeting",
  phone: "Phone call",
  physical: "Physical location",
  custom: "Custom link or instructions",
};

const meetingProviderConnectionDescription = (zoomConnected: boolean): string =>
  zoomConnected
    ? "Google Meet is included with your Google Destination Calendar. Zoom is connected in Settings."
    : "Google Meet is included with your Google Destination Calendar. Connect Zoom in Settings to use it.";

const isZoomAuthorizationUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.origin === "https://zoom.us" &&
      url.pathname === "/oauth/authorize" &&
      url.href === value;
  } catch {
    return false;
  }
};

const zoomExternalNavigationErrorMessage = (cause: unknown): string => {
  if (!isMiniAppHostActionError(cause)) {
    return providerExternalNavigationErrorMessage("native-open-failed", "Zoom");
  }
  switch (cause.code) {
    case "authorization-denied":
      return providerExternalNavigationErrorMessage("authorization-denied", "Zoom");
    case "authorization-unavailable":
      return providerExternalNavigationErrorMessage("authorization-unavailable", "Zoom");
    case "origin-rejected":
      return providerExternalNavigationErrorMessage("origin-rejected", "Zoom");
    case "request-expired":
      return providerExternalNavigationErrorMessage("request-expired", "Zoom");
    case "stale-installation":
      return providerExternalNavigationErrorMessage("stale-installation", "Zoom");
    case "unsupported-host":
      return providerExternalNavigationErrorMessage("unsupported-host", "Zoom");
    case "user-gesture-required":
      return providerExternalNavigationErrorMessage("user-gesture-required", "Zoom");
    case "native-open-failed":
    default:
      return providerExternalNavigationErrorMessage("native-open-failed", "Zoom");
  }
};

const openZoomAuthorization = async (
  navigation: ProviderExternalNavigationApi,
  url: string,
): Promise<string | null> => {
  if (!isZoomAuthorizationUrl(url)) {
    return providerExternalNavigationErrorMessage("origin-rejected", "Zoom");
  }
  if (typeof navigation.openExternal !== "function") {
    return providerExternalNavigationErrorMessage("unsupported-host", "Zoom");
  }
  try {
    await navigation.openExternal({ url });
    return null;
  } catch (cause: unknown) {
    return zoomExternalNavigationErrorMessage(cause);
  }
};

const providerLocationConfiguration = (
  location: MeetingLocation | null | undefined,
  bookingKind: ProviderBookingReservationInput["bookingKind"],
): {
  readonly location?: string;
  readonly conferenceProvider: "none" | "google-meet" | "zoom";
} => {
  if (bookingKind === "meeting" && (location === "google-meet" || location === "zoom")) {
    return { conferenceProvider: location };
  }
  return {
    ...(location ? { location: meetingLocationNames[location] } : {}),
    conferenceProvider: "none",
  };
};

const providerLocationError = (
  location: MeetingLocation | null | undefined,
  zoomConnected: boolean,
): string | null => {
  if (location == null || location === "google-meet") return null;
  if (location === "zoom") {
    return zoomConnected ? null : "Connect Zoom in Settings before scheduling a Zoom meeting.";
  }
  if (location === "phone" || location === "physical" || location === "custom") {
    return `${meetingLocationNames[location]} details are not supported for Google Calendar bookings yet. Choose Google Meet.`;
  }
  return `${meetingLocationNames[location]} is not supported for Google Calendar bookings yet. Choose Google Meet.`;
};

const calendarGatewayWriteError = (cause: unknown): string => {
  if (!(cause instanceof CalendarGatewayError)) {
    return cause instanceof Error
      ? `The calendar provider could not complete this change: ${cause.message}`
      : "The calendar provider could not complete this change.";
  }
  if (cause.code === "slot_conflict") {
    return "That time is no longer available. Refresh the calendar and choose another slot.";
  }
  if (
    cause.code === "idempotency_key_reused" ||
    cause.code === "resolution_idempotency_key_reused"
  ) {
    return "This scheduling attempt changed after it started. Choose the time again and retry.";
  }
  if (cause.code === "approval_already_resolved") {
    return "This approval request was already resolved elsewhere. Refresh Calendar updates.";
  }
  if (cause.code === "approval_hold_expired") {
    return "This approval request expired and its provider hold was removed. Ask the guest to choose a new time.";
  }
  if (cause.code === "booking_commit_in_progress") {
    return "Another booking is being committed to this calendar. Retry in a moment.";
  }
  if (cause.code === "destination_not_writable") {
    return "The Destination Calendar is no longer writable. Reconnect it or choose another destination.";
  }
  if (
    cause.code === "live_availability_unavailable" ||
    cause.code === "provider_commit_uncertain" ||
    cause.code === "provider_resolution_uncertain"
  ) {
    return `${cause.message} Retrying this same action is safe.`;
  }
  return cause.message;
};

const shouldRetrySameProviderAttempt = (cause: unknown): boolean =>
  !(cause instanceof CalendarGatewayError) ||
  cause.status >= 500 ||
  cause.code === "booking_commit_in_progress";

const approvalFailureNeedsLifecycleRecovery = (cause: unknown): boolean =>
  cause instanceof CalendarGatewayError && [
    "approval_hold_expired",
    "approval_already_resolved",
    "approval_hold_missing",
  ].includes(cause.code);

const allViews: readonly { id: CalendarView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "work-week", label: "Work week" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "agenda", label: "Agenda" },
  { id: "team", label: "Team" },
];

function publicSelectionFromPath(
  state: CalendarState,
  pathname: string,
): { profileId: string; eventTypeId: string } | null {
  const [profileSlug, eventTypeSlug, ...rest] = pathname
    .split("/")
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    });
  if (!profileSlug || !eventTypeSlug || rest.length > 0) return null;
  const profile = state.bookingProfiles.find(item => item.slug === profileSlug);
  const eventType = profile?.published
    ? profile.eventTypes.find(item => item.slug === eventTypeSlug && item.active)
    : undefined;
  return profile && eventType
    ? { profileId: profile.id, eventTypeId: eventType.id }
    : null;
}

export function TapCalendarApp({ preview = false, context }: TapCalendarAppProps) {
  const channelSchedulerSurface =
    context?.contributionId === CHANNEL_SCHEDULER_SURFACE_ID;
  const calendarPrincipalId = preview
    ? context?.userId?.trim() || "tap-calendar-local-preview"
    : context?.userId?.trim() ?? "";
  const createEntityId = useCallback<EntityIdFactory>(
    prefix => `${prefix}-${context?.entropy.randomUUID() ?? globalThis.crypto.randomUUID()}`,
    [context],
  );
  const [state, setState] = useState<CalendarState | null>(null);
  const stateRef = useRef<CalendarState | null>(null);
  const revisionRef = useRef<number | null>(null);
  const workspaceContentRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<Section>("calendar");
  const [anchorDate, setAnchorDate] = useState(() => calendarDateKey(new Date()));
  const [optimisticActiveView, setOptimisticActiveView] = useState<CalendarView | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [scheduleStart, setScheduleStart] = useState<string | null>(null);
  const [workBlockOpen, setWorkBlockOpen] = useState(false);
  const [connectionTarget, setConnectionTarget] = useState<CalendarConnectionTarget | null>(null);
  const [calendarRemovalTarget, setCalendarRemovalTarget] = useState<ConnectedCalendar | null>(null);
  const [publicPreview, setPublicPreview] = useState<{ profileId: string; eventTypeId: string } | null>(null);
  const [publicAvailabilityAnchorDate, setPublicAvailabilityAnchorDate] = useState(
    () => calendarDateAfter(0),
  );
  const [channelParticipantRoster, setChannelParticipantRoster] =
    useState<ChannelParticipantRoster>({
      status: "unavailable",
      participants: [],
    });
  const [providerPrincipalAccess, setProviderPrincipalAccess] =
    useState<ProviderPrincipalAccessState>({
      status: "loading",
      value: EMPTY_PRINCIPAL_ACCESS,
    });
  const [meetingProviderConnections, setMeetingProviderConnections] =
    useState<MeetingProviderConnectionsState>({
      status: "loading",
      connections: [],
      message: null,
    });
  const providerRecoveryRunningRef = useRef(false);
  const providerRecoveryRerunRef = useRef(false);
  const providerRecoveryWakeTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [providerRecoveryNonce, setProviderRecoveryNonce] = useState(0);
  const publicationSyncsRef = useRef(
    new Map<string, PublicBookingProfileSyncOperation>(),
  );
  const [publicationSyncNonce, setPublicationSyncNonce] = useState(0);
  const requestProviderRecovery = useCallback(() => {
    if (providerRecoveryRunningRef.current) {
      providerRecoveryRerunRef.current = true;
      return;
    }
    if (providerRecoveryWakeTimerRef.current !== null) {
      globalThis.clearTimeout(providerRecoveryWakeTimerRef.current);
      providerRecoveryWakeTimerRef.current = null;
    }
    setProviderRecoveryNonce(nonce => nonce + 1);
  }, []);
  const scheduleProviderRecovery = useCallback((delayMs = 30_000) => {
    if (providerRecoveryWakeTimerRef.current !== null) return;
    providerRecoveryWakeTimerRef.current = globalThis.setTimeout(() => {
      providerRecoveryWakeTimerRef.current = null;
      requestProviderRecovery();
    }, delayMs);
  }, [requestProviderRecovery]);

  useEffect(() => () => {
    if (providerRecoveryWakeTimerRef.current !== null) {
      globalThis.clearTimeout(providerRecoveryWakeTimerRef.current);
      providerRecoveryWakeTimerRef.current = null;
    }
  }, []);
  const calendarPlatform = useMemo<CalendarPlatform>(() => {
    if (preview) {
      return createCalendarPlatform(createPreviewCalendarHostRuntime());
    }
    const notifications = sdk.notifications;
    const tasks = sdk.tasks;
    return createCalendarPlatform({
      environment: "tap-host",
      authorization: sdk.authorization,
      channels: sdk.channels,
      workflows: sdk.workflows,
      ...(notifications ? { notifications } : {}),
      ...(tasks ? { tasks } : {}),
    });
  }, [preview]);
  const calendarGateway = useMemo<CalendarGatewayClient>(() => {
    const transport = preview
      ? createFetchCalendarGatewayTransport()
      : async (...input: Parameters<ReturnType<typeof createTapCalendarGatewayTransport>>) => {
          const hostTransport = createTapCalendarGatewayTransport(
            sdk.hasHostHttpRequest === true ? sdk.http : undefined,
          );
          if (!context?.userId?.trim()) {
            throw new Error(
              "TAP did not provide the canonical user identity required for Calendar access.",
            );
          }
          await requireCalendarAuthority(
            context,
            preview,
            NETWORK_REQUEST_ACTION,
          );
          return hostTransport(...input);
        };
    return createCalendarGatewayClient({
      baseUrl: resolveCalendarGatewayUrl(preview),
      workspaceId: context?.workspaceId ?? "tap-calendar-local-preview",
      principalId: calendarPrincipalId || "tap-calendar-principal-unavailable",
      transport,
    });
  }, [calendarPrincipalId, context, preview]);
  const bookingAnalytics = usePublicBookingAnalytics(
    calendarGateway, !preview && state !== null && section === "booking-pages",
  );
  const bookingAnalyticsState = useMemo(() => state && !preview
    ? applyPublicBookingAnalytics(state, bookingAnalytics.data ?? { pages: [] })
    : state, [state, preview, bookingAnalytics.data]);
  const bookingAnalyticsAvailable = preview || bookingAnalytics.data !== null;

  const providerBookingOutbox = useMemo(
    () => createProviderBookingOutbox(preview, calendarPrincipalId),
    [calendarPrincipalId, preview],
  );
  const refreshMeetingProviderConnections = useCallback<
    RefreshMeetingProviderConnections
  >(async () => {
    setMeetingProviderConnections(current => ({
      status: "loading",
      connections: current.connections,
      message: null,
    }));
    try {
      const connections = await calendarGateway.listMeetingProviderConnections();
      setMeetingProviderConnections({ status: "ready", connections, message: null });
      return connections;
    } catch (cause: unknown) {
      const message = "TAP Calendar couldn't check your meeting-provider connections. Try again.";
      setMeetingProviderConnections(current => ({
        status: "error",
        connections: current.connections,
        message,
      }));
      throw cause;
    }
  }, [calendarGateway]);

  useEffect(() => {
    void refreshMeetingProviderConnections().catch(() => {
      // Settings exposes a scoped retry without blocking Calendar reads.
    });
  }, [refreshMeetingProviderConnections]);

  const zoomConnected = meetingProviderConnections.status === "ready" &&
    meetingProviderConnections.connections.some(connection =>
      connection.provider === "zoom" && connection.status === "connected"
    );

  const gatewayAccountSignature = state?.accounts
    .map(account => account.id)
    .sort()
    .join("\u0000") ?? "";
  useEffect(() => {
    let cancelled = false;
    setProviderPrincipalAccess({
      status: "loading",
      value: EMPTY_PRINCIPAL_ACCESS,
    });
    if (!preview && !context?.userId?.trim()) {
      setProviderPrincipalAccess({
        status: "error",
        value: EMPTY_PRINCIPAL_ACCESS,
        message:
          "TAP did not provide the canonical user identity required to choose a Destination Calendar.",
      });
      return () => {
        cancelled = true;
      };
    }
    void calendarGateway.listConnections()
      .then(connections => {
        if (cancelled) return;
        setProviderPrincipalAccess({
          status: "ready",
          value: calendarGatewayPrincipalAccess(
            connections,
            calendarGateway.principalId,
          ),
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setProviderPrincipalAccess({
          status: "error",
          value: EMPTY_PRINCIPAL_ACCESS,
          message: cause instanceof Error
            ? cause.message
            : "TAP could not verify your Calendar connections.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [calendarGateway, context?.userId, gatewayAccountSignature, preview]);

  useEffect(() => {
    if (!channelSchedulerSurface || !context?.channelId) {
      setChannelParticipantRoster({ status: "unavailable", participants: [] });
      return;
    }
    const capability = channelParticipantsCapability(
      sdk.channels,
      context.hostOrigin,
    );
    if (!capability) {
      setChannelParticipantRoster({ status: "unavailable", participants: [] });
      return;
    }

    let cancelled = false;
    setChannelParticipantRoster({ status: "loading", participants: [] });
    void requireCalendarAuthority(context, preview, CHANNELS_READ_ACTION)
      .then(() => loadChannelParticipants(capability, context.channelId!))
      .then(participants => {
        if (cancelled) return;
        setChannelParticipantRoster({
          status: "ready",
          participants: channelInviteCandidates(participants, context.userId),
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setChannelParticipantRoster({
          status: "error",
          participants: [],
          message: cause instanceof Error
            ? cause.message
            : "TAP could not load this channel's participants.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [channelSchedulerSurface, context, preview]);

  const reserveProviderBooking = useCallback<ReserveProviderBooking>(async input => {
    try {
      await requireCalendarAuthority(context, preview, input.actionId);
    } catch (cause: unknown) {
      return {
        ok: false,
        error: cause instanceof Error
          ? cause.message
          : "TAP did not authorize this provider calendar change.",
        retrySameAttempt: false,
      };
    }
    const current = stateRef.current;
    if (!current) {
      return {
        ok: false,
        error: "Calendar is still loading.",
        retrySameAttempt: false,
      };
    }
    const destinationAccount = accountForCalendar(
      current,
      input.destinationCalendarId,
    );
    if (destinationAccount?.provider !== "google") {
      return {
        ok: false,
        error: "Provider writes are currently connected only for Google Calendar destinations.",
        retrySameAttempt: false,
      };
    }
    let principalAccess: CalendarGatewayPrincipalAccess;
    try {
      const connections = await calendarGateway.listConnections();
      principalAccess = calendarGatewayPrincipalAccess(
        connections,
        calendarGateway.principalId,
      );
      const connection = connections.find(item => item.id === destinationAccount.id);
      if (
        !connection ||
        connection.ownerPrincipalId !== calendarGateway.principalId ||
        connection.provider !== "google" ||
        connection.mode !== "oauth" ||
        connection.status !== "connected" ||
        !principalAccess.writableGoogleDestinationIds.includes(
          input.destinationCalendarId,
        )
      ) {
        return {
          ok: false,
          error: "This Destination Calendar is not owned or writable by the current TAP user.",
          retrySameAttempt: false,
        };
      }
    } catch (cause: unknown) {
      return {
        ok: false,
        error: cause instanceof Error
          ? `TAP could not verify the Google Calendar connection: ${cause.message}`
          : "TAP could not verify the Google Calendar connection.",
        retrySameAttempt: shouldRetrySameProviderAttempt(cause),
      };
    }
    const ownedCalendarIds = new Set(principalAccess.calendarIds);
    const conflictCalendarIds = conflictCalendarIdsForSlot(
      current,
      input.destinationCalendarId,
    ).filter(calendarId => ownedCalendarIds.has(calendarId));
    if (conflictCalendarIds.length === 0) {
      return {
        ok: false,
        error: "Connect a Conflict Calendar before reserving time.",
        retrySameAttempt: false,
      };
    }
    const locationError = providerLocationError(input.location, zoomConnected);
    if (locationError) {
      return { ok: false, error: locationError, retrySameAttempt: false };
    }
    const providerLocation = providerLocationConfiguration(
      input.location,
      input.bookingKind,
    );
    const request: ProviderBookingOutboxProviderRequest = {
      destinationCalendarId: input.destinationCalendarId,
      conflictCalendarIds,
      idempotencyKey: input.idempotencyKey,
      title: input.title,
      start: input.start,
      end: input.end,
      conflictTimeMin: input.conflictTimeMin ?? input.start,
      conflictTimeMax: input.conflictTimeMax ?? input.end,
      bookingKind: input.bookingKind,
      attendeeEmails: input.bookingKind !== "work-block"
        ? (input.attendees ?? []).map(attendee => attendee.email.toLowerCase()).sort()
        : [],
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...providerLocation,
    };
    let prepared;
    try {
      prepared = await providerBookingOutbox.putBeforeProviderCall({
        request,
        reconciliation: input.reconciliation,
      });
    } catch (cause: unknown) {
      return {
        ok: false,
        error: cause instanceof Error
          ? `TAP could not durably prepare this provider change: ${cause.message}`
          : "TAP could not durably prepare this provider change.",
        retrySameAttempt: true,
      };
    }
    if (prepared.phase === "provider-committed") {
      return { ok: true, booking: prepared.providerCommit.booking };
    }
    try {
      const result = await calendarGateway.commitBooking(request);
      const committed = await providerBookingOutbox.markProviderCommitted(
        input.idempotencyKey,
        result,
      );
      scheduleProviderRecovery();
      return { ok: true, booking: committed.providerCommit.booking };
    } catch (cause: unknown) {
      const retrySameAttempt = shouldRetrySameProviderAttempt(cause);
      if (!retrySameAttempt) {
        try {
          await providerBookingOutbox.discardPreparedAfterDefinitiveProviderFailure(
            input.idempotencyKey,
          );
        } catch {
          // Keeping a prepared record is safer than losing an uncertain provider boundary.
        }
      } else {
        scheduleProviderRecovery();
      }
      return {
        ok: false,
        error: calendarGatewayWriteError(cause),
        retrySameAttempt,
      };
    }
  }, [calendarGateway, context, preview, providerBookingOutbox, scheduleProviderRecovery, zoomConnected]);

  const announce = useCallback((message: string) => {
    setNotice(message);
    globalThis.setTimeout(() => setNotice(null), 3200);
  }, []);

  const finishProviderBookingReconciliation = useCallback(async (
    idempotencyKey: string,
    booking: CalendarGatewayCommittedBooking,
  ): Promise<void> => {
    if (booking.conferenceStatus === "pending") {
      scheduleProviderRecovery();
      return;
    }
    try {
      await providerBookingOutbox.removeAfterLocalReconciliation(
        idempotencyKey,
        booking.event.id,
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? `The booking is saved, but TAP still needs to clear its recovery record: ${cause.message}`
          : "The booking is saved, but TAP still needs to clear its recovery record.",
      );
    }
  }, [providerBookingOutbox, scheduleProviderRecovery]);

  useEffect(() => {
    let cancelled = false;
    void requireCalendarMountAuthority(context, preview)
      .then(() => loadCalendarState(preview, calendarPrincipalId))
      .then(loaded => {
        if (cancelled) return;
        stateRef.current = loaded.state;
        revisionRef.current = loaded.revision;
        setState(loaded.state);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "TAP Calendar could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [calendarPrincipalId, context, preview]);

  useEffect(() => {
    if (preview || !context) return;
    let active = true;
    const unsubscribe = context.events.subscribe(
      CALENDAR_CHANGED_SUBSCRIPTION,
      payload => {
        if (
          typeof payload === "object" &&
          payload !== null &&
          Reflect.get(payload, "instanceId") === context.instanceId
        ) {
          return;
        }
        void loadCalendarState(false, calendarPrincipalId)
          .then(loaded => {
            if (!active || loaded.revision === null) return;
            const currentRevision = revisionRef.current;
            if (
              currentRevision !== null &&
              loaded.revision <= currentRevision
            ) {
              return;
            }
            revisionRef.current = loaded.revision;
            stateRef.current = loaded.state;
            setState(loaded.state);
            setError(null);
          })
          .catch(() => undefined);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [calendarPrincipalId, context, preview]);

  useEffect(() => {
    if (!preview || !state) return;
    const syncPublicRoute = () => {
      setPublicPreview(publicSelectionFromPath(state, globalThis.location.pathname));
    };
    syncPublicRoute();
    globalThis.addEventListener("popstate", syncPublicRoute);
    return () => globalThis.removeEventListener("popstate", syncPublicRoute);
  }, [preview, state]);

  const persistCalendarMutation = useCallback<PersistCalendarState>(
    async (
      mutation: StateMutation,
      successMessage?: string,
    ): Promise<boolean> => {
      const current = stateRef.current;
      if (!current) return false;
      const mutated = mutation(current);
      if (mutated === current) return false;
      const next = preview
        ? mutated
        : markChangedPublicBookingProfilesPending(
          current,
          mutated,
          new Date().toISOString(),
        );
      setSaving(true);
      try {
        const revision = await saveCalendarState(
          next,
          preview,
          revisionRef.current,
          calendarPrincipalId,
        );
        revisionRef.current = revision;
        stateRef.current = next;
        setState(next);
        setError(null);
        if (successMessage) announce(successMessage);
        if (!preview && context) {
          void context.events.publish("calendar.changed", {
            contributionId: context.contributionId,
            instanceId: context.instanceId,
          });
        }
        return true;
      } catch (cause: unknown) {
        const message =
          cause instanceof CalendarStorageConflictError
            ? "Calendar changed in another session. Reload before trying again."
            : cause instanceof Error
              ? cause.message
              : "Calendar changes could not be saved.";
        setError(message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [announce, calendarPrincipalId, context, preview],
  );

  const commit = useCallback<CommitCalendarState>(
    async (
      mutation,
      successMessage,
      actionId = CALENDAR_MANAGE_ACTION,
    ): Promise<boolean> => {
      try {
        await requireCalendarAuthority(context, preview, actionId);
      } catch (cause: unknown) {
        setError(
          cause instanceof Error
            ? cause.message
            : "TAP did not authorize this Calendar change.",
        );
        return false;
      }
      return persistCalendarMutation(mutation, successMessage);
    },
    [context, persistCalendarMutation, preview],
  );

  const executePublicBookingProfileSync = useCallback(async (
    profileId: string,
  ): Promise<boolean> => {
    if (preview) return true;
    try {
      await requireCalendarAuthority(context, false, CALENDAR_PUBLISH_ACTION);
      const saved = await reconcilePublicBookingProfilePublication(profileId, {
        gateway: calendarGateway,
        readState: () => stateRef.current,
        persist: persistCalendarMutation,
        now: () => new Date().toISOString(),
      });
      if (saved) {
        const latestProfile = stateRef.current?.bookingProfiles.find(
          candidate => candidate.id === profileId,
        );
        if (latestProfile?.pendingPublication) {
          setPublicationSyncNonce(value => value + 1);
        }
      }
      return saved;
    } catch (cause: unknown) {
      const message = cause instanceof CalendarGatewayError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : "The Booking Profile could not be synchronized with cal.with-tap.ai.";
      setError(message);
      return false;
    }
  }, [calendarGateway, context, persistCalendarMutation, preview]);

  const syncPublicBookingProfile = useCallback((profileId: string): Promise<boolean> => {
    return enqueuePublicBookingProfileSync(
      publicationSyncsRef.current,
      stateRef.current,
      profileId,
      executePublicBookingProfileSync,
    );
  }, [executePublicBookingProfileSync]);

  const publicationPendingSignature = state?.bookingProfiles
    .flatMap(profile => profile.pendingPublication
      ? [`${profile.id}\u0000${profile.pendingPublication.requestedAt}\u0000${profile.pendingPublication.expectedGeneration}`]
      : [])
    .join("\u0001") ?? "";
  useEffect(() => {
    if (preview || !publicationPendingSignature) return;
    const pendingProfileIds = stateRef.current?.bookingProfiles
      .filter(profile => profile.pendingPublication)
      .map(profile => profile.id) ?? [];
    for (const profileId of pendingProfileIds) void syncPublicBookingProfile(profileId);
  }, [preview, publicationPendingSignature, publicationSyncNonce, syncPublicBookingProfile]);

  useEffect(() => {
    const pending = state?.bookingRequests.filter(request => request.status === "pending") ?? [];
    if (pending.length === 0) return;
    const reconcileExpiredHolds = () => {
      const now = Date.now();
      void persistCalendarMutation(current => {
        let next = current;
        for (const request of current.bookingRequests) {
          if (request.status === "pending" && Date.parse(request.expiresAt) <= now) {
            next = expireBookingRequest(next, request.id, request.expiresAt);
          }
        }
        return next;
      });
    };
    const nextExpiration = Math.min(...pending.map(request => Date.parse(request.expiresAt)));
    const delay = Math.max(0, Math.min(nextExpiration - Date.now(), 2_147_000_000));
    if (delay === 0) {
      reconcileExpiredHolds();
      return;
    }
    const timer = globalThis.setTimeout(reconcileExpiredHolds, delay);
    return () => globalThis.clearTimeout(timer);
  }, [persistCalendarMutation, state?.bookingRequests]);

  useEffect(() => {
    globalThis.addEventListener("focus", requestProviderRecovery);
    globalThis.addEventListener("online", requestProviderRecovery);
    return () => {
      globalThis.removeEventListener("focus", requestProviderRecovery);
      globalThis.removeEventListener("online", requestProviderRecovery);
    };
  }, [requestProviderRecovery]);

  useEffect(() => {
    if (!state) return;
    if (providerRecoveryRunningRef.current) {
      providerRecoveryRerunRef.current = true;
      return;
    }
    providerRecoveryRunningRef.current = true;
    let cancelled = false;
    void (async () => {
      const awaitingProvider = await providerBookingOutbox.listAwaitingProvider();
      for (const record of awaitingProvider) {
        const actionId = record.reconciliation.kind === "public-booking"
          ? CALENDAR_PUBLISH_ACTION
          : CALENDAR_MANAGE_ACTION;
        try {
          await requireCalendarAuthority(context, preview, actionId);
          const result = await calendarGateway.commitBooking(record.request);
          await providerBookingOutbox.markProviderCommitted(
            record.idempotencyKey,
            result,
          );
        } catch (cause: unknown) {
          if (!shouldRetrySameProviderAttempt(cause)) {
            try {
              await providerBookingOutbox.discardPreparedAfterDefinitiveProviderFailure(
                record.idempotencyKey,
              );
            } catch {
              // Preserve the record when recovery storage itself is unavailable.
            }
          } else {
            scheduleProviderRecovery();
          }
          if (!cancelled) setError(calendarGatewayWriteError(cause));
        }
      }

      const pendingReconciliation =
        await providerBookingOutbox.listPendingReconciliation();
      for (const record of pendingReconciliation) {
        let activeRecord = record;
        let status: CalendarGatewayBookingStatus | null = null;
        let statusLookupSucceeded = false;
        try {
          status = await calendarGateway.getBookingStatus(record.idempotencyKey);
          statusLookupSucceeded = true;
          if (status.lifecycle.state === "active") {
            activeRecord = await providerBookingOutbox.markProviderCommitted(
              record.idempotencyKey,
              status.commit,
            );
          }
        } catch (cause: unknown) {
          if (!cancelled) setError(calendarGatewayWriteError(cause));
        }
        const reconciliation: {
          result?: ProviderBookingLocalReconciliationResult;
        } = {};
        await persistCalendarMutation(current => {
          reconciliation.result = !status || status.lifecycle.state === "active"
            ? reconcileCommittedProviderBooking(current, activeRecord)
            : reconcileProviderBookingLifecycle(current, record, status);
          return reconciliation.result.state;
        });
        if (reconciliation.result?.error) {
          if (!cancelled) setError(reconciliation.result.error);
          continue;
        }
        const latest = stateRef.current;
        const verified = latest ? (
          !status || status.lifecycle.state === "active"
            ? committedProviderBookingIsReconciled(latest, activeRecord)
            : (() => {
                const result = reconcileProviderBookingLifecycle(latest, record, status);
                return result.error === null && result.state === latest;
              })()
        ) : false;
        const conferencePending = status?.lifecycle.state === "approved"
          ? status.commit.booking.conferenceStatus === "pending"
          : activeRecord.providerCommit.booking.conferenceStatus === "pending";
        const lifecycleStatusUnavailable =
          record.providerCommit.booking.bookingKind === "approval-hold" &&
          !statusLookupSucceeded;
        if (lifecycleStatusUnavailable) {
          // The stored commit is enough to repair the local pending Hold, but it
          // cannot prove whether the provider has since approved, declined, or
          // expired it. Keep the outbox record until status can be read.
          scheduleProviderRecovery();
          continue;
        }
        if (
          verified &&
          !conferencePending
        ) {
          await providerBookingOutbox.removeAfterLocalReconciliation(
            record.idempotencyKey,
            record.providerCommit.booking.event.id,
          );
        }
      }

      const awaitingApproval =
        await providerBookingOutbox.listApprovalResolutionsAwaitingProvider();
      for (const record of awaitingApproval) {
        const current = stateRef.current;
        const expected = record.reconciliation.expectedEvent;
        const localRequest = current?.bookingRequests.find(
          candidate => candidate.id === record.reconciliation.bookingRequestId,
        );
        const localEvent = localRequest && current
          ? current.events.find(candidate => candidate.id === localRequest.eventId)
          : undefined;
        const localProjectionIsRecoverable = Boolean(
          localRequest &&
          localEvent &&
          localEvent.kind === "hold" &&
          approvalEventMatchesExpected(localEvent, expected) &&
          (
            (localRequest.status === "pending" && localEvent.status === "pending") ||
            (localRequest.status === "cancelled" && localEvent.status === "cancelled")
          ),
        );
        if (
          !localProjectionIsRecoverable
        ) {
          if (!cancelled) {
            setError(
              "An earlier approval decision needs review because its local Booking changed.",
            );
          }
          continue;
        }
        try {
          const status = await calendarGateway.getBookingStatus(
            record.bookingIdempotencyKey,
          );
          if (status.lifecycle.state === "active") {
            await requireCalendarAuthority(
              context,
              preview,
              CALENDAR_APPROVE_ACTION,
            );
            const result = await calendarGateway.resolveApprovalHold(
              record.bookingIdempotencyKey,
              record.request,
            );
            await providerBookingOutbox.markApprovalResolutionCommitted(
              record.resolutionIdempotencyKey,
              result,
            );
            continue;
          }

          const decisionMatchesLifecycle =
            (record.request.decision === "approve" &&
              status.lifecycle.state === "approved") ||
            (record.request.decision === "decline" &&
              status.lifecycle.state === "declined");
          if (
            decisionMatchesLifecycle &&
            status.lifecycle.resolvedAt &&
            (status.lifecycle.state === "declined" || status.currentEvent)
          ) {
            await providerBookingOutbox.markApprovalResolutionCommitted(
              record.resolutionIdempotencyKey,
              {
                resolution: {
                  state: "committed",
                  decision: status.lifecycle.state === "approved"
                    ? "approved"
                    : "declined",
                  bookingIdempotencyKey: record.bookingIdempotencyKey,
                  providerEventId: status.commit.booking.providerEventId,
                  providerEventRemoved: status.lifecycle.providerEventRemoved,
                  providerJoinUrl: status.currentEvent?.providerJoinUrl ?? null,
                  event: status.currentEvent,
                },
                resolvedAt: status.lifecycle.resolvedAt,
                idempotentReplay: true,
              },
            );
            continue;
          }

          const terminalReconciliation: {
            result?: ProviderApprovalLocalReconciliationResult;
          } = {};
          await persistCalendarMutation(latest => {
            terminalReconciliation.result = reconcileApprovalStatusLifecycle(
              latest,
              record.reconciliation.bookingRequestId,
              expected,
              status,
            );
            return terminalReconciliation.result.state;
          });
          const latest = stateRef.current;
          const terminalVerified = latest
            ? (() => {
                const result = reconcileApprovalStatusLifecycle(
                  latest,
                  record.reconciliation.bookingRequestId,
                  expected,
                  status,
                );
                return result.error === null && result.state === latest;
              })()
            : false;
          if (!terminalVerified) {
            if (!cancelled) {
              setError(
                terminalReconciliation.result?.error ??
                  "TAP could not persist the provider's final approval state.",
              );
            }
            continue;
          }
          await providerBookingOutbox
            .discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
              record.resolutionIdempotencyKey,
            );
        } catch (cause: unknown) {
          let recoveryCause = cause;
          if (shouldRetrySameProviderAttempt(cause)) {
            try {
              await requireCalendarAuthority(
                context,
                preview,
                CALENDAR_APPROVE_ACTION,
              );
              const replayed = await calendarGateway.resolveApprovalHold(
                record.bookingIdempotencyKey,
                record.request,
              );
              await providerBookingOutbox.markApprovalResolutionCommitted(
                record.resolutionIdempotencyKey,
                replayed,
              );
              continue;
            } catch (replayCause: unknown) {
              recoveryCause = replayCause;
            }
          }
          if (
            recoveryCause instanceof CalendarGatewayError &&
            recoveryCause.code === "approval_hold_missing"
          ) {
            const removedAt = new Date().toISOString();
            const missingReconciliation: {
              result?: ProviderApprovalLocalReconciliationResult;
            } = {};
            await persistCalendarMutation(latest => {
              missingReconciliation.result = reconcileMissingApprovalHold(
                latest,
                record.reconciliation.bookingRequestId,
                expected,
                removedAt,
              );
              return missingReconciliation.result.state;
            });
            const latest = stateRef.current;
            const removedIsReconciled = latest
              ? (() => {
                  const result = reconcileMissingApprovalHold(
                    latest,
                    record.reconciliation.bookingRequestId,
                    expected,
                    removedAt,
                  );
                  return result.error === null && result.state === latest;
                })()
              : false;
            if (removedIsReconciled) {
              await providerBookingOutbox
                .discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
                  record.resolutionIdempotencyKey,
                );
            } else {
              scheduleProviderRecovery();
            }
          } else if (approvalFailureNeedsLifecycleRecovery(recoveryCause)) {
            scheduleProviderRecovery();
          } else if (!shouldRetrySameProviderAttempt(recoveryCause)) {
            try {
              await providerBookingOutbox
                .discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
                  record.resolutionIdempotencyKey,
                );
            } catch {
              // Preserve the record when recovery storage itself is unavailable.
            }
          } else {
            scheduleProviderRecovery();
          }
          if (!cancelled) setError(calendarGatewayWriteError(recoveryCause));
        }
      }

      const pendingApprovalReconciliation = await providerBookingOutbox
        .listPendingApprovalResolutionReconciliation();
      for (const record of pendingApprovalReconciliation) {
        let activeRecord = record;
        if (
          record.reconciliation.decision === "approve" &&
          !record.providerResolution.resolution.providerJoinUrl &&
          record.reconciliation.expectedEvent.location === "google-meet"
        ) {
          try {
            const status = await calendarGateway.getBookingStatus(
              record.bookingIdempotencyKey,
            );
            if (
              status.lifecycle.state !== "approved" ||
              !status.currentEvent ||
              !status.lifecycle.resolvedAt
            ) {
              if (!cancelled) {
                setError("The approved Google Meet is still being provisioned.");
              }
              continue;
            }
            activeRecord = await providerBookingOutbox
              .markApprovalResolutionCommitted(
                record.resolutionIdempotencyKey,
                {
                  resolution: {
                    state: "committed",
                    decision: "approved",
                    bookingIdempotencyKey: record.bookingIdempotencyKey,
                    providerEventId: status.commit.booking.providerEventId,
                    providerEventRemoved: false,
                    providerJoinUrl:
                      status.currentEvent.providerJoinUrl ??
                      status.commit.booking.providerJoinUrl,
                    event: status.currentEvent,
                  },
                  resolvedAt: status.lifecycle.resolvedAt,
                  idempotentReplay: true,
                },
              );
          } catch (cause: unknown) {
            if (!cancelled) setError(calendarGatewayWriteError(cause));
            continue;
          }
        }
        const reconciliation: {
          result?: ProviderApprovalLocalReconciliationResult;
        } = {};
        await persistCalendarMutation(current => {
          reconciliation.result = reconcileCommittedApprovalResolution(
            current,
            activeRecord,
          );
          return reconciliation.result.state;
        });
        if (reconciliation.result?.error) {
          if (!cancelled) setError(reconciliation.result.error);
          continue;
        }
        const latest = stateRef.current;
        const verified = latest
          ? committedApprovalResolutionIsReconciled(latest, activeRecord)
          : false;
        const joinReady =
          activeRecord.reconciliation.decision === "decline" ||
          Boolean(activeRecord.providerResolution.resolution.providerJoinUrl) ||
          activeRecord.reconciliation.expectedEvent.location !== "google-meet";
        if (verified && joinReady) {
          await providerBookingOutbox
            .removeApprovalResolutionAfterLocalReconciliation(
              activeRecord.resolutionIdempotencyKey,
              activeRecord.reconciliation.expectedEvent.id,
            );
        }
      }
    })()
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `TAP could not reconcile an earlier provider booking: ${cause.message}`
              : "TAP could not reconcile an earlier provider booking.",
          );
        }
      })
      .finally(() => {
        providerRecoveryRunningRef.current = false;
        if (cancelled) return;
        if (providerRecoveryRerunRef.current) {
          providerRecoveryRerunRef.current = false;
          requestProviderRecovery();
          return;
        }
        void providerBookingOutbox.load().then(snapshot => {
          if (
            cancelled ||
            (snapshot.records.length === 0 && snapshot.resolutions.length === 0)
          ) return;
          scheduleProviderRecovery();
        }).catch(() => {
          if (!cancelled) scheduleProviderRecovery();
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    calendarGateway,
    context,
    persistCalendarMutation,
    preview,
    providerBookingOutbox,
    providerRecoveryNonce,
    requestProviderRecovery,
    scheduleProviderRecovery,
    state !== null,
  ]);

  const navigate = useCallback((next: Section) => {
    setSection(next);
    setMobileRailOpen(false);
  }, []);

  useEffect(() => {
    workspaceContentRef.current?.scrollTo({ top: 0 });
  }, [section]);

  const visibleCalendarIds = useMemo(
    () => state && !channelSchedulerSurface
      ? allCalendars(state)
          .filter(calendar => calendar.visible)
          .map(calendar => calendar.id)
      : [],
    [channelSchedulerSurface, state],
  );
  const conflictCalendarIds = useMemo(
    () => state
      ? allCalendars(state)
          .filter(calendar => calendar.conflicts)
          .map(calendar => calendar.id)
      : [],
    [state],
  );
  const publicConflictCalendarIds = useMemo(() => {
    if (channelSchedulerSurface || !state || !publicPreview) return [];
    const selectedDestination = state.bookingProfiles
      .find(profile => profile.id === publicPreview.profileId)
      ?.eventTypes.find(eventType => eventType.id === publicPreview.eventTypeId)
      ?.destinationCalendarId;
    return [...new Set([
      ...conflictCalendarIds,
      ...(selectedDestination ? [selectedDestination] : []),
    ])].sort();
  }, [channelSchedulerSurface, conflictCalendarIds, publicPreview, state]);
  const providerEventCache = useCalendarEventCache({
    preview,
    principalId: calendarPrincipalId,
    gateway: calendarGateway,
    calendarIds: visibleCalendarIds,
    view: optimisticActiveView ?? state?.activeView ?? "work-week",
    anchorDate,
  });
  const publicAvailabilityCache = useCalendarEventCache({
    preview,
    principalId: calendarPrincipalId,
    gateway: calendarGateway,
    calendarIds: publicConflictCalendarIds,
    view: "month",
    anchorDate: publicAvailabilityAnchorDate,
  });
  const eventSyncState = providerEventCache.syncState;

  const submitScheduledMeeting = useCallback<
    (
      input: Parameters<typeof scheduleMeeting>[1],
    ) => Promise<ProviderBackedSubmissionResult>
  >(async input => {
    const reserved = await reserveProviderBooking({
      actionId: CALENDAR_MANAGE_ACTION,
      idempotencyKey: input.id,
      destinationCalendarId: input.calendarId,
      title: input.title,
      start: input.start,
      end: input.end,
      bookingKind: input.approvalRequired ? "approval-hold" : "meeting",
      location: input.location,
      attendees: input.attendees,
      reconciliation: {
        kind: "schedule-meeting",
        title: input.title,
        calendarId: input.calendarId,
        start: input.start,
        end: input.end,
        location: input.location,
        attendees: input.attendees,
        approvalRequired: input.approvalRequired,
        ...(input.eventTypeId ? { eventTypeId: input.eventTypeId } : {}),
        requestedAt: input.requestedAt,
      },
      ...(input.approvalRequired
        ? {
            expiresAt: new Date(
              Date.parse(input.requestedAt) + 24 * 60 * 60 * 1000,
            ).toISOString(),
          }
        : {}),
    });
    if (!reserved.ok) {
      return {
        error: reserved.error,
        retrySameAttempt: reserved.retrySameAttempt,
      };
    }

    let domainError: string | null = null;
    let bookingRequestId: string | null = null;
    let alreadyReconciled = false;
    const changed = await persistCalendarMutation(latest => {
      alreadyReconciled = latest.events.some(
        candidate => candidate.id === reserved.booking.event.id,
      );
      const result = scheduleMeeting(latest, {
        ...input,
        id: reserved.booking.event.id,
        ...(input.approvalRequired ? { bookingRequestId: input.id } : {}),
        ...(reserved.booking.providerHtmlLink
          ? { providerHtmlLink: reserved.booking.providerHtmlLink }
          : {}),
        ...(reserved.booking.providerJoinUrl
          ? { providerJoinUrl: reserved.booking.providerJoinUrl }
          : {}),
      });
      domainError = result.error;
      bookingRequestId = result.bookingRequestId;
      alreadyReconciled = alreadyReconciled && result.error === null;
      return result.state;
    });
    if (changed || alreadyReconciled) {
      await finishProviderBookingReconciliation(input.id, reserved.booking);
      announce(bookingRequestId
        ? "Meeting request saved with a provider Tentative Hold."
        : input.attendees.length === 0
          ? "Time blocked on your calendar."
          : "Meeting committed to the provider calendar.");
      providerEventCache.refresh();
      return { error: null, retrySameAttempt: false };
    }
    return {
      error: domainError ??
        "The provider accepted the meeting, but TAP could not update its local view. Refresh before retrying.",
      retrySameAttempt: true,
    };
  }, [
    announce,
    finishProviderBookingReconciliation,
    persistCalendarMutation,
    providerEventCache.refresh,
    reserveProviderBooking,
  ]);

  const resolveBookingApproval = async (
    requestId: string,
    decision: "approve" | "decline",
  ): Promise<void> => {
    try {
      await requireCalendarAuthority(context, preview, CALENDAR_APPROVE_ACTION);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : "TAP did not authorize this Booking decision.",
      );
      return;
    }
    const current = stateRef.current;
    const request = current?.bookingRequests.find(item => item.id === requestId);
    const event = request
      ? current?.events.find(item => item.id === request.eventId)
      : undefined;
    if (!current || !request || !isActivePendingRequest(request) || !event) {
      setError("The pending Booking is no longer available.");
      return;
    }
    if (event.kind !== "hold" || event.status !== "pending") {
      setError("The provider hold no longer matches this pending Booking.");
      return;
    }
    if (decision === "approve") {
      const locationError = providerLocationError(event.location ?? undefined, zoomConnected);
      if (locationError) {
        setError(locationError);
        return;
      }
    }
    const providerLocation = providerLocationConfiguration(
      event.location ?? undefined,
      "meeting",
    );
    const resolutionRequest: ProviderApprovalResolutionOutboxPreparation["request"] = {
      idempotencyKey: `${request.id}-${decision}`,
      decision,
      conflictCalendarIds: decision === "approve"
        ? conflictCalendarIdsForSlot(current, event.calendarId)
        : [],
      ...(decision === "approve"
        ? {
            title: event.title,
            attendeeEmails: event.attendees
              .map(attendee => attendee.email.toLowerCase())
              .sort(),
            ...providerLocation,
          }
        : {}),
    };
    const preparation: ProviderApprovalResolutionOutboxPreparation = {
      bookingIdempotencyKey: request.id,
      request: resolutionRequest,
      reconciliation: {
        bookingRequestId: request.id,
        decision,
        expectedEvent: {
          id: event.id,
          title: event.title,
          calendarId: event.calendarId,
          start: event.start,
          end: event.end,
          kind: "hold",
          status: "pending",
          location: event.location,
          attendees: event.attendees,
        },
      },
    };
    let durableResolution: CommittedProviderApprovalResolutionOutboxRecord;
    try {
      const durable = await providerBookingOutbox
        .putApprovalResolutionBeforeProviderCall(preparation);
      if (durable.phase === "provider-committed") {
        durableResolution = durable;
      } else {
        const providerResult = await calendarGateway.resolveApprovalHold(
          request.id,
          resolutionRequest,
        );
        durableResolution = await providerBookingOutbox
          .markApprovalResolutionCommitted(
            resolutionRequest.idempotencyKey,
            providerResult,
          );
      }
      scheduleProviderRecovery();
    } catch (cause: unknown) {
      if (
        cause instanceof CalendarGatewayError &&
        cause.code === "approval_hold_missing"
      ) {
        const removedAt = new Date().toISOString();
        await persistCalendarMutation(latest =>
          reconcileMissingApprovalHold(
            latest,
            preparation.reconciliation.bookingRequestId,
            preparation.reconciliation.expectedEvent,
            removedAt,
          ).state
        );
        const latest = stateRef.current;
        const removedIsReconciled = latest
          ? (() => {
              const result = reconcileMissingApprovalHold(
                latest,
                preparation.reconciliation.bookingRequestId,
                preparation.reconciliation.expectedEvent,
                removedAt,
              );
              return result.error === null && result.state === latest;
            })()
          : false;
        if (removedIsReconciled) {
          try {
            await providerBookingOutbox
              .discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
                resolutionRequest.idempotencyKey,
              );
          } catch {
            scheduleProviderRecovery();
          }
        } else {
          scheduleProviderRecovery();
        }
      } else if (approvalFailureNeedsLifecycleRecovery(cause)) {
        scheduleProviderRecovery();
      } else if (!shouldRetrySameProviderAttempt(cause)) {
        try {
          await providerBookingOutbox
            .discardPreparedApprovalResolutionAfterDefinitiveProviderFailure(
              resolutionRequest.idempotencyKey,
            );
        } catch {
          // Keep the durable record when its provider outcome is uncertain.
        }
      } else {
        scheduleProviderRecovery();
      }
      setError(calendarGatewayWriteError(cause));
      return;
    }

    const resolvedProviderJoinUrl =
      durableResolution.providerResolution.resolution.providerJoinUrl;
    const reconciliation: {
      result?: ProviderApprovalLocalReconciliationResult;
    } = {};
    const changed = await persistCalendarMutation(
      latest => {
        reconciliation.result = reconcileCommittedApprovalResolution(
          latest,
          durableResolution,
        );
        return reconciliation.result.state;
      },
      decision === "approve"
        ? "Meeting approved and confirmed with the provider."
        : "Meeting request declined and its provider hold removed.",
    );
    if (reconciliation.result?.error) setError(reconciliation.result.error);
    const latest = stateRef.current;
    const verified = latest
      ? committedApprovalResolutionIsReconciled(latest, durableResolution)
      : false;
    if ((changed || verified) && !reconciliation.result?.error) {
      if (decision === "decline" || resolvedProviderJoinUrl) {
        try {
          await providerBookingOutbox
            .removeApprovalResolutionAfterLocalReconciliation(
              resolutionRequest.idempotencyKey,
              event.id,
            );
        } catch (cause: unknown) {
          setError(
            cause instanceof Error
              ? `The approval is saved, but TAP still needs to clear its recovery record: ${cause.message}`
              : "The approval is saved, but TAP still needs to clear its recovery record.",
          );
        }
      } else {
        scheduleProviderRecovery();
      }
      providerEventCache.refresh();
    }
  };

  const displayState = useMemo<CalendarState | null>(() => {
    if (!state) return null;
    const calendarIds = new Set(visibleCalendarIds);
    const expiredHoldEventIds = new Set(
      state.bookingRequests
        .filter(request => request.status === "pending" && !isActivePendingRequest(request))
        .map(request => request.eventId),
    );
    const merged = new Map(state.events.map(event => [
      event.id,
      expiredHoldEventIds.has(event.id)
        ? { ...event, status: "cancelled" as const, busy: false }
        : event,
    ]));
    for (const event of providerEventCache.events) {
      if (!calendarIds.has(event.calendarId)) continue;
      const localEvent = merged.get(event.id);
      if (localEvent) {
        // Provider fields are authoritative for active committed Events. TAP's
        // approval lifecycle remains authoritative while a Hold is pending or
        // after TAP has declined/expired it.
        if (
          localEvent.status === "confirmed" &&
          localEvent.kind !== "hold" &&
          event.status === localEvent.status &&
          event.kind === localEvent.kind
        ) {
          const localAttendeesByEmail = new Map(
            localEvent.attendees.map(attendee => [attendee.email.toLowerCase(), attendee]),
          );
          merged.set(event.id, {
            ...event,
            attendees: event.attendees.map(attendee => {
              const local = localAttendeesByEmail.get(attendee.email.toLowerCase());
              return local
                ? { ...attendee, id: local.id, name: local.name, kind: local.kind }
                : attendee;
            }),
            ...(localEvent.source ? { source: localEvent.source } : {}),
            ...(event.providerHtmlLink ?? localEvent.providerHtmlLink
              ? { providerHtmlLink: event.providerHtmlLink ?? localEvent.providerHtmlLink }
              : {}),
            ...(event.providerJoinUrl ?? localEvent.providerJoinUrl
              ? { providerJoinUrl: event.providerJoinUrl ?? localEvent.providerJoinUrl }
              : {}),
          });
        }
        continue;
      }
      const duplicatesLocalEvent = state.events.some(localEvent =>
        localEvent.calendarId === event.calendarId &&
        localEvent.title === event.title &&
        localEvent.start === event.start &&
        localEvent.end === event.end,
      );
      if (!duplicatesLocalEvent) merged.set(event.id, event);
    }
    return {
      ...state,
      activeView: optimisticActiveView ?? state.activeView,
      events: [...merged.values()],
    };
  }, [optimisticActiveView, providerEventCache.events, state, visibleCalendarIds]);

  const publicBusyEvents = useMemo<readonly CalendarEvent[]>(() => {
    if (!state || !publicPreview) return [];
    const conflictIds = new Set(publicConflictCalendarIds);
    const expiredHoldEventIds = new Set(
      state.bookingRequests
        .filter(request => request.status === "pending" && !isActivePendingRequest(request))
        .map(request => request.eventId),
    );
    const merged = new Map<string, CalendarEvent>();
    for (const event of state.events) {
      if (
        conflictIds.has(event.calendarId) &&
        event.status !== "cancelled" &&
        event.status !== "declined" &&
        event.busy !== false &&
        !expiredHoldEventIds.has(event.id)
      ) {
        merged.set(event.id, event);
      }
    }
    for (const event of publicAvailabilityCache.events) {
      if (
        conflictIds.has(event.calendarId) &&
        event.status !== "cancelled" &&
        event.status !== "declined" &&
        event.busy !== false &&
        !expiredHoldEventIds.has(event.id) &&
        !merged.has(event.id)
      ) {
        merged.set(event.id, event);
      }
    }
    return [...merged.values()];
  }, [publicAvailabilityCache.events, publicConflictCalendarIds, publicPreview, state]);

  if (!state || !displayState) {
    return (
      <div className="calendar-loading" role={error ? "alert" : "status"}>
        <span className="calendar-logo"><CalendarCheck2 /></span>
        <strong>{error ? "Calendar unavailable" : "Loading TAP Calendar"}</strong>
        <p>{error ?? "Merging your calendars, availability, and booking pages…"}</p>
      </div>
    );
  }

  if (channelSchedulerSurface) {
    return (
      <EntityIdContext.Provider value={createEntityId}>
        <ChannelSchedulerSurface
          state={state}
          principalAccess={providerPrincipalAccess}
          zoomConnected={zoomConnected}
          channelId={context?.channelId}
          roster={channelParticipantRoster}
          error={error}
          notice={notice}
          onDismissError={() => setError(null)}
          onSubmit={submitScheduledMeeting}
        />
      </EntityIdContext.Provider>
    );
  }

  const selectedEvent = selectedEventId
    ? displayState.events.find(event => event.id === selectedEventId) ?? null
    : null;
  const pendingCount = state.bookingRequests.filter(request =>
    isActivePendingRequest(request)
  ).length;
  const copy = sectionCopy[section];
  const writableDestination = principalWritableDestination(
    state,
    providerPrincipalAccess,
  );
  return (
    <EntityIdContext.Provider value={createEntityId}>
    <div className="tap-calendar-app">
      <a className="skip-link" href="#calendar-main">Skip to calendar content</a>
      <div className="live-region" aria-live="polite" aria-atomic="true">{notice}</div>
      <aside className={`calendar-rail${mobileRailOpen ? " mobile-open" : ""}`} aria-label="TAP Calendar navigation">
        <div className="calendar-brand">
          <span className="calendar-logo"><CalendarCheck2 /></span>
          <div><strong>TAP Calendar</strong><small>One place for your time</small></div>
          <button className="icon-button mobile-only" type="button" onClick={() => setMobileRailOpen(false)} aria-label="Close navigation"><X /></button>
        </div>
        <nav className="calendar-nav">
          {navigation.map(item => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className={section === item.id ? "active" : ""}
                aria-current={section === item.id ? "page" : undefined}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon />
                <span>{item.label}</span>
                {item.id === "notifications" && pendingCount > 0 ? <b>{pendingCount}</b> : null}
              </button>
            );
          })}
        </nav>
        {section === "calendar" ? (
          <CalendarList
            state={state}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
            onAdd={() => setConnectionTarget({ kind: "account" })}
            disabled={saving}
            onToggle={(calendarId, visible) => {
              void commit(current => updateCalendar(current, calendarId, { visible }));
            }}
            onRemove={calendarId => {
              setCalendarRemovalTarget(
                allCalendars(state).find(calendar => calendar.id === calendarId) ?? null,
              );
            }}
          />
        ) : (
          <RailContext section={section} state={bookingAnalyticsState!} analyticsAvailable={bookingAnalyticsAvailable} />
        )}
        <button
          className={`rail-status status-${eventSyncState.status}`}
          type="button"
          onClick={providerEventCache.refresh}
          disabled={eventSyncState.status === "syncing" || state.accounts.length === 0}
          aria-label={
            state.accounts.length === 0
              ? "No calendars connected"
              : eventSyncState.status === "syncing"
                ? "Refreshing calendar data"
                : eventSyncState.status === "error"
                  ? "Retry calendar refresh; the last refresh failed"
                  : eventSyncState.status === "partial"
                    ? "Refresh calendar data; some calendars need attention"
                    : "Refresh calendar data"
          }
        >
          <span className="status-light" aria-hidden="true" />
          <strong>{state.accounts.length === 0 ? "Not connected" : "Connected"}</strong>
          <RefreshCw aria-hidden="true" className={eventSyncState.status === "syncing" ? "is-spinning" : undefined} />
        </button>
      </aside>

      <main className="calendar-workspace" id="calendar-main">
        {preview ? (
          <div className="simulation-banner" role="status">
            <Sparkles />
            <span><strong>Local development</strong> · Calendar connections, cached reads, and Google provider writes use Wrangler + D1; Zephyr publication, reminder delivery, and channel rosters remain service adapters.</span>
          </div>
        ) : null}
        <header className="workspace-header">
          <button className="icon-button mobile-only" type="button" onClick={() => setMobileRailOpen(true)} aria-label="Open navigation"><Menu /></button>
          <div className="workspace-title">
            <span className="eyebrow">TAP Calendar</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" type="button" disabled={!writableDestination} title={writableDestination ? undefined : "Authorize a writable Google Destination Calendar first."} onClick={() => setWorkBlockOpen(true)}><SquareCheckBig /> Block task</button>
            <button className="primary-button" type="button" disabled={!writableDestination} title={writableDestination ? undefined : "Authorize a writable Google Destination Calendar first."} onClick={() => setScheduleStart("")}><Plus /> Schedule</button>
            <button className="avatar-button" type="button" aria-label="Open profile menu" disabled title="Profile actions are provided by the TAP host."><CircleUserRound /></button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert"><AlertTriangle /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X /></button></div>
        ) : null}

        {section === "booking-pages" && !preview ? (
          <div className="analytics-status" role={bookingAnalytics.error ? "alert" : "status"}>
            <span>{bookingAnalytics.error
              ? `${bookingAnalytics.error}${bookingAnalytics.data ? " Showing the last loaded totals." : ""}`
              : bookingAnalytics.loading ? "Refreshing booking analytics…" : "Public booking analytics refresh every minute."}</span>
            <button type="button" className="text-button" disabled={bookingAnalytics.loading} onClick={bookingAnalytics.refresh}>Refresh analytics</button>
          </div>
        ) : null}
        <div className="workspace-content" ref={workspaceContentRef}>
          {section === "calendar" ? (
            <CalendarScreen
              state={displayState}
              anchorDate={anchorDate}
              onAnchorDateChange={setAnchorDate}
              eventSyncState={eventSyncState}
              saving={saving}
              onSetView={view => {
                setOptimisticActiveView(view);
                void commit(current => setCalendarView(current, view))
                  .finally(() => setOptimisticActiveView(null));
              }}
              onSelectEvent={setSelectedEventId}
              onSchedule={start => setScheduleStart(start ?? "")}
              onAddAccount={() => setConnectionTarget({ kind: "account" })}
            />
          ) : null}
          {section === "availability" ? (
            <AvailabilityScreen state={state} commit={commit} />
          ) : null}
          {section === "booking-pages" && !preview ? <WorkspaceBookingPanel gateway={calendarGateway} state={state} authorize={action => requireCalendarAuthority(context, false, action)} /> : null}
          {section === "booking-pages" ? (
            <BookingPagesScreen
              state={state}
              analyticsState={bookingAnalyticsState!}
              analyticsAvailable={bookingAnalyticsAvailable}
              liveAnalytics={!preview}
              commit={commit}
              onNavigate={navigate}
              zoomConnected={zoomConnected}
              onSyncPublication={syncPublicBookingProfile}
              onPreview={(profileId, eventTypeId) => {
                void commit(
                  current => trackFunnel(current, eventTypeId, "views"),
                  undefined,
                  CALENDAR_PUBLISH_ACTION,
                );
                if (preview) {
                  const profile = state.bookingProfiles.find(
                    item => item.id === profileId,
                  );
                  const eventType = profile?.eventTypes.find(
                    item => item.id === eventTypeId,
                  );
                  if (profile && eventType) {
                    globalThis.history.pushState(
                      null,
                      "",
                      `/${encodeURIComponent(profile.slug)}/${encodeURIComponent(eventType.slug)}`,
                    );
                  }
                }
                setPublicPreview({ profileId, eventTypeId });
              }}
              announce={announce}
            />
          ) : null}
          {section === "notifications" ? (
            <NotificationsScreen
              state={state}
              commit={commit}
              announce={announce}
              platform={calendarPlatform}
              workspaceId={context?.workspaceId}
              onApproveBooking={requestId => resolveBookingApproval(requestId, "approve")}
              onDeclineBooking={requestId => resolveBookingApproval(requestId, "decline")}
            />
          ) : null}
          {section === "automations" ? <AutomationsScreen state={state} /> : null}
          {section === "settings" ? (
            <SettingsScreen
              state={state}
              commit={commit}
              gateway={calendarGateway}
              meetingProviderConnections={meetingProviderConnections}
              onRefreshMeetingProviderConnections={refreshMeetingProviderConnections}
              onRequireManage={() =>
                requireCalendarAuthority(context, preview, CALENDAR_MANAGE_ACTION)
              }
              preview={preview}
              announce={announce}
              onAddAccount={() => setConnectionTarget({ kind: "account" })}
              onAddCalendar={accountId => setConnectionTarget({ kind: "calendars", accountId })}
            />
          ) : null}
        </div>
      </main>

      {selectedEvent ? (
        <EventDrawer event={selectedEvent} state={displayState} onClose={() => setSelectedEventId(null)} />
      ) : null}
      {scheduleStart !== null ? (
        <ScheduleDialog
          state={state}
          principalAccess={providerPrincipalAccess}
          zoomConnected={zoomConnected}
          initialStart={scheduleStart}
          onClose={() => setScheduleStart(null)}
          onSubmit={async input => {
            const result = await submitScheduledMeeting(input);
            if (!result.error) {
              setScheduleStart(null);
            }
            return result;
          }}
        />
      ) : null}
      {workBlockOpen ? (
        <WorkBlockDialog
          state={state}
          principalAccess={providerPrincipalAccess}
          platform={calendarPlatform}
          workspaceId={context?.workspaceId}
          onClose={() => setWorkBlockOpen(false)}
          onSubmit={async input => {
            const reserved = await reserveProviderBooking({
              actionId: CALENDAR_MANAGE_ACTION,
              idempotencyKey: input.id,
              destinationCalendarId: input.calendarId,
              title: input.title,
              start: input.start,
              end: input.end,
              bookingKind: "work-block",
              reconciliation: {
                kind: "work-block",
                title: input.title,
                calendarId: input.calendarId,
                start: input.start,
                end: input.end,
                sourceKind: input.sourceKind,
                sourceId: input.sourceId,
                sourceLabel: input.sourceLabel,
              },
            });
            if (!reserved.ok) {
              return {
                error: reserved.error,
                retrySameAttempt: reserved.retrySameAttempt,
              };
            }
            let alreadyReconciled = false;
            const changed = await persistCalendarMutation(
              current => {
                const existing = current.events.find(
                  candidate => candidate.id === reserved.booking.event.id,
                );
                alreadyReconciled = Boolean(
                  existing &&
                  existing.calendarId === input.calendarId &&
                  existing.title === input.title &&
                  existing.start === input.start &&
                  existing.end === input.end &&
                  existing.kind === "work-block" &&
                  existing.source?.kind === input.sourceKind &&
                  existing.source.id === input.sourceId,
                );
                return createWorkBlock(current, {
                  ...input,
                  id: reserved.booking.event.id,
                  ...(reserved.booking.providerHtmlLink
                    ? { providerHtmlLink: reserved.booking.providerHtmlLink }
                    : {}),
                });
              },
              "Work Block committed without copying private task content.",
            );
            if (changed || alreadyReconciled) {
              await finishProviderBookingReconciliation(input.id, reserved.booking);
              providerEventCache.refresh();
              setWorkBlockOpen(false);
            }
            return changed || alreadyReconciled
              ? { error: null, retrySameAttempt: false }
              : {
                  error: "The provider accepted the Work Block, but TAP could not update its local view. Refresh before retrying.",
                  retrySameAttempt: true,
                };
          }}
        />
      ) : null}
      {connectionTarget ? (
        <ConnectCalendarDialog
          gateway={calendarGateway}
          destinationExists={Boolean(writableDestination)}
          existingAccount={connectionTarget.kind === "calendars"
            ? state.accounts.find(account => account.id === connectionTarget.accountId) ?? null
            : null}
          onClose={() => setConnectionTarget(null)}
          onSubmitAccount={async input => {
            let domainError: string | null = null;
            const changed = await commit(current => {
              const result = addConnectedAccount(current, input);
              if (!result.ok) {
                domainError = result.error.message;
                return current;
              }
              return result.state;
            }, `${providerNames[input.provider] ?? "Calendar"} connected.`);
            if (changed) setConnectionTarget(null);
            return domainError ?? (changed ? null : "The calendar account could not be added.");
          }}
          onSubmitCalendars={async (accountId, calendars) => {
            let domainError: string | null = null;
            const changed = await commit(current => {
              const result = addCalendarsToAccount(current, { accountId, calendars });
              if (!result.ok) {
                domainError = result.error.message;
                return current;
              }
              return result.state;
            }, "Calendars added to the account.");
            if (changed) setConnectionTarget(null);
            return domainError ?? (changed ? null : "The calendars could not be added.");
          }}
        />
      ) : null}
      {calendarRemovalTarget ? (
        <RemoveCalendarDialog
          calendar={calendarRemovalTarget}
          state={state}
          onClose={() => setCalendarRemovalTarget(null)}
          onSubmit={async replacementDestinationId => {
            const previousState = stateRef.current;
            if (!previousState) return "The calendar state is no longer available.";
            let domainError: string | null = null;
            const changed = await commit(current => {
              const result = removeCalendarFromTap(
                current,
                calendarRemovalTarget.id,
                replacementDestinationId,
              );
              if (!result.ok) domainError = result.error.message;
              return result.state;
            });
            if (!changed) {
              return domainError ?? "The calendar could not be removed.";
            }
            try {
              await calendarGateway.removeCalendars(
                calendarRemovalTarget.accountId,
                [calendarRemovalTarget.id],
              );
            } catch (cause: unknown) {
              const alreadyAbsent = cause instanceof CalendarGatewayError &&
                (cause.code === "connection_not_found" || cause.code === "calendar_not_found");
              if (!alreadyAbsent) {
                const gatewayMessage = cause instanceof Error
                  ? cause.message
                  : "The Calendar gateway could not remember this removal.";
                const rolledBack = await commit(() => previousState);
                if (rolledBack) {
                  announce("Calendar removal was rolled back because the gateway was unavailable.");
                }
                return rolledBack
                  ? `${gatewayMessage} TAP Calendar restored the calendar.`
                  : `${gatewayMessage} TAP Calendar could not restore the calendar; reload before making more changes.`;
              }
            }
            providerEventCache.removeCalendar(calendarRemovalTarget.id);
            announce(`${calendarRemovalTarget.name} was removed from TAP Calendar.`);
            setCalendarRemovalTarget(null);
            return null;
          }}
        />
      ) : null}
      {publicPreview ? (
        <PublicBookingPreview
          key={`${publicPreview.profileId}:${publicPreview.eventTypeId}`}
          state={state}
          busyEvents={publicBusyEvents}
          selection={publicPreview}
          availabilityCacheAnchorDate={publicAvailabilityAnchorDate}
          availabilityCoverageComplete={publicAvailabilityCache.hasCompleteCoverage}
          availabilitySyncState={publicAvailabilityCache.syncState}
          onClose={() => {
            if (preview) globalThis.history.replaceState(null, "", "/");
            setPublicPreview(null);
          }}
          onCommit={(mutation, message) =>
            commit(mutation, message, CALENDAR_PUBLISH_ACTION)
          }
          onReconcile={persistCalendarMutation}
          onReserveBooking={reserveProviderBooking}
          onProviderReconciled={finishProviderBookingReconciliation}
          onAvailabilityAnchorChange={setPublicAvailabilityAnchorDate}
          onRefreshAvailability={publicAvailabilityCache.refresh}
          announce={announce}
        />
      ) : null}
    </div>
    </EntityIdContext.Provider>
  );
}

function CalendarList({
  state,
  anchorDate,
  onAnchorDateChange,
  onAdd,
  disabled,
  onToggle,
  onRemove,
}: {
  readonly state: CalendarState;
  readonly anchorDate: string;
  readonly onAnchorDateChange: (date: string) => void;
  readonly onAdd: () => void;
  readonly disabled: boolean;
  readonly onToggle: (calendarId: string, visible: boolean) => void;
  readonly onRemove: (calendarId: string) => void;
}) {
  const anchor = parseCalendarDate(anchorDate);
  const firstOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12));
  const miniGridStart = new Date(firstOfMonth);
  miniGridStart.setUTCDate(firstOfMonth.getUTCDate() - firstOfMonth.getUTCDay());
  const miniMonthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(anchor);
  const miniDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(miniGridStart);
    date.setUTCDate(miniGridStart.getUTCDate() + index);
    return {
      key: calendarDateKey(date),
      day: date.getUTCDate(),
      currentMonth: date.getUTCMonth() === anchor.getUTCMonth(),
    };
  });
  return (
    <div className="calendar-list" aria-label="Connected calendars">
      <div className="mini-month" aria-label={`${miniMonthLabel} mini calendar`}>
        <header><button type="button" aria-label="Previous month" onClick={() => onAnchorDateChange(addCalendarMonths(anchorDate, -1))}><ChevronLeft /></button><strong>{miniMonthLabel}</strong><button type="button" aria-label="Next month" onClick={() => onAnchorDateChange(addCalendarMonths(anchorDate, 1))}><ChevronRight /></button></header>
        <div className="mini-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
        <div className="mini-days">{miniDays.map(day => <button type="button" className={`${day.key === anchorDate ? "today" : ""}${day.currentMonth ? "" : " muted"}`} key={day.key} onClick={() => onAnchorDateChange(day.key)} aria-label={`Show ${day.key}`}>{day.day}</button>)}</div>
      </div>
      <div className="calendar-list-heading"><span>My calendars</span><button type="button" aria-label="Add calendar" onClick={onAdd}><Plus /></button></div>
      <div className="account-groups">
        {state.accounts.length === 0 ? (
          <div className="rail-empty-state">
            <Cloud />
            <strong>No calendars connected</strong>
            <span>Add one you own or one shared with you.</span>
            <button type="button" onClick={onAdd}>Add account</button>
          </div>
        ) : null}
        {state.accounts.map(account => (
          <section className="account-group" key={account.id}>
            <header>
              <span>{account.label}</span>
              {account.status === "attention" ? <AlertTriangle aria-label="Connection needs attention" /> : null}
              {account.status === "read-only" ? <LockKeyhole aria-label="Read only connection" /> : null}
            </header>
            {account.calendars.map(calendar => (
              <CalendarContextMenu
                hidden={!calendar.visible}
                key={calendar.id}
                menuLabel={`Actions for ${calendar.name}`}
                hideLabel={`Hide ${calendar.name}`}
                showLabel={`Show ${calendar.name}`}
                removeLabel="Remove from TAP Calendar…"
                toggleDisabled={disabled}
                removeDisabled={disabled}
                onToggleHidden={() => onToggle(calendar.id, !calendar.visible)}
                onRemove={() => onRemove(calendar.id)}
              >
                <label className="calendar-toggle" title="Right-click for calendar actions">
                  <input
                    type="checkbox"
                    checked={calendar.visible}
                    disabled={disabled}
                    onChange={event => onToggle(calendar.id, event.currentTarget.checked)}
                    aria-label={`${calendar.visible ? "Hide" : "Show"} ${calendar.name}`}
                  />
                  <span className="calendar-check" style={{ "--calendar-color": calendar.color } as React.CSSProperties}>{calendar.visible ? <Check /> : null}</span>
                  <span className="calendar-name">{calendar.name}</span>
                  {calendar.unreadCount ? <small>{calendar.unreadCount}</small> : null}
                  {calendar.role === "free-busy" ? <Radio aria-label="Free/busy only" /> : null}
                </label>
              </CalendarContextMenu>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function RailContext({ section, state, analyticsAvailable }: { readonly section: Section; readonly state: CalendarState; readonly analyticsAvailable: boolean }) {
  const activeSchedule = state.availability.find(
    item => item.id === state.activeAvailabilityId,
  );
  const confirmedBookings = state.bookingProfiles
    .flatMap(profile => profile.eventTypes)
    .reduce((total, eventType) => total + eventType.analytics.confirmed, 0);
  const content: Readonly<Record<Exclude<Section, "calendar">, { label: string; value: string; icon: ReactNode }[]>> = {
    availability: [
      { label: "Active schedule", value: activeSchedule?.name ?? "Not configured", icon: <Clock3 /> },
      { label: "Time zone", value: activeSchedule?.timezone ?? "Not configured", icon: <Globe2 /> },
    ],
    "booking-pages": [
      { label: "Published profiles", value: String(state.bookingProfiles.filter(profile => profile.published).length), icon: <Globe2 /> },
      { label: "Confirmed bookings", value: analyticsAvailable ? String(confirmedBookings) : "—", icon: <CheckCircle2 /> },
    ],
    notifications: [
      { label: "Pending approvals", value: String(state.bookingRequests.filter(request => request.status === "pending").length), icon: <Bell /> },
      { label: "Default reminder", value: `${state.notificationPreferences.reminderMinutes[0] ?? 10} minutes`, icon: <Clock3 /> },
    ],
    automations: [
      { label: "Workflow nodes", value: String(state.workflowNodes.length), icon: <Workflow /> },
      { label: "Specialist tools", value: "3", icon: <Bot /> },
    ],
    settings: [
      { label: "Connections", value: String(state.accounts.length), icon: <Cloud /> },
      { label: "Visible calendars", value: String(allCalendars(state).filter(calendar => calendar.visible).length), icon: <Eye /> },
    ],
  };
  if (section === "calendar") return null;
  return (
    <div className="rail-context">
      <span className="eyebrow">At a glance</span>
      {content[section].map(item => (
        <div key={item.label}><span>{item.icon}</span><p><small>{item.label}</small><strong>{item.value}</strong></p></div>
      ))}
    </div>
  );
}

function CalendarEventSyncStatus({
  hasCalendars,
  syncState,
}: {
  readonly hasCalendars: boolean;
  readonly syncState: ProviderEventSyncState;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = globalThis.setInterval(() => setNow(Date.now()), 60_000);
    return () => globalThis.clearInterval(interval);
  }, []);
  if (!hasCalendars) return null;

  const age = syncState.syncedAt
    ? calendarEventAgeLabel(syncState.syncedAt, now)
    : null;
  const stale = syncState.syncedAt
    ? now - Date.parse(syncState.syncedAt) >= CALENDAR_EVENT_REFRESH_INTERVAL_MS
    : false;
  const indicator = syncState.status === "error"
    ? {
        label: age ? `Refresh failed · cached ${age}` : "Events unavailable",
        tone: "declined",
      }
    : syncState.status === "partial"
      ? {
          label: age
            ? `Some calendars cached · oldest ${age}`
            : "Some calendars need attention",
          tone: "pending",
        }
      : syncState.status === "syncing"
        ? {
            label: age ? `Refreshing · cached ${age}` : "Loading events…",
            tone: "pending",
          }
        : syncState.status === "ready" && age
          ? stale
            ? { label: `Cached · ${age}`, tone: "pending" }
            : { label: `Updated ${age}`, tone: "confirmed" }
          : { label: "Waiting to refresh", tone: "pending" };

  return (
    <span
      className={`status-chip status-${indicator.tone}`}
      role="status"
      title="Calendar events render from the local cache while updates continue in the background."
    >
      <Clock3 aria-hidden="true" />
      {indicator.label}
    </span>
  );
}

function CalendarScreen({
  state,
  anchorDate,
  onAnchorDateChange,
  eventSyncState,
  saving,
  onSetView,
  onSelectEvent,
  onSchedule,
  onAddAccount,
}: {
  readonly state: CalendarState;
  readonly anchorDate: string;
  readonly onAnchorDateChange: (date: string) => void;
  readonly eventSyncState: ProviderEventSyncState;
  readonly saving: boolean;
  readonly onSetView: (view: CalendarView) => void;
  readonly onSelectEvent: (eventId: string) => void;
  readonly onSchedule: (start?: string) => void;
  readonly onAddAccount: () => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const horizontalGestureRef = useRef<{
    accumulatedDelta: number;
    locked: boolean;
    resetTimer: ReturnType<typeof globalThis.setTimeout> | null;
  }>({ accumulatedDelta: 0, locked: false, resetTimer: null });
  const shiftRange = (direction: CalendarRangeDirection) => {
    onAnchorDateChange(shiftCalendarAnchor(state.activeView, anchorDate, direction));
  };
  const shiftRangeFromGesture = useEffectEvent(
    (direction: CalendarRangeDirection) => shiftRange(direction),
  );
  const upcomingEvent = [...visibleEvents(state)]
    .filter(event => new Date(event.end).getTime() >= Date.now())
    .sort((left, right) => left.start.localeCompare(right.start))[0];
  const upcomingCalendar = upcomingEvent
    ? allCalendars(state).find(calendar => calendar.id === upcomingEvent.calendarId)
    : undefined;
  const canSchedule = allCalendars(state).some(
    calendar => calendar.destination && calendar.writable,
  );
  const hasAccounts = state.accounts.length > 0;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const gesture = horizontalGestureRef.current;
    const resetGesture = () => {
      gesture.accumulatedDelta = 0;
      gesture.locked = false;
      gesture.resetTimer = null;
    };
    const scheduleReset = () => {
      if (gesture.resetTimer !== null) {
        globalThis.clearTimeout(gesture.resetTimer);
      }
      gesture.resetTimer = globalThis.setTimeout(resetGesture, 220);
    };
    const handleWheel = (event: WheelEvent) => {
      const delta = horizontalCalendarWheelDelta(event, surface.clientWidth);
      if (delta === null) return;
      scheduleReset();

      if (gesture.locked) {
        event.preventDefault();
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const nestedScroller = target?.closest<HTMLElement>(
        ".time-grid-wrap, .month-view, .team-view",
      );
      if (nestedScroller && surface.contains(nestedScroller)) {
        const maximumScrollLeft = nestedScroller.scrollWidth - nestedScroller.clientWidth;
        const canScrollNatively =
          maximumScrollLeft > 1 &&
          (delta > 0
            ? nestedScroller.scrollLeft < maximumScrollLeft - 1
            : nestedScroller.scrollLeft > 1);
        if (canScrollNatively) {
          gesture.accumulatedDelta = 0;
          return;
        }
      }

      event.preventDefault();
      gesture.accumulatedDelta += delta;
      if (Math.abs(gesture.accumulatedDelta) < 60) return;

      gesture.locked = true;
      shiftRangeFromGesture(gesture.accumulatedDelta > 0 ? 1 : -1);
    };

    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      surface.removeEventListener("wheel", handleWheel);
      if (gesture.resetTimer !== null) {
        globalThis.clearTimeout(gesture.resetTimer);
      }
      resetGesture();
    };
  }, [hasAccounts]);

  return (
    <section className="calendar-screen">
      <div className="calendar-toolbar">
        <div className="date-navigation">
          <button type="button" className="today-button" onClick={() => onAnchorDateChange(calendarDateKey(new Date()))}>Today</button>
          <button type="button" className="icon-button" aria-label="Previous date range" onClick={() => shiftRange(-1)}><ChevronLeft /></button>
          <button type="button" className="icon-button" aria-label="Next date range" onClick={() => shiftRange(1)}><ChevronRight /></button>
          <h2 aria-atomic="true" aria-live="polite">{calendarRangeLabel(state.activeView, anchorDate)}</h2>
        </div>
        <CalendarEventSyncStatus
          hasCalendars={allCalendars(state).some(calendar => calendar.visible)}
          syncState={eventSyncState}
        />
        <div className="view-switcher" aria-label="Calendar view">
          {allViews.map(view => (
            <button
              type="button"
              disabled={saving}
              className={state.activeView === view.id ? "active" : ""}
              aria-pressed={state.activeView === view.id}
              key={view.id}
              onClick={() => onSetView(view.id)}
            >{view.label}</button>
          ))}
        </div>
        <button type="button" className="icon-button toolbar-more" aria-label="More calendar options"><MoreHorizontal /></button>
      </div>
      {state.accounts.length === 0 ? (
        <div className="calendar-first-run">
          <ProductEmptyState
            icon={<Cloud />}
            title="Connect your first calendar"
            description="Add an account and choose the calendars TAP should show, check for conflicts, and use for new meetings."
            action={<button type="button" className="primary-button" onClick={onAddAccount}><Plus /> Add calendar account</button>}
          />
        </div>
      ) : <div className="calendar-surface">
        <div className="calendar-board-gesture-surface" ref={surfaceRef}>
          <CalendarBoard state={state} anchorDate={anchorDate} onSelectEvent={onSelectEvent} onSelectSlot={onSchedule} />
        </div>
        <aside className="next-up-panel">
          <header><span><Activity /> Next up</span><small>{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(parseCalendarDate(anchorDate))}</small></header>
          {upcomingEvent ? <div className="next-meeting-card">
            <span className="countdown">Upcoming</span>
            <strong>{upcomingEvent.title}</strong>
            <p><Video /> {upcomingEvent.location ? meetingLocationNames[upcomingEvent.location] : upcomingCalendar?.name ?? "Calendar"} · {timeFormatter.format(new Date(upcomingEvent.start))}–{timeFormatter.format(new Date(upcomingEvent.end))}</p>
            {upcomingEvent.attendees.length > 0 ? <div className="avatar-stack">{upcomingEvent.attendees.slice(0, 3).map(attendee => <span key={attendee.id}>{attendee.name.split(" ").map(word => word[0]).join("").slice(0, 2)}</span>)}</div> : null}
            <button type="button" onClick={() => onSelectEvent(upcomingEvent.id)}>Open event</button>
          </div> : <div className="next-up-empty"><CalendarCheck2 /><strong>Nothing scheduled next</strong><span>New events will appear here after your calendars sync.</span></div>}
          {canSchedule ? <div className="focus-suggestion">
            <Sparkles />
            <div><strong>Protect time for focused work</strong><small>Create a meeting or Work Block on your Destination Calendar.</small></div>
            <button type="button" onClick={() => onSchedule()}>Schedule</button>
          </div> : null}
        </aside>
      </div>}
    </section>
  );
}

const availabilityDays = [1, 2, 3, 4, 5, 6, 0] as const;
const availabilityDayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface AvailabilityHoursError {
  readonly day: number;
  readonly invalidatesInputs: boolean;
  readonly message: string;
}

interface RemovedAvailabilityWindowUndo {
  readonly insertionIndex: number;
  readonly scheduleId: string;
  readonly window: AvailabilityWindow;
}

interface AvailabilityPolicyDraft {
  readonly preferredStart: string;
  readonly preferredEnd: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly bookingHorizonDays: number;
}

const availabilityBufferOptions = [0, 5, 10, 15, 30, 45, 60] as const;
const minimumNoticeOptions = [0, 15, 30, 60, 120, 240, 720, 1440, 2880, 10080] as const;
const bookingHorizonOptions = [7, 14, 30, 60, 90, 180, 365] as const;
const availabilityClockTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

const availabilityPolicyDraft = (
  schedule: AvailabilitySchedule,
): AvailabilityPolicyDraft => ({
  preferredStart: schedule.preferredStart,
  preferredEnd: schedule.preferredEnd,
  bufferBeforeMinutes: schedule.bufferBeforeMinutes,
  bufferAfterMinutes: schedule.bufferAfterMinutes,
  minimumNoticeMinutes: schedule.minimumNoticeMinutes,
  bookingHorizonDays: schedule.bookingHorizonDays,
});

const clockTimeMinutes = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

const formatPolicyMinutes = (minutes: number): string => {
  if (minutes === 0) return "None";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 7 ? "1 week" : `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} min`;
};

const formatBookingHorizon = (days: number): string => {
  if (days === 7) return "1 week";
  if (days === 14) return "2 weeks";
  if (days === 180) return "6 months";
  if (days === 365) return "1 year";
  return `${days} days`;
};

function AvailabilityScreen({ state, commit }: { readonly state: CalendarState; readonly commit: CommitCalendarState }) {
  const createEntityId = useEntityId();
  const [activeId, setActiveId] = useState(state.activeAvailabilityId);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [overrideEditor, setOverrideEditor] = useState<AvailabilityOverride | "new" | null>(null);
  const [hoursError, setHoursError] = useState<AvailabilityHoursError | null>(null);
  const [removedWindowUndo, setRemovedWindowUndo] = useState<RemovedAvailabilityWindowUndo | null>(null);
  const [windowDraft, setWindowDraft] = useState<{
    readonly scheduleId: string;
    readonly windows: readonly AvailabilityWindow[];
  } | null>(null);
  const [windowSaveCount, setWindowSaveCount] = useState(0);
  const [policyDrafts, setPolicyDrafts] = useState<ReadonlyMap<string, AvailabilityPolicyDraft>>(
    () => new Map(),
  );
  const [conflictDraftIds, setConflictDraftIds] = useState<ReadonlySet<string> | null>(null);
  const [policyError, setPolicyError] = useState<{
    readonly scheduleId: string;
    readonly message: string;
  } | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const weeklyHoursRef = useRef<HTMLDivElement>(null);
  const policySectionRef = useRef<HTMLElement>(null);
  const preferredStartRef = useRef<HTMLInputElement>(null);
  const preferredEndRef = useRef<HTMLInputElement>(null);
  const conflictPolicyRef = useRef<HTMLFieldSetElement>(null);
  const bookingHorizonRef = useRef<HTMLSelectElement>(null);
  const windowDraftRef = useRef<typeof windowDraft>(null);
  const windowSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingIntervalFocusRef = useRef<
    | { readonly kind: "start"; readonly id: string }
    | { readonly kind: "add"; readonly day: number }
    | null
  >(null);
  const active = state.availability.find(schedule => schedule.id === activeId) ?? state.availability[0];
  const editorWindows = windowDraft && active && windowDraft.scheduleId === active.id
    ? windowDraft.windows
    : active?.windows ?? [];
  useEffect(() => {
    if (!active) {
      windowDraftRef.current = null;
      setWindowDraft(null);
      setHoursError(null);
      return;
    }
    const currentDraft = windowDraftRef.current;
    if (currentDraft?.scheduleId !== active.id) {
      const windows = active.windows.map(window =>
        window.id ? window : { ...window, id: createEntityId("availability-window") },
      );
      const nextDraft = { scheduleId: active.id, windows };
      windowDraftRef.current = nextDraft;
      setWindowDraft(nextDraft);
      setHoursError(null);
      return;
    }
    if (windowSaveCount > 0 || hoursError) return;
    const nextDraft = { scheduleId: active.id, windows: active.windows };
    windowDraftRef.current = nextDraft;
    setWindowDraft(nextDraft);
  }, [active, createEntityId, hoursError, windowSaveCount]);
  useEffect(() => {
    if (!removedWindowUndo) return;
    const timeout = globalThis.setTimeout(() => setRemovedWindowUndo(null), 10_000);
    return () => globalThis.clearTimeout(timeout);
  }, [removedWindowUndo]);
  useEffect(() => {
    const pending = pendingIntervalFocusRef.current;
    if (!pending) return;
    if (pending.kind === "start") {
      const row = [...(weeklyHoursRef.current?.querySelectorAll<HTMLElement>("[data-window-id]") ?? [])]
        .find(candidate => candidate.dataset.windowId === pending.id);
      const input = row?.querySelector<HTMLInputElement>('input[type="time"]');
      if (!input) return;
      input.focus();
      pendingIntervalFocusRef.current = null;
      return;
    }
    const addButton = [...(weeklyHoursRef.current?.querySelectorAll<HTMLButtonElement>("button[data-add-day]") ?? [])]
      .find(candidate => Number(candidate.dataset.addDay) === pending.day);
    if (!addButton) return;
    addButton.focus();
    pendingIntervalFocusRef.current = null;
  }, [editorWindows.length]);
  const addSchedule = async (
    schedule: AvailabilitySchedule,
    makeDefault: boolean,
  ): Promise<string | null> => {
    let domainError: string | null = null;
    const changed = await commit(current => {
      const result = addAvailabilitySchedule(current, schedule, { makeDefault });
      if (!result.ok) {
        domainError = result.error.message;
        return current;
      }
      return result.state;
    }, "Availability Schedule added.");
    if (changed) {
      setActiveId(schedule.id);
      setScheduleDialogOpen(false);
    }
    return domainError ?? (changed ? null : "The Availability Schedule could not be added.");
  };
  if (!active) {
    return (
      <div className="content-stack first-run-content">
        <ProductEmptyState
          icon={<CalendarClock />}
          title="Set your availability"
          description="Create reusable hours, preferred times, buffers, minimum notice, and booking horizons for your scheduling pages."
          action={<button type="button" className="primary-button" onClick={() => setScheduleDialogOpen(true)}><Plus /> Create availability schedule</button>}
        />
        {scheduleDialogOpen ? <AddAvailabilityDialog firstSchedule onClose={() => setScheduleDialogOpen(false)} onSubmit={addSchedule} /> : null}
      </div>
    );
  }
  const updateSchedule = (
    update: (schedule: AvailabilitySchedule) => AvailabilitySchedule,
    successMessage = "Availability updated.",
  ): Promise<boolean> => commit(current => ({
      ...current,
      availability: current.availability.map(schedule => schedule.id === active.id ? update(schedule) : schedule),
    }), successMessage);
  const policyDraft = policyDrafts.get(active.id) ?? availabilityPolicyDraft(active);
  const savedConflictIds = new Set(
    allCalendars(state)
      .filter(calendar => calendar.conflicts && calendar.freshness !== "stale")
      .map(calendar => calendar.id),
  );
  const selectedConflictIds = conflictDraftIds ?? savedConflictIds;
  const selectedConflictCount = allCalendars(state).filter(
    calendar => calendar.freshness !== "stale" && selectedConflictIds.has(calendar.id),
  ).length;
  const policyDirty = policyDrafts.has(active.id) || conflictDraftIds !== null;
  const activePolicyError = policyError?.scheduleId === active.id ? policyError.message : null;
  const updatePolicyDraft = (update: Partial<AvailabilityPolicyDraft>) => {
    setPolicyDrafts(current => {
      const next = new Map(current);
      next.set(active.id, {
        ...(current.get(active.id) ?? availabilityPolicyDraft(active)),
        ...update,
      });
      return next;
    });
    if (policyError?.scheduleId === active.id) setPolicyError(null);
  };
  const toggleConflictCalendar = (calendar: ConnectedCalendar, checked: boolean) => {
    if (calendar.freshness === "stale") return;
    setConflictDraftIds(current => {
      const next = new Set(current ?? savedConflictIds);
      if (checked) next.add(calendar.id);
      else next.delete(calendar.id);
      return next;
    });
  };
  const disableAllConflictCalendars = () => {
    setConflictDraftIds(new Set());
  };
  const resetPolicyDraft = () => {
    setPolicyDrafts(current => {
      const next = new Map(current);
      next.delete(active.id);
      return next;
    });
    setConflictDraftIds(null);
    setPolicyError(null);
  };
  const saveBookingPolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (policySaving) return;
    if (
      !availabilityClockTimePattern.test(policyDraft.preferredStart)
      || !availabilityClockTimePattern.test(policyDraft.preferredEnd)
    ) {
      setPolicyError({
        scheduleId: active.id,
        message: "Enter a valid preferred start and end time.",
      });
      if (!availabilityClockTimePattern.test(policyDraft.preferredStart)) {
        preferredStartRef.current?.focus();
      } else {
        preferredEndRef.current?.focus();
      }
      return;
    }
    if (clockTimeMinutes(policyDraft.preferredStart) >= clockTimeMinutes(policyDraft.preferredEnd)) {
      setPolicyError({
        scheduleId: active.id,
        message: "Preferred end must be later than preferred start.",
      });
      preferredStartRef.current?.focus();
      return;
    }
    const scheduleId = active.id;
    const conflictSelection = conflictDraftIds;
    const knownCalendarIds = new Set(allCalendars(state).map(calendar => calendar.id));
    setPolicySaving(true);
    setPolicyError(null);
    const saved = await commit(current => {
      let next: CalendarState = {
        ...current,
        availability: current.availability.map(schedule =>
          schedule.id === scheduleId ? { ...schedule, ...policyDraft } : schedule,
        ),
      };
      if (conflictSelection !== null) {
        for (const calendar of allCalendars(next)) {
          if (!knownCalendarIds.has(calendar.id)) continue;
          const conflicts = calendar.freshness !== "stale" && conflictSelection.has(calendar.id);
          if (calendar.conflicts !== conflicts) {
            next = updateCalendar(next, calendar.id, { conflicts });
          }
        }
      }
      return next;
    }, "Booking policy saved.");
    setPolicySaving(false);
    if (!saved) return;
    setPolicyDrafts(current => {
      const next = new Map(current);
      next.delete(scheduleId);
      return next;
    });
    setConflictDraftIds(null);
  };
  const focusPolicyControl = (target: "preferred" | "conflicts" | "horizon") => {
    policySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    globalThis.requestAnimationFrame(() => {
      if (target === "preferred") preferredStartRef.current?.focus();
      else if (target === "horizon") bookingHorizonRef.current?.focus();
      else conflictPolicyRef.current?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus();
    });
  };
  const applyWindowDraft = (windows: readonly AvailabilityWindow[]) => {
    const nextDraft = { scheduleId: active.id, windows };
    windowDraftRef.current = nextDraft;
    setWindowDraft(nextDraft);
  };
  const currentWindows = (): readonly AvailabilityWindow[] =>
    windowDraftRef.current?.scheduleId === active.id
      ? windowDraftRef.current.windows
      : editorWindows;
  const enqueueWindowSave = (
    windows: readonly AvailabilityWindow[],
    successMessage: string,
  ): Promise<boolean> => {
    const scheduleId = active.id;
    setWindowSaveCount(count => count + 1);
    const run = windowSaveQueueRef.current.then(() => commit(current => ({
      ...current,
      availability: current.availability.map(schedule =>
        schedule.id === scheduleId ? { ...schedule, windows } : schedule,
      ),
    }), successMessage));
    const settled = run.catch(() => false);
    windowSaveQueueRef.current = settled.then(() => undefined);
    return settled.finally(() => setWindowSaveCount(count => Math.max(0, count - 1)));
  };
  const persistWindows = (
    windows: readonly AvailabilityWindow[],
    successMessage: string,
    errorDay: number,
  ): Promise<boolean> => {
    applyWindowDraft(windows);
    const validationError = validateAvailabilityWindows(windows);
    if (validationError) {
      setHoursError({ day: errorDay, invalidatesInputs: true, message: validationError });
      return Promise.resolve(false);
    }
    setHoursError(null);
    return enqueueWindowSave(windows, successMessage);
  };
  const setDayEnabled = (day: number, enabled: boolean) => {
    const existingWindows = currentWindows();
    const dayWindows = existingWindows.filter(window => window.day === day);
    const windows = dayWindows.length === 0 && enabled
      ? [...existingWindows, {
          id: createEntityId("availability-window"),
          day,
          enabled: true,
          start: "09:00",
          end: "17:00",
        }]
      : existingWindows.map(window => window.day === day ? { ...window, enabled } : window);
    void persistWindows(
      windows,
      `${availabilityDayNames[day]} availability ${enabled ? "enabled" : "disabled"}.`,
      day,
    );
  };
  const addInterval = (day: number) => {
    const existingWindows = currentWindows();
    const id = createEntityId("availability-window");
    const interval = createAdditionalAvailabilityWindow(existingWindows, day, id);
    if (!interval) {
      setHoursError({
        day,
        invalidatesInputs: false,
        message: `${availabilityDayNames[day]} has no room for another 30-minute time range.`,
      });
      return;
    }
    const lastDayIndex = existingWindows.reduce(
      (latest, window, index) => window.day === day ? index : latest,
      -1,
    );
    const insertionIndex = lastDayIndex + 1;
    const windows = [
      ...existingWindows.slice(0, insertionIndex),
      interval,
      ...existingWindows.slice(insertionIndex),
    ];
    pendingIntervalFocusRef.current = { kind: "start", id };
    void persistWindows(windows, `Added a ${availabilityDayNames[day]} time range.`, day)
      .then(saved => { if (!saved) pendingIntervalFocusRef.current = null; });
  };
  const removeInterval = (day: number, windowIndex: number) => {
    const existingWindows = currentWindows();
    const dayWindowCount = existingWindows.filter(window => window.day === day).length;
    const removedWindow = existingWindows[windowIndex];
    if (dayWindowCount <= 1 || !removedWindow) return;
    pendingIntervalFocusRef.current = { kind: "add", day };
    void persistWindows(
      existingWindows.filter((_, index) => index !== windowIndex),
      `Removed a ${availabilityDayNames[day]} time range.`,
      day,
    ).then(saved => {
      if (!saved) {
        pendingIntervalFocusRef.current = null;
        return;
      }
      setRemovedWindowUndo({
        insertionIndex: windowIndex,
        scheduleId: active.id,
        window: removedWindow,
      });
    });
  };
  const updateInterval = (
    windowIndex: number,
    update: Partial<Pick<AvailabilityWindow, "start" | "end">>,
  ) => {
    const existingWindows = currentWindows();
    const target = existingWindows[windowIndex];
    if (!target) return;
    const windows = existingWindows.map((window, index) =>
      index === windowIndex ? { ...window, ...update } : window,
    );
    void persistWindows(windows, "Availability updated.", target.day);
  };
  const restoreRemovedInterval = () => {
    if (!removedWindowUndo || removedWindowUndo.scheduleId !== active.id) return;
    const existingWindows = currentWindows();
    if (
      removedWindowUndo.window.id &&
      existingWindows.some(window => window.id === removedWindowUndo.window.id)
    ) {
      setRemovedWindowUndo(null);
      return;
    }
    const insertionIndex = Math.min(removedWindowUndo.insertionIndex, existingWindows.length);
    const windows = [
      ...existingWindows.slice(0, insertionIndex),
      removedWindowUndo.window,
      ...existingWindows.slice(insertionIndex),
    ];
    if (removedWindowUndo.window.id) {
      pendingIntervalFocusRef.current = { kind: "start", id: removedWindowUndo.window.id };
    }
    void persistWindows(
      windows,
      `Restored the ${availabilityDayNames[removedWindowUndo.window.day]} time range.`,
      removedWindowUndo.window.day,
    ).then(saved => {
      if (saved) setRemovedWindowUndo(null);
      else pendingIntervalFocusRef.current = null;
    });
  };
  const eventTypeCount = state.bookingProfiles
    .flatMap(profile => profile.eventTypes)
    .filter(eventType =>
      resolveEventTypeAvailabilityScheduleId(state, eventType) === active.id
    )
    .length;
  return (
    <div className="content-stack">
      <section className="summary-grid availability-summary">
        <MetricCard icon={<CalendarClock />} label="Active schedule" value={active.name} detail={`${eventTypeCount} configured Event ${eventTypeCount === 1 ? "Type" : "Types"}`} tone="violet" />
        <MetricCard icon={<Clock3 />} label="Preferred window" value={`${active.preferredStart}–${active.preferredEnd}`} detail="Slots starting inside this window appear first" tone="blue" actionLabel="Configure preferred window" onAction={() => focusPolicyControl("preferred")} />
        <MetricCard icon={<ShieldCheck />} label="Conflict calendars" value={String(savedConflictIds.size)} detail="Plus each Event Type's destination" tone="green" actionLabel="Configure conflict calendars" onAction={() => focusPolicyControl("conflicts")} />
        <MetricCard icon={<Globe2 />} label="Booking horizon" value={`${active.bookingHorizonDays} days`} detail={`${formatPolicyMinutes(active.minimumNoticeMinutes)} minimum notice`} tone="orange" actionLabel="Configure booking limits" onAction={() => focusPolicyControl("horizon")} />
      </section>
      <div className="availability-layout">
        <aside className="schedule-list panel">
          <header><div><span className="eyebrow">Named schedules</span><h2>Availability</h2></div><button type="button" className="icon-button" aria-label="Add availability schedule" disabled={windowSaveCount > 0} onClick={() => setScheduleDialogOpen(true)}><Plus /></button></header>
          {state.availability.map(schedule => (
            <button type="button" className={schedule.id === active.id ? "active" : ""} disabled={windowSaveCount > 0} onClick={() => setActiveId(schedule.id)} key={schedule.id}>
              <span><strong>{schedule.name}</strong><small>{timeZoneDisplayLabel(schedule.timezone)}</small></span>
              {schedule.id === state.activeAvailabilityId ? <b>Default</b> : null}
              <ChevronRight />
            </button>
          ))}
          <div className="availability-note"><Sparkles /><p><strong>Preferred time</strong><small>Shown slots favor {active.preferredStart}–{active.preferredEnd} without making other available times unavailable.</small></p></div>
        </aside>
        <section className="availability-editor panel">
          <header><div><span className="eyebrow">Weekly hours</span><h2>{active.name}</h2><p>{timeZoneDisplayLabel(active.timezone)} · viewer time zones convert automatically</p></div><button type="button" className="secondary-button" disabled={windowSaveCount > 0} onClick={() => { const duplicate = { ...active, id: createEntityId("availability"), name: `${active.name} copy`, windows: active.windows.map(window => ({ ...window, id: createEntityId("availability-window") })) }; void addSchedule(duplicate, false); }}><Copy /> Duplicate</button></header>
          <TimeZoneCombobox
            className="availability-time-zone"
            label="Schedule time zone"
            name={`availability-timezone-${active.id}`}
            value={active.timezone}
            onValueChange={timezone => void updateSchedule(schedule => ({ ...schedule, timezone }))}
            description="Weekly hours use this time zone. Date overrides can use a different travel time zone."
            required
          />
          <section className="availability-policy" ref={policySectionRef} aria-labelledby={`availability-policy-${active.id}`}>
            <header>
              <div>
                <span className="eyebrow">Booking policy</span>
                <h3 id={`availability-policy-${active.id}`}>Slot rules & conflict checks</h3>
                <p>Control which times appear first, when guests can book, and which calendars remove busy times.</p>
              </div>
              {policyDirty ? <span className="unsaved-badge">Unsaved changes</span> : null}
            </header>
            <form noValidate aria-busy={policySaving} onSubmit={saveBookingPolicy}>
              {activePolicyError ? <div className="availability-policy-error" id={`availability-policy-error-${active.id}`} role="alert"><AlertTriangle /><span>{activePolicyError}</span></div> : null}
              <div className="availability-policy-grid">
                <fieldset className="availability-policy-card">
                  <legend>Preferred slot window</legend>
                  <p>Slots starting inside this window are offered first; other available times remain bookable.</p>
                  <div className="availability-policy-pair">
                    <label className="field">
                      <span>Preferred start</span>
                      <input
                        ref={preferredStartRef}
                        name={`preferred-start-${active.id}`}
                        type="time"
                        step="300"
                        value={policyDraft.preferredStart}
                        required
                        disabled={policySaving}
                        aria-invalid={activePolicyError ? true : undefined}
                        aria-describedby={activePolicyError ? `availability-policy-error-${active.id}` : undefined}
                        onChange={event => updatePolicyDraft({ preferredStart: event.currentTarget.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Preferred end</span>
                      <input
                        ref={preferredEndRef}
                        name={`preferred-end-${active.id}`}
                        type="time"
                        step="300"
                        value={policyDraft.preferredEnd}
                        required
                        disabled={policySaving}
                        aria-invalid={activePolicyError ? true : undefined}
                        aria-describedby={activePolicyError ? `availability-policy-error-${active.id}` : undefined}
                        onChange={event => updatePolicyDraft({ preferredEnd: event.currentTarget.value })}
                      />
                    </label>
                  </div>
                </fieldset>
                <fieldset className="availability-policy-card">
                  <legend>Booking limits</legend>
                  <p>Set how soon and how far ahead a guest may book.</p>
                  <div className="availability-policy-pair">
                    <label className="field">
                      <span>Minimum notice</span>
                      <select disabled={policySaving} value={policyDraft.minimumNoticeMinutes} onChange={event => updatePolicyDraft({ minimumNoticeMinutes: Number(event.currentTarget.value) })}>
                        {!minimumNoticeOptions.some(value => value === policyDraft.minimumNoticeMinutes) ? <option value={policyDraft.minimumNoticeMinutes}>{formatPolicyMinutes(policyDraft.minimumNoticeMinutes)}</option> : null}
                        {minimumNoticeOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}
                      </select>
                      <small>How close to the start time someone may book.</small>
                    </label>
                    <label className="field">
                      <span>Booking horizon</span>
                      <select ref={bookingHorizonRef} disabled={policySaving} value={policyDraft.bookingHorizonDays} onChange={event => updatePolicyDraft({ bookingHorizonDays: Number(event.currentTarget.value) })}>
                        {!bookingHorizonOptions.some(value => value === policyDraft.bookingHorizonDays) ? <option value={policyDraft.bookingHorizonDays}>{formatBookingHorizon(policyDraft.bookingHorizonDays)}</option> : null}
                        {bookingHorizonOptions.map(value => <option value={value} key={value}>{formatBookingHorizon(value)}</option>)}
                      </select>
                      <small>How far into the future someone may book.</small>
                    </label>
                  </div>
                </fieldset>
                <fieldset className="availability-policy-card">
                  <legend>Meeting buffers</legend>
                  <p>Hold extra time around each booking. Buffers reduce available slots.</p>
                  <div className="availability-policy-pair">
                    <label className="field">
                      <span>Buffer before</span>
                      <select disabled={policySaving} value={policyDraft.bufferBeforeMinutes} onChange={event => updatePolicyDraft({ bufferBeforeMinutes: Number(event.currentTarget.value) })}>
                        {!availabilityBufferOptions.some(value => value === policyDraft.bufferBeforeMinutes) ? <option value={policyDraft.bufferBeforeMinutes}>{formatPolicyMinutes(policyDraft.bufferBeforeMinutes)}</option> : null}
                        {availabilityBufferOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Buffer after</span>
                      <select disabled={policySaving} value={policyDraft.bufferAfterMinutes} onChange={event => updatePolicyDraft({ bufferAfterMinutes: Number(event.currentTarget.value) })}>
                        {!availabilityBufferOptions.some(value => value === policyDraft.bufferAfterMinutes) ? <option value={policyDraft.bufferAfterMinutes}>{formatPolicyMinutes(policyDraft.bufferAfterMinutes)}</option> : null}
                        {availabilityBufferOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}
                      </select>
                    </label>
                  </div>
                </fieldset>
                <fieldset className="availability-policy-card availability-conflict-policy" ref={conflictPolicyRef}>
                  <legend>Conflict calendars</legend>
                  <div className="availability-conflict-heading">
                    <p>Busy events on checked calendars remove slots. These choices apply to every Availability Schedule and are independent of calendar visibility. Each Event Type also checks its own Destination Calendar.</p>
                    <Button type="button" variant="outline" size="sm" disabled={selectedConflictCount === 0 || policySaving} onClick={disableAllConflictCalendars}><ShieldOff data-icon="inline-start" /> Disable all</Button>
                  </div>
                  {state.accounts.length > 0 ? <div className="availability-conflict-groups">
                    {state.accounts.map(account => <section aria-label={`${account.label} conflict calendars`} key={account.id}>
                      <header><strong>{account.label}</strong><span>{providerNames[account.provider]}</span></header>
                      {account.calendars.map(calendar => {
                        const stale = calendar.freshness === "stale";
                        const checked = !stale && selectedConflictIds.has(calendar.id);
                        const reasonId = `conflict-calendar-reason-${calendar.id}`;
                        return <label className={`availability-conflict-row${checked ? " checked" : ""}`} key={calendar.id}>
                          <span className="availability-conflict-name"><i style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.role} · {calendar.visible ? "Shown" : "Hidden"}</small></span></span>
                          <span id={reasonId} className="availability-conflict-reason">{stale ? "Refresh required" : checked ? calendar.destination ? "Blocks busy times · Default destination" : "Blocks busy times" : calendar.destination ? "Still checked when used as a destination" : "Ignored for conflicts"}</span>
                          <span className="switch">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={stale || policySaving}
                              aria-label={`Check ${calendar.name} for conflicts`}
                              aria-describedby={reasonId}
                              onChange={event => toggleConflictCalendar(calendar, event.currentTarget.checked)}
                            />
                            <span />
                          </span>
                        </label>;
                      })}
                    </section>)}
                  </div> : <div className="availability-conflict-empty"><ShieldOff /><span><strong>No calendars available for conflict checks</strong><small>Connect a calendar in Settings before publishing bookable time.</small></span></div>}
                  <div className={`availability-conflict-status${selectedConflictCount === 0 ? " warning" : ""}`} role="status">
                    {selectedConflictCount === 0
                      ? "No shared Conflict Calendars are checked. Each Event Type will still check its Destination Calendar."
                      : `${selectedConflictCount} ${selectedConflictCount === 1 ? "calendar is" : "calendars are"} checked for conflicts, plus each Event Type's destination.`}
                  </div>
                </fieldset>
              </div>
              <footer className="availability-policy-actions">
                <button type="button" className="secondary-button" disabled={!policyDirty || policySaving} onClick={resetPolicyDraft}>Reset changes</button>
                <button type="submit" className="primary-button" disabled={!policyDirty || policySaving}><Check /> {policySaving ? "Saving…" : "Save booking policy"}</button>
              </footer>
            </form>
          </section>
          {hoursError ? <div className="availability-hours-error" id="availability-hours-error" role="alert"><AlertTriangle /><span>{hoursError.message}</span></div> : null}
          <div className="weekly-hours" ref={weeklyHoursRef} aria-busy={windowSaveCount > 0}>
            {availabilityDays.map(day => {
              const name = availabilityDayNames[day];
              const intervals = editorWindows
                .map((window, windowIndex) => ({ window, windowIndex }))
                .filter(entry => entry.window.day === day)
                .sort((left, right) => left.window.start.localeCompare(right.window.start) || left.window.end.localeCompare(right.window.end));
              const enabled = intervals.some(entry => entry.window.enabled);
              const canAdd = createAdditionalAvailabilityWindow(editorWindows, day) !== null;
              const inputsInvalid = hoursError?.invalidatesInputs === true && hoursError.day === day;
              return (
                <fieldset className={`weekly-day${enabled ? "" : " disabled"}`} key={day}>
                  <legend className="visually-hidden">{name} availability</legend>
                  {!enabled ? <div className="weekly-hour-row">
                    <label className="switch"><input type="checkbox" checked={false} aria-label={`Enable ${name}`} onChange={() => setDayEnabled(day, true)} /><span /></label>
                    <strong>{name}</strong>
                    <small className="weekly-unavailable">Unavailable</small>
                  </div> : intervals.map(({ window, windowIndex }, rangeIndex) => {
                    const rangeNumber = rangeIndex + 1;
                    const windowId = window.id ?? `legacy-${day}-${windowIndex}`;
                    return <div className="weekly-hour-row" role="group" aria-label={`${name} time range ${rangeNumber}`} data-window-id={windowId} key={windowId}>
                      {rangeIndex === 0
                        ? <><label className="switch"><input type="checkbox" checked aria-label={`Disable ${name}`} onChange={() => setDayEnabled(day, false)} /><span /></label><strong>{name}</strong></>
                        : <><span aria-hidden="true" /><span aria-hidden="true" /></>}
                      <div className="weekly-time-fields">
                        <input type="time" aria-label={`${name} time range ${rangeNumber} start`} aria-invalid={inputsInvalid || undefined} aria-describedby={inputsInvalid ? "availability-hours-error" : undefined} value={window.start} onChange={event => updateInterval(windowIndex, { start: event.currentTarget.value })} />
                        <span>to</span>
                        <input type="time" aria-label={`${name} time range ${rangeNumber} end`} aria-invalid={inputsInvalid || undefined} aria-describedby={inputsInvalid ? "availability-hours-error" : undefined} value={window.end} onChange={event => updateInterval(windowIndex, { end: event.currentTarget.value })} />
                      </div>
                      <div className="weekly-time-actions">
                        {rangeIndex === intervals.length - 1 ? <button type="button" className="icon-button" data-add-day={day} aria-label={`Add ${name} time range`} aria-disabled={!canAdd} title={canAdd ? `Add another ${name} time range` : `${name} has no room for another 30-minute time range.`} onClick={() => addInterval(day)}><Plus aria-hidden="true" /></button> : null}
                        {intervals.length > 1 ? <button type="button" className="icon-button" aria-label={`Remove ${name} time range ${rangeNumber}`} onClick={() => removeInterval(day, windowIndex)}><Minus aria-hidden="true" /></button> : null}
                      </div>
                    </div>;
                  })}
                </fieldset>
              );
            })}
          </div>
          {removedWindowUndo?.scheduleId === active.id ? <div className="availability-removal-undo" role="status"><span>Removed {availabilityDayNames[removedWindowUndo.window.day]} {removedWindowUndo.window.start}–{removedWindowUndo.window.end}.</span><button type="button" className="text-button" onClick={restoreRemovedInterval}>Undo removal</button></div> : null}
          <section className="date-overrides">
            <header><div><span className="eyebrow">Date-specific availability</span><h3>Overrides, travel & out of office</h3></div><button type="button" className="secondary-button" onClick={() => setOverrideEditor("new")}><Plus /> Add override</button></header>
            {(active.overrides ?? []).map(override => {
              const date = parseCalendarDate(override.date);
              const configuredTimeZone = override.timezone ?? active.timezone;
              const effectiveTimeZone = isSupportedTimeZone(configuredTimeZone)
                ? configuredTimeZone
                : detectedTimeZone();
              const travel = effectiveTimeZone !== active.timezone;
              return <div className="date-override-row" key={override.id}>
                <span className="date-tile">{date.getUTCDate()}<small>{new Intl.DateTimeFormat(undefined, { month: "short", timeZone: "UTC" }).format(date)}</small></span>
                <p className="date-override-copy"><strong>{override.label}</strong><small>{override.available ? `${override.start}–${override.end}` : "Unavailable · Out of office"}</small><small className="date-override-timezone"><Globe2 aria-hidden="true" /> {timeZoneDisplayLabelForDate(override.date, effectiveTimeZone, override.start ?? "12:00")}</small></p>
                <span className="rule-badge">{override.available ? travel ? "Travel hours" : "Custom hours" : "All day"}</span>
                <button type="button" className="icon-button" aria-label={`Edit ${override.label}`} onClick={() => setOverrideEditor(override)}><MoreHorizontal /></button>
              </div>;
            })}
            {(active.overrides ?? []).length === 0 ? <div><p><strong>No date overrides</strong><small>Weekly hours apply to every date in the booking horizon.</small></p></div> : null}
          </section>
        </section>
      </div>
      {scheduleDialogOpen ? <AddAvailabilityDialog onClose={() => setScheduleDialogOpen(false)} onSubmit={addSchedule} /> : null}
      {overrideEditor ? <AvailabilityOverrideDialog scheduleTimeZone={active.timezone} existing={overrideEditor === "new" ? undefined : overrideEditor} onClose={() => setOverrideEditor(null)} onSubmit={async override => {
        let domainError: string | null = null;
        const changed = await commit(current => {
          const currentSchedule = current.availability.find(schedule => schedule.id === active.id);
          if (!currentSchedule) {
            domainError = "This Availability Schedule is no longer available.";
            return current;
          }
          if ((currentSchedule.overrides ?? []).some(item =>
            item.id !== override.id && item.date === override.date
          )) {
            domainError = "An Availability Override already exists for this date. Edit the existing override instead.";
            return current;
          }
          return {
            ...current,
            availability: current.availability.map(schedule => schedule.id === active.id
              ? {
                  ...schedule,
                  overrides: [
                    ...(schedule.overrides ?? []).filter(item => item.id !== override.id),
                    override,
                  ].sort((left, right) => left.date.localeCompare(right.date)),
                }
              : schedule),
          };
        }, "Availability override saved.");
        if (changed) setOverrideEditor(null);
        return domainError ?? (changed ? null : "The override could not be saved.");
      }} /> : null}
    </div>
  );
}

function AddAvailabilityDialog({
  firstSchedule = false,
  onClose,
  onSubmit,
}: {
  readonly firstSchedule?: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (
    schedule: AvailabilitySchedule,
    makeDefault: boolean,
  ) => Promise<string | null>;
}) {
  const createEntityId = useEntityId();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(() => detectedTimeZone());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [preferredStart, setPreferredStart] = useState("10:00");
  const [preferredEnd, setPreferredEnd] = useState("15:00");
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = useState(5);
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState(10);
  const [minimumNoticeMinutes, setMinimumNoticeMinutes] = useState(120);
  const [bookingHorizonDays, setBookingHorizonDays] = useState(60);
  const [makeDefault, setMakeDefault] = useState(firstSchedule);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const weekdayStartRef = useRef<HTMLInputElement>(null);
  const weekdayEndRef = useRef<HTMLInputElement>(null);
  const schedulePreferredStartRef = useRef<HTMLInputElement>(null);
  const schedulePreferredEndRef = useRef<HTMLInputElement>(null);
  const submitSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (name.trim().length === 0) {
      setError("Enter a schedule name.");
      nameRef.current?.focus();
      return;
    }
    if (!isSupportedTimeZone(timezone)) {
      setError("Choose a valid IANA time zone.");
      return;
    }
    const timeFields = [
      { label: "weekday start", value: start, ref: weekdayStartRef },
      { label: "weekday end", value: end, ref: weekdayEndRef },
      { label: "preferred start", value: preferredStart, ref: schedulePreferredStartRef },
      { label: "preferred end", value: preferredEnd, ref: schedulePreferredEndRef },
    ] as const;
    const invalidTime = timeFields.find(field => !availabilityClockTimePattern.test(field.value));
    if (invalidTime) {
      setError(`Enter a valid ${invalidTime.label} time.`);
      invalidTime.ref.current?.focus();
      return;
    }
    if (clockTimeMinutes(start) >= clockTimeMinutes(end)) {
      setError("Weekday end must be later than weekday start.");
      weekdayStartRef.current?.focus();
      return;
    }
    if (clockTimeMinutes(preferredStart) >= clockTimeMinutes(preferredEnd)) {
      setError("Preferred end must be later than preferred start.");
      schedulePreferredStartRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    const id = createEntityId("availability");
    void onSubmit({
      id,
      name: name.trim(),
      timezone,
      preferredStart,
      preferredEnd,
      windows: [1, 2, 3, 4, 5, 6, 0].map(day => ({
        id: createEntityId("availability-window"),
        day,
        enabled: day >= 1 && day <= 5,
        start,
        end,
      })),
      bufferBeforeMinutes,
      bufferAfterMinutes,
      minimumNoticeMinutes,
      bookingHorizonDays,
      overrides: [],
    }, makeDefault).then(message => setError(message)).finally(() => setSubmitting(false));
  };
  return (
    <Modal title="Add an Availability Schedule" description="Create reusable booking hours with their own preferred window, buffers, notice, and booking horizon." onClose={onClose}>
      <form className="schedule-form" noValidate aria-busy={submitting} onSubmit={submitSchedule}>
        {error ? <div className="dialog-warning" id="availability-schedule-error" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <label className="field"><span>Schedule name</span><input ref={nameRef} name="availability-name" autoComplete="off" value={name} required disabled={submitting} aria-describedby={error ? "availability-schedule-error" : undefined} onChange={event => setName(event.currentTarget.value)} /></label>
        <TimeZoneCombobox label="Time zone" name="availability-timezone" value={timezone} onValueChange={setTimezone} required disabled={submitting} />
        <div className="form-grid"><label className="field"><span>Weekday start</span><input ref={weekdayStartRef} type="time" value={start} required disabled={submitting} aria-invalid={error && !availabilityClockTimePattern.test(start) ? true : undefined} aria-describedby={error ? "availability-schedule-error" : undefined} onChange={event => setStart(event.currentTarget.value)} /></label><label className="field"><span>Weekday end</span><input ref={weekdayEndRef} type="time" value={end} required disabled={submitting} aria-invalid={error && !availabilityClockTimePattern.test(end) ? true : undefined} aria-describedby={error ? "availability-schedule-error" : undefined} onChange={event => setEnd(event.currentTarget.value)} /></label></div>
        <div className="form-grid"><label className="field"><span>Preferred start</span><input ref={schedulePreferredStartRef} type="time" value={preferredStart} required disabled={submitting} aria-invalid={error && !availabilityClockTimePattern.test(preferredStart) ? true : undefined} aria-describedby={error ? "availability-schedule-error" : undefined} onChange={event => setPreferredStart(event.currentTarget.value)} /></label><label className="field"><span>Preferred end</span><input ref={schedulePreferredEndRef} type="time" value={preferredEnd} required disabled={submitting} aria-invalid={error && !availabilityClockTimePattern.test(preferredEnd) ? true : undefined} aria-describedby={error ? "availability-schedule-error" : undefined} onChange={event => setPreferredEnd(event.currentTarget.value)} /></label></div>
        <div className="form-grid"><label className="field"><span>Buffer before</span><select value={bufferBeforeMinutes} disabled={submitting} onChange={event => setBufferBeforeMinutes(Number(event.currentTarget.value))}>{availabilityBufferOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}</select></label><label className="field"><span>Buffer after</span><select value={bufferAfterMinutes} disabled={submitting} onChange={event => setBufferAfterMinutes(Number(event.currentTarget.value))}>{availabilityBufferOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}</select></label></div>
        <div className="form-grid"><label className="field"><span>Minimum notice</span><select value={minimumNoticeMinutes} disabled={submitting} onChange={event => setMinimumNoticeMinutes(Number(event.currentTarget.value))}>{minimumNoticeOptions.map(value => <option value={value} key={value}>{formatPolicyMinutes(value)}</option>)}</select><small>How close to the start time someone may book.</small></label><label className="field"><span>Booking horizon</span><select value={bookingHorizonDays} disabled={submitting} onChange={event => setBookingHorizonDays(Number(event.currentTarget.value))}>{bookingHorizonOptions.map(value => <option value={value} key={value}>{formatBookingHorizon(value)}</option>)}</select><small>How far into the future someone may book.</small></label></div>
        <label className="approval-check"><input type="checkbox" checked={makeDefault} disabled={firstSchedule || submitting} onChange={event => setMakeDefault(event.currentTarget.checked)} /><span><strong>Make this the default</strong><small>{firstSchedule ? "Your first schedule becomes the default automatically." : "New Event Types will use this schedule unless changed."}</small></span></label>
        <DialogActions onCancel={onClose} submitLabel="Add schedule" submitting={submitting} />
      </form>
    </Modal>
  );
}

function AvailabilityOverrideDialog({
  existing,
  scheduleTimeZone,
  onClose,
  onSubmit,
}: {
  readonly existing: AvailabilityOverride | undefined;
  readonly scheduleTimeZone: string;
  readonly onClose: () => void;
  readonly onSubmit: (override: AvailabilityOverride) => Promise<string | null>;
}) {
  const createEntityId = useEntityId();
  const [date, setDate] = useState(() => existing?.date ?? calendarDateKey(new Date(Date.now() + 7 * 86_400_000)));
  const [label, setLabel] = useState(existing?.label ?? "");
  const [available, setAvailable] = useState(existing?.available ?? false);
  const [start, setStart] = useState(existing?.start ?? "10:00");
  const [end, setEnd] = useState(existing?.end ?? "15:00");
  const [timezone, setTimezone] = useState(existing?.timezone ?? scheduleTimeZone);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const parsedReferenceInstant = Date.parse(`${date}T12:00:00.000Z`);
  const referenceInstant = Number.isFinite(parsedReferenceInstant)
    ? parsedReferenceInstant
    : Date.now();
  return (
    <Modal title={existing ? "Edit availability override" : "Add availability override"} description="Replace weekly hours for one local date, including travel, or mark the whole day unavailable." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => {
        event.preventDefault();
        if (submitting) return;
        if (!isSupportedTimeZone(timezone)) {
          setError("Choose a valid IANA time zone.");
          return;
        }
        if (available && start >= end) {
          setError("Custom hours must end after they start.");
          return;
        }
        setSubmitting(true);
        const override: AvailabilityOverride = {
          id: existing?.id ?? createEntityId("override"),
          date,
          label: label.trim(),
          available,
          timezone,
          ...(available ? { start, end } : {}),
        };
        void onSubmit(override).then(message => setError(message)).finally(() => setSubmitting(false));
      }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <div className="form-grid"><label className="field"><span>Date</span><input type="date" value={date} required onChange={event => setDate(event.currentTarget.value)} /></label><label className="field"><span>Label</span><input name="override-label" autoComplete="off" value={label} required onChange={event => setLabel(event.currentTarget.value)} /></label></div>
        <TimeZoneCombobox label="Override time zone" name="availability-override-timezone" value={timezone} onValueChange={setTimezone} referenceInstant={referenceInstant} description="The date and custom hours use this time zone. Choose your destination time zone when traveling." required />
        <label className="approval-check"><input type="checkbox" checked={available} onChange={event => setAvailable(event.currentTarget.checked)} /><span><strong>Available with custom hours</strong><small>Leave off to block the entire local day in the selected time zone.</small></span></label>
        {available ? <div className="form-grid"><label className="field"><span>Starts</span><input type="time" value={start} onChange={event => setStart(event.currentTarget.value)} /></label><label className="field"><span>Ends</span><input type="time" value={end} onChange={event => setEnd(event.currentTarget.value)} /></label></div> : null}
        <DialogActions onCancel={onClose} submitLabel="Save override" submitting={submitting} />
      </form>
    </Modal>
  );
}

function BookingPagesScreen({ state, analyticsState, analyticsAvailable, liveAnalytics, commit, onNavigate, onSyncPublication, onPreview, announce, zoomConnected }: { readonly state: CalendarState; readonly analyticsState: CalendarState; readonly analyticsAvailable: boolean; readonly liveAnalytics: boolean; readonly commit: CommitCalendarState; readonly onNavigate: (section: Section) => void; readonly onSyncPublication: (profileId: string) => Promise<boolean>; readonly onPreview: (profileId: string, eventTypeId: string) => void; readonly announce: (message: string) => void; readonly zoomConnected: boolean }) {
  const [profileEditor, setProfileEditor] = useState<BookingProfile | "new" | null>(null);
  const [eventTypeProfileId, setEventTypeProfileId] = useState<string | null>(null);
  const [insights, setInsights] = useState<{ profile: BookingProfile; eventType: EventType } | null>(null);
  const insightsProfile = analyticsState.bookingProfiles.find(profile => profile.id === insights?.profile.id);
  const insightsEventType = insightsProfile?.eventTypes.find(eventType => eventType.id === insights?.eventType.id);
  const [publishingProfileId, setPublishingProfileId] = useState<string | null>(null);
  const [publicationErrors, setPublicationErrors] = useState<Record<string, string | null>>({});
  const copyBookingPageUrl = useCallback(async (profileSlug: string, eventType: EventType): Promise<void> => {
    try {
      await copyTextToClipboard(publicBookingUrl(profileSlug, eventType.slug));
      announce("Booking link copied.");
    } catch {
      announce("TAP couldn’t copy the booking link. Select the URL and copy it manually.");
    }
  }, [announce]);
  useEffect(() => {
    setPublicationErrors(current => {
      const unsettledProfileIds = new Set(
        state.bookingProfiles
          .filter(profile => deriveBookingProfilePublicationState(profile).pending)
          .map(profile => profile.id),
      );
      const next = Object.fromEntries(
        Object.entries(current).filter(([profileId]) => unsettledProfileIds.has(profileId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [state.bookingProfiles]);
  const totals = analyticsState.bookingProfiles.flatMap(profile => profile.eventTypes).reduce((sum, eventType) => ({ views: sum.views + eventType.analytics.views, confirmed: sum.confirmed + eventType.analytics.confirmed }), { views: 0, confirmed: 0 });
  const liveProfiles = state.bookingProfiles.filter(profile =>
    deriveBookingProfilePublicationState(profile).liveStatus === "published");
  const liveEventPageCount = liveProfiles.reduce(
    (count, profile) => count + profile.eventTypes.filter(eventType =>
      isEventTypePublicationLive(profile, eventType)).length,
    0,
  );
  const liveUrlCount = liveProfiles.length + liveEventPageCount;
  const hasWritableDestination = Boolean(providerWritableDestination(state));
  const hasAvailabilitySchedule = state.availability.length > 0;
  const canCreateEventType = hasWritableDestination && hasAvailabilitySchedule;
  const eventTypeCreationHint = !hasWritableDestination
    ? "Connect a writable Google Destination Calendar before creating an Event Type."
    : !hasAvailabilitySchedule
      ? "Create an Availability Schedule before creating an Event Type."
      : undefined;
  const eventTypePrerequisiteSection: Section = hasWritableDestination
    ? "availability"
    : "settings";
  const eventTypePrerequisiteAction = hasWritableDestination
    ? "Create Availability Schedule"
    : "Connect Google Calendar";
  const availabilityNames = useMemo(
    () => new Map(state.availability.map(schedule => [schedule.id, schedule.name])),
    [state.availability],
  );
  const saveProfile = async (profile: BookingProfile): Promise<string | null> => {
    let domainError: string | null = null;
    const changed = await commit(current => {
      const existing = current.bookingProfiles.find(candidate => candidate.id === profile.id);
      if (!existing) {
        const result = addBookingProfile(current, profile);
        if (!result.ok) {
          domainError = result.error.message;
          return current;
        }
        return result.state;
      }
      const slugError = validateSlug(profile.slug);
      if (slugError) {
        domainError = slugError;
        return current;
      }
      if (current.bookingProfiles.some(candidate => candidate.id !== profile.id && candidate.slug === profile.slug)) {
        domainError = `The Booking Profile Slug "${profile.slug}" is already in use.`;
        return current;
      }
      return {
        ...current,
        bookingProfiles: current.bookingProfiles.map(candidate =>
          candidate.id === profile.id
            ? enforceImmutablePublicationSlugs(candidate, {
              ...candidate,
              displayName: profile.displayName.trim(),
              ownerType: profile.ownerType,
              slug: profile.slug,
              timezone: profile.timezone,
              published: profile.published,
            })
            : candidate,
        ),
      };
    }, "Booking Profile saved.", CALENDAR_PUBLISH_ACTION);
    if (changed) {
      setProfileEditor(null);
      await onSyncPublication(profile.id);
    }
    return domainError ?? (changed ? null : "The Booking Profile could not be saved.");
  };
  const saveEventType = async (profileId: string, eventType: NewEventType): Promise<string | null> => {
    let domainError: string | null = null;
    const changed = await commit(current => {
      const result = addEventType(current, profileId, eventType);
      if (!result.ok) {
        domainError = result.error.message;
        return current;
      }
      return result.state;
    }, "Event Type saved.", CALENDAR_PUBLISH_ACTION);
    if (changed) {
      setEventTypeProfileId(null);
      await onSyncPublication(profileId);
    }
    return domainError ?? (changed ? null : "The Event Type could not be created.");
  };
  const publishProfile = useCallback(async (profile: BookingProfile): Promise<void> => {
    if (publishingProfileId === profile.id) return;
    setPublishingProfileId(profile.id);
    setPublicationErrors(current => ({ ...current, [profile.id]: null }));
    try {
      if (!profile.published) {
        const saved = await commit(current => {
          const currentProfile = current.bookingProfiles.find(candidate => candidate.id === profile.id);
          if (!currentProfile || currentProfile.published) return current;
          return {
            ...current,
            bookingProfiles: current.bookingProfiles.map(candidate =>
              candidate.id === profile.id
                ? { ...candidate, published: true }
                : candidate
            ),
          };
        }, undefined, CALENDAR_PUBLISH_ACTION);
        if (!saved) {
          setPublicationErrors(current => ({
            ...current,
            [profile.id]: "TAP couldn't save the publication request. Try again.",
          }));
          return;
        }
      }
      if (!await onSyncPublication(profile.id)) {
        setPublicationErrors(current => ({
          ...current,
          [profile.id]: "TAP couldn't publish this profile to cal.with-tap.ai. Try again.",
        }));
      }
    } finally {
      setPublishingProfileId(current => current === profile.id ? null : current);
    }
  }, [commit, onSyncPublication, publishingProfileId]);
  return (
    <div className="content-stack">
      <section className="summary-grid">
        <MetricCard icon={<Eye />} label="Page views" value={analyticsAvailable ? totals.views.toLocaleString() : "—"} detail={liveAnalytics ? "Views recorded since tracking was enabled" : "Local preview activity"} tone="blue" />
        <MetricCard icon={<MousePointerClick />} label="Confirmed bookings" value={analyticsAvailable ? totals.confirmed.toLocaleString() : "—"} detail={liveAnalytics ? "All-time confirmed public bookings" : `${((totals.confirmed / Math.max(1, totals.views)) * 100).toFixed(1)}% view-to-booking conversion`} tone="green" />
        <MetricCard icon={<Link2 />} label="Published URLs" value={String(liveUrlCount)} detail="Profile and Event Type URLs confirmed by the server" tone="violet" />
        <MetricCard icon={<ShieldCheck />} label="Public protection" value="Managed" detail="Cloudflare Turnstile verification plus gateway rate limits" tone="green" />
      </section>
      <div className="section-heading"><div><span className="eyebrow">Public scheduling</span><h2>Booking Profiles & Event Types</h2><p>Public booking v1 supports individual profiles with globally reserved slugs.</p></div><button type="button" className="primary-button" onClick={() => setProfileEditor("new")}><Plus /> New Booking Profile</button></div>
      {state.bookingProfiles.length === 0 ? (
        <ProductEmptyState
          icon={<Globe2 />}
          title="Create your first booking page"
          description="Start with a profile slug, then add Event Types after a writable Destination Calendar is connected."
          action={<button type="button" className="primary-button" onClick={() => setProfileEditor("new")}><Plus /> New Booking Profile</button>}
        />
      ) : null}
      {state.bookingProfiles.map(profile => {
        const publicationState = deriveBookingProfilePublicationState(profile);
        const serverPublished = publicationState.liveStatus === "published";
        const activeEventTypes = profile.eventTypes.filter(eventType => eventType.active);
        const liveEventTypes = profile.eventTypes.filter(eventType =>
          isEventTypePublicationLive(profile, eventType));
        const publicationError = publicationErrors[profile.id] ?? null;
        const isPublishing = publishingProfileId === profile.id;
        const isUnpublishing = publicationState.pending &&
          publicationState.desiredStatus === "unpublished";
        const publicationNeedsAction = !isUnpublishing && (
          !serverPublished ||
          (publicationState.pending && publicationState.desiredStatus === "published")
        );
        const publicationActionLabel = isPublishing
          ? activeEventTypes.length === 0 ? "Claiming…" : "Publishing…"
          : publicationError
            ? "Retry publish"
            : serverPublished
              ? "Publish changes"
              : activeEventTypes.length === 0
                ? "Claim profile"
                : "Publish booking pages";
        const statusLabel = publicationState.pending
          ? publicationState.desiredStatus === "unpublished"
            ? "Unpublishing"
            : serverPublished
              ? "Changes pending"
              : "Publish required"
          : serverPublished
            ? liveEventTypes.length === 0 ? "Claimed" : "Published"
            : publicationState.liveStatus === "unpublished"
              ? "Unpublished"
              : "Draft";
        return (
        <section className="profile-panel panel" key={profile.id}>
          <header className="profile-header">
            <div className="profile-identity"><span>{profile.displayName.split(" ").map(word => word[0]).join("")}</span><div><span className="eyebrow">{profile.ownerType} booking profile</span><h2>{profile.displayName}</h2><p>cal.with-tap.ai/<strong>{profile.slug}</strong></p></div></div>
            <div className="profile-actions">
              <span className={serverPublished && !publicationState.pending ? "published-badge" : "status-chip status-pending"}><span /> {statusLabel}</span>
              {isUnpublishing ? (
                <button type="button" className="secondary-button" onClick={() => void onSyncPublication(profile.id)}>
                  <RefreshCw /> Retry unpublish
                </button>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => setProfileEditor(profile)}><Settings2 /> Profile settings</button>
              <button type="button" className="primary-button" title={eventTypeCreationHint} aria-describedby={!canCreateEventType && profile.eventTypes.length === 0 ? `event-type-guidance-${profile.id}` : undefined} onClick={() => setEventTypeProfileId(profile.id)}><Plus /> New Event Type</button>
            </div>
          </header>
          {publicationNeedsAction ? (
            <Alert
              className="profile-publication-guidance"
              variant={publicationError ? "destructive" : "info"}
              role={publicationError ? "alert" : "status"}
            >
              {publicationError ? <AlertTriangle aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
              <div className="profile-publication-guidance-layout">
                <div className="profile-publication-guidance-copy">
                  <AlertTitle>
                    {publicationError
                      ? "Booking pages couldn’t publish"
                      : serverPublished
                        ? "Your latest booking page changes are not live yet."
                        : activeEventTypes.length === 0
                          ? `Claim cal.with-tap.ai/${profile.slug} now. You can add Event Types later.`
                          : "Your active Event Types are ready, but their booking pages are not live yet."}
                  </AlertTitle>
                  <AlertDescription>
                    {publicationError
                      ? publicationError
                      : serverPublished
                        ? "Publish changes to update every active Event Type in this profile."
                        : activeEventTypes.length === 0
                          ? "This reserves your public profile URL before you are ready to accept bookings."
                          : "Publishing makes every active Event Type in this profile public."}
                  </AlertDescription>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={publicationError ? "outline" : "default"}
                  disabled={isPublishing}
                  aria-busy={isPublishing}
                  onClick={() => void publishProfile(profile)}
                >
                  {publicationError
                    ? <RefreshCw data-icon="inline-start" />
                    : <Globe2 data-icon="inline-start" />}
                  {publicationActionLabel}
                </Button>
              </div>
            </Alert>
          ) : null}
          <div className="event-type-grid">
            {profile.eventTypes.map(eventType => {
              const analytics = analyticsState.bookingProfiles.find(item => item.id === profile.id)!
                .eventTypes.find(item => item.id === eventType.id)!.analytics;
              const pageIsLive = isEventTypePublicationLive(profile, eventType);
              const eventTypeStatus = !eventType.active
                ? "Paused"
                : pageIsLive
                  ? "Live"
                  : "Ready to publish";
              return (
              <article className="event-type-card" key={eventType.id} style={{ "--event-type-color": eventType.color } as React.CSSProperties}>
                <div className="event-type-stripe" />
                <header><div><span className="event-type-icon"><CalendarClock /></span><span className={`status-chip ${pageIsLive ? "status-confirmed" : "status-pending"}`}>{eventTypeStatus}</span></div></header>
                <h3>{eventType.title}</h3><p>{eventType.description}</p>
                <div className="event-type-meta"><span><Clock3 /> {eventType.durationMinutes} min</span><span><CalendarDays /> {availabilityNames.get(resolveEventTypeAvailabilityScheduleId(state, eventType) ?? "") ?? "Availability unavailable"}</span><span><Video /> {meetingLocationNames[eventType.location]}</span><span><ShieldCheck /> {eventType.approvalRequired ? "Approval required" : "Automatic"}</span></div>
                <div className="public-url"><span>{pageIsLive ? "Live" : "Not live"} · cal.with-tap.ai/{profile.slug}/<strong>{eventType.slug}</strong></span>{pageIsLive ? <button type="button" onClick={() => void copyBookingPageUrl(profile.slug, eventType)} aria-label={`Copy URL for ${eventType.title}`}><Copy /></button> : null}</div>
                <div className="conversion-row"><div><span>Views</span><strong>{analyticsAvailable ? analytics.views.toLocaleString() : "—"}</strong></div><ArrowRight /><div><span>Starts</span><strong>{analyticsAvailable ? analytics.starts.toLocaleString() : "—"}</strong></div><ArrowRight /><div><span>Confirmed</span><strong>{analyticsAvailable ? analytics.confirmed.toLocaleString() : "—"}</strong></div><b>{liveAnalytics ? "Public" : `${(conversionRate(analytics) * 100).toFixed(1)}%`}</b></div>
                <footer><button type="button" className="secondary-button" onClick={() => onPreview(profile.id, eventType.id)}><Eye /> Preview page</button><button type="button" className="secondary-button" onClick={() => setInsights({ profile, eventType })}><BarChart3 /> Insights</button></footer>
              </article>
            );})}
            {profile.eventTypes.length === 0 ? <div className="empty-calendar"><CalendarClock /><strong>No Event Types yet</strong><span id={`event-type-guidance-${profile.id}`}>{!canCreateEventType ? eventTypeCreationHint : serverPublished ? "Your profile URL is claimed and live. Add an Event Type when you’re ready to accept bookings." : "Claim this profile URL now, then add an Event Type when you’re ready."}</span>{canCreateEventType ? <button type="button" className="primary-button" onClick={() => setEventTypeProfileId(profile.id)}><Plus /> New Event Type</button> : <Button type="button" onClick={() => onNavigate(eventTypePrerequisiteSection)}>{hasWritableDestination ? <CalendarClock data-icon="inline-start" /> : <Settings2 data-icon="inline-start" />}{eventTypePrerequisiteAction}</Button>}</div> : null}
          </div>
        </section>
      );})}
      {profileEditor ? <BookingProfileDialog state={state} profile={profileEditor === "new" ? undefined : profileEditor} onClose={() => setProfileEditor(null)} onSubmit={saveProfile} /> : null}
      {eventTypeProfileId ? <EventTypeDialog state={state} profileId={eventTypeProfileId} zoomConnected={zoomConnected} onClose={() => setEventTypeProfileId(null)} onNavigate={onNavigate} onSubmit={saveEventType} /> : null}
      {insightsProfile && insightsEventType ? <BookingInsightsDialog analyticsAvailable={analyticsAvailable} liveAnalytics={liveAnalytics} profile={insightsProfile} eventType={insightsEventType} onClose={() => setInsights(null)} /> : null}
    </div>
  );
}

function BookingProfileDialog({
  state,
  profile,
  onClose,
  onSubmit,
}: {
  readonly state: CalendarState;
  readonly profile: BookingProfile | undefined;
  readonly onClose: () => void;
  readonly onSubmit: (profile: BookingProfile) => Promise<string | null>;
}) {
  const createEntityId = useEntityId();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [slug, setSlug] = useState(profile?.slug ?? "");
  const [ownerType, setOwnerType] = useState<BookingProfile["ownerType"]>(profile?.ownerType ?? "individual");
  const [timezone, setTimezone] = useState(() => profile?.timezone ?? detectedTimeZone());
  const [published, setPublished] = useState(profile?.published ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const editing = Boolean(profile);
  const slugReserved = profile?.publication !== undefined;
  const hasActiveEventTypes = profile?.eventTypes.some(eventType => eventType.active) ?? false;
  return (
    <Modal title={editing ? "Booking Profile settings" : "New Booking Profile"} description="Choose the globally unique first segment of every public scheduling URL in this profile." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => { event.preventDefault(); if (submitting) return; if (!isSupportedTimeZone(timezone)) { setError("Choose a valid IANA time zone."); return; } if (ownerType !== "individual" && published) { setError("Public booking v1 supports individual profiles only."); return; } setSubmitting(true); const next: BookingProfile = { id: profile?.id ?? createEntityId("profile"), displayName: displayName.trim(), ownerType, slug: slug.trim(), timezone, published, eventTypes: profile?.eventTypes ?? [], ...(profile?.publication === undefined ? {} : { publication: profile.publication }), ...(profile?.pendingPublication === undefined ? {} : { pendingPublication: profile.pendingPublication }) }; void onSubmit(next).then(message => setError(message)).finally(() => setSubmitting(false)); }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <div className="form-grid"><label className="field"><span>Owner</span><select value={ownerType} disabled={submitting} onChange={event => setOwnerType(event.currentTarget.value as BookingProfile["ownerType"])}><option value="individual">Individual</option><option value="team" disabled>Team · not supported in public v1</option><option value="organization" disabled>Organization · not supported in public v1</option></select></label><TimeZoneCombobox label="Time zone" name="profile-timezone" value={timezone} onValueChange={setTimezone} required disabled={submitting} /></div>
        <label className="field"><span>Display name</span><input name="profile-name" autoComplete="organization" value={displayName} required maxLength={120} onChange={event => setDisplayName(event.currentTarget.value)} /></label>
        <label className="field"><span>Profile Slug</span><input name="profile-slug" autoComplete="off" value={slug} required readOnly={slugReserved} aria-describedby="profile-slug-description" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={event => setSlug(event.currentTarget.value.toLowerCase())} /><small id="profile-slug-description">{slugReserved ? "This globally reserved slug cannot be changed." : `cal.with-tap.ai/${slug || "your-slug"}`}</small></label>
        <label className="approval-check"><input type="checkbox" checked={published} disabled={submitting} onChange={event => setPublished(event.currentTarget.checked)} /><span><strong>Claim and publish this profile</strong><small>{hasActiveEventTypes ? "Reserve the profile URL and publish every active Event Type." : `Reserve cal.with-tap.ai/${slug || "your-slug"} now. Add Event Types whenever you’re ready.`}</small></span></label>
        <div className="privacy-preview"><Globe2 /><div><strong>Globally unique profile namespace</strong><p>{state.bookingProfiles.filter(item => item.id !== profile?.id).length} other profile slugs are reserved in this Calendar state.</p><small>Event Type slugs only need to be unique inside this profile.</small></div></div>
        <DialogActions onCancel={onClose} submitLabel={editing ? "Save profile" : "Create profile"} submitting={submitting} />
      </form>
    </Modal>
  );
}

function EventTypeDialog({
  state,
  profileId,
  zoomConnected,
  onClose,
  onNavigate,
  onSubmit,
}: {
  readonly state: CalendarState;
  readonly profileId: string;
  readonly zoomConnected: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (section: Section) => void;
  readonly onSubmit: (profileId: string, eventType: NewEventType) => Promise<string | null>;
}) {
  const createEntityId = useEntityId();
  const profile = state.bookingProfiles.find(item => item.id === profileId);
  const writableCalendars = allCalendars(state).filter(calendar =>
    supportsProviderBookingWrites(state, calendar)
  );
  const defaultDestination = preferredDestinationCalendar(writableCalendars);
  const defaultAvailabilitySchedule = state.availability.find(
    schedule => schedule.id === state.activeAvailabilityId,
  ) ?? state.availability[0];
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [location, setLocation] = useState<MeetingLocation>("google-meet");
  const [destinationCalendarId, setDestinationCalendarId] = useState(defaultDestination?.id ?? "");
  const [availabilityScheduleId, setAvailabilityScheduleId] = useState(
    defaultAvailabilitySchedule?.id ?? "",
  );
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [active, setActive] = useState(true);
  const [color, setColor] = useState("#6d5dfc");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (!profile || !defaultDestination || !defaultAvailabilitySchedule) {
    const destinationMissing = !defaultDestination;
    const prerequisiteSection: Section = destinationMissing ? "settings" : "availability";
    return (
      <Modal title={destinationMissing ? "Google Destination Calendar required" : "Availability Schedule required"} description={destinationMissing ? "Every Event Type needs a writable calendar for confirmed bookings." : "Every Event Type needs explicit booking hours."} onClose={onClose}>
        <ProductEmptyState
          icon={destinationMissing ? <Settings2 /> : <CalendarClock />}
          title={destinationMissing ? "Connect Google Calendar" : "Create an Availability Schedule"}
          description={destinationMissing ? "Open Calendar settings, authorize Google, and make an owner or writer calendar the Destination Calendar." : "Open Availability and create reusable booking hours. Your first schedule becomes the default automatically."}
          action={<Button type="button" onClick={() => { onClose(); onNavigate(prerequisiteSection); }}>{destinationMissing ? <Settings2 data-icon="inline-start" /> : <CalendarClock data-icon="inline-start" />}{destinationMissing ? "Open Calendar settings" : "Create Availability Schedule"}</Button>}
        />
      </Modal>
    );
  }
  return (
    <Modal title={`New Event Type for ${profile.displayName}`} description="Choose the URL, Availability Schedule, provider, and Destination Calendar." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => { event.preventDefault(); if (submitting) return; setSubmitting(true); const eventType: NewEventType = { id: createEntityId("event-type"), title: title.trim(), slug: slug.trim(), description: description.trim(), durationMinutes, location, destinationCalendarId, availabilityScheduleId, approvalRequired, active, color, analytics: { views: 0, slotViews: 0, starts: 0, requests: 0, confirmed: 0 } }; void onSubmit(profileId, eventType).then(message => setError(message)).finally(() => setSubmitting(false)); }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <FieldGroup className="calendar-form-fields">
          <Field>
            <FieldLabel htmlFor="event-type-name">Event Type name</FieldLabel>
            <Input id="event-type-name" name="event-type-name" autoComplete="off" value={title} required maxLength={160} disabled={submitting} onChange={event => setTitle(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-type-slug">Event Type slug</FieldLabel>
            <Input id="event-type-slug" name="event-type-slug" autoComplete="off" value={slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" disabled={submitting} onChange={event => setSlug(event.currentTarget.value.toLowerCase())} />
            <FieldDescription>cal.with-tap.ai/{profile.slug}/{slug || "event-type"}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="event-type-description">Description</FieldLabel>
            <Textarea id="event-type-description" name="event-type-description" rows={2} value={description} disabled={submitting} onChange={event => setDescription(event.currentTarget.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-type-availability-schedule">Availability Schedule</FieldLabel>
            <NativeSelect
              id="event-type-availability-schedule"
              name="event-type-availability-schedule"
              value={availabilityScheduleId}
              required
              disabled={submitting}
              onChange={event => setAvailabilityScheduleId(event.currentTarget.value)}
            >
              {state.availability.map(schedule => (
                <NativeSelectOption value={schedule.id} key={schedule.id}>
                  {schedule.name}{schedule.id === state.activeAvailabilityId ? " (Default)" : ""} · {timeZoneDisplayLabel(schedule.timezone)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Weekly hours, travel overrides, buffers, notice, and booking horizon come from this schedule.
            </FieldDescription>
          </Field>
          <div className="form-grid">
            <Field>
              <FieldLabel htmlFor="event-type-duration">Duration</FieldLabel>
              <NativeSelect id="event-type-duration" name="event-type-duration" value={String(durationMinutes)} disabled={submitting} onChange={event => setDurationMinutes(Number(event.currentTarget.value))}>
                <NativeSelectOption value="15">15 minutes</NativeSelectOption>
                <NativeSelectOption value="30">30 minutes</NativeSelectOption>
                <NativeSelectOption value="45">45 minutes</NativeSelectOption>
                <NativeSelectOption value="60">1 hour</NativeSelectOption>
                <NativeSelectOption value="90">90 minutes</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="event-type-provider">Meeting provider</FieldLabel>
              <NativeSelect id="event-type-provider" name="event-type-provider" value={location} disabled={submitting} onChange={event => setLocation(event.currentTarget.value as MeetingLocation)}>
                <NativeSelectOption value="google-meet">Google Meet</NativeSelectOption>
                {zoomConnected ? <NativeSelectOption value="zoom">Zoom</NativeSelectOption> : null}
              </NativeSelect>
              <FieldDescription>{meetingProviderConnectionDescription(zoomConnected)}</FieldDescription>
            </Field>
          </div>
          <div className="form-grid">
            <Field>
              <FieldLabel htmlFor="event-type-destination">Destination Calendar</FieldLabel>
              <NativeSelect id="event-type-destination" name="event-type-destination" value={destinationCalendarId} disabled={submitting} onChange={event => setDestinationCalendarId(event.currentTarget.value)}>
                {writableCalendars.map(calendar => <NativeSelectOption value={calendar.id} key={calendar.id}>{calendar.name}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="event-type-color">Accent color</FieldLabel>
              <Input id="event-type-color" name="event-type-color" type="color" value={color} disabled={submitting} onChange={event => setColor(event.currentTarget.value)} />
            </Field>
          </div>
        </FieldGroup>
        <label className="approval-check"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.currentTarget.checked)} /><span><strong>Require host approval</strong><small>Creates an expiring Tentative Booking Hold before provider confirmation.</small></span></label>
        <label className="approval-check"><input type="checkbox" checked={active} onChange={event => setActive(event.currentTarget.checked)} /><span><strong>Accept bookings</strong><small>Inactive Event Types keep their URL reserved without showing available slots.</small></span></label>
        <DialogActions onCancel={onClose} submitLabel="Create Event Type" submitting={submitting} />
      </form>
    </Modal>
  );
}

function BookingInsightsDialog({ profile, eventType, analyticsAvailable, liveAnalytics, onClose }: { readonly profile: BookingProfile; readonly eventType: EventType; readonly analyticsAvailable: boolean; readonly liveAnalytics: boolean; readonly onClose: () => void }) {
  const steps = [
    ["Views", eventType.analytics.views],
    ["Slot views", eventType.analytics.slotViews],
    ["Starts", eventType.analytics.starts],
    ["Requests", eventType.analytics.requests],
    ["Confirmed", eventType.analytics.confirmed],
  ] as const;
  return (
    <Modal title={`${eventType.title} insights`} description={`Privacy-preserving funnel analytics for cal.with-tap.ai/${profile.slug}/${eventType.slug}.`} onClose={onClose}>
      <div className="content-stack insights-dialog">
        <div className="conversion-row">{steps.map(([label, value], index) => <div key={label}><span>{label}</span><strong>{analyticsAvailable ? value.toLocaleString() : "—"}</strong>{index < steps.length - 1 ? <ArrowRight /> : null}</div>)}</div>
        <div className="privacy-preview"><BarChart3 /><div><strong>{liveAnalytics ? "Public booking totals" : `${(conversionRate(eventType.analytics) * 100).toFixed(1)}% view-to-confirmed conversion`}</strong><p>Counts are aggregated by Event Type without cross-site fingerprinting.</p><small>{liveAnalytics ? "Requests and confirmations include historical bookings. Views, slot views, and starts are recorded from when tracking was enabled, so historical conversion is unavailable. Confirmations remain counted after cancellation." : "Local preview activity only."}</small></div></div>
        <button type="button" className="primary-button full-width" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function NotificationsScreen({ state, commit, announce, platform, workspaceId, onApproveBooking, onDeclineBooking }: { readonly state: CalendarState; readonly commit: CommitCalendarState; readonly announce: (message: string) => void; readonly platform: CalendarPlatform; readonly workspaceId: string | undefined; readonly onApproveBooking: (requestId: string) => Promise<void>; readonly onDeclineBooking: (requestId: string) => Promise<void> }) {
  const createEntityId = useEntityId();
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(null);
  const privateChannel = state.notificationChannels.find(channel => channel.scope === "private");
  const sharedChannels = state.notificationChannels.filter(channel => channel.scope !== "private");
  const resolveRequest = async (
    requestId: string,
    decision: "approve" | "decline",
  ) => {
    if (resolvingRequestId) return;
    setResolvingRequestId(requestId);
    try {
      await (decision === "approve"
        ? onApproveBooking(requestId)
        : onDeclineBooking(requestId));
    } finally {
      setResolvingRequestId(null);
    }
  };
  const ensureChannel = async () => {
    const result = await platform.ensurePrivateNotificationChannel(workspaceId ? { workspaceId } : {});
    if (!result.ok) {
      announce(result.error.message);
      return;
    }
    await commit(current => current.notificationChannels.some(channel => channel.scope === "private")
      ? current
      : {
          ...current,
          notificationChannels: [
            {
              id: result.value.channelId,
              name: result.value.name,
              scope: "private",
              enabled: true,
              entries: [],
            },
            ...current.notificationChannels,
          ],
        });
    announce(`${result.value.created ? "Created" : "Found"} ${result.value.name}.`);
  };
  const testNotification = async () => {
    const result = await platform.notifyImmediately("This is a TAP Calendar test notification.");
    announce(result.ok
      ? result.value.delivery === "shown"
        ? "System notification delivered."
        : `System notification suppressed: ${result.value.reason}.`
      : result.error.message);
  };
  return (
    <>
    <div className="notifications-layout">
      <section className="channel-panel panel">
        <header><div className="channel-title"><span><MessageSquareText /></span><div><span className="eyebrow">Private channel</span><h2>{privateChannel?.name ?? "TAP Calendar Notifications"}</h2><p>Only you and authorized delegates can see full details.</p></div></div><button type="button" className="secondary-button" onClick={() => void ensureChannel()}><ExternalLink /> {privateChannel ? "Verify in TAP" : "Create in TAP"}</button></header>
        <div className="channel-feed">
          {!privateChannel ? <ProductEmptyState icon={<MessageSquareText />} title="Create your personal TAP Calendar channel" description="Bookings, approvals, cancellations, and reminders will collect here." action={<button type="button" className="primary-button" onClick={() => void ensureChannel()}><Plus /> Create in TAP</button>} /> : null}
          {privateChannel && privateChannel.entries.length === 0 ? <div className="feed-empty-state"><CalendarCheck2 /><strong>No Calendar updates yet</strong><span>New bookings and meeting changes will appear here.</span></div> : null}
          {privateChannel?.entries.map(entry => {
            const pendingRequest = entry.bookingRequestId
              ? state.bookingRequests.find(request => request.id === entry.bookingRequestId)
              : undefined;
            const pending = pendingRequest ? isActivePendingRequest(pendingRequest) : false;
            return (
              <article key={entry.id} className={`channel-entry entry-${entry.kind}`}>
                <span className="entry-icon">{entry.kind === "approval" ? <Bell /> : entry.kind === "booking" ? <CalendarCheck2 /> : <AlertTriangle />}</span>
                <div><header><strong>{entry.title}</strong><time>{dateTimeFormatter.format(new Date(entry.createdAt))}</time></header><p>{entry.summary}</p>{pending && entry.bookingRequestId ? <div className="approval-actions"><button type="button" className="primary-button" disabled={resolvingRequestId !== null} onClick={() => void resolveRequest(entry.bookingRequestId!, "approve")}><Check /> {resolvingRequestId === entry.bookingRequestId ? "Resolving…" : "Approve"}</button><button type="button" className="secondary-button" disabled={resolvingRequestId !== null} onClick={() => void resolveRequest(entry.bookingRequestId!, "decline")}><X /> Decline</button><button type="button" className="text-button">Suggest another time</button></div> : null}</div>
              </article>
            );
          })}
        </div>
      </section>
      <aside className="notification-settings panel">
        <header><span className="eyebrow">Personal reminders</span><h2>Before a meeting</h2><p>Defaults apply unless an Event Type overrides them.</p></header>
        <label className="setting-row"><span><strong>System notification</strong><small>Default: 10 minutes before</small></span><span className="switch"><input type="checkbox" checked={state.notificationPreferences.system} onChange={event => void commit(current => updateNotificationPreferences(current, { system: event.currentTarget.checked }))} /><span /></span></label>
        <label className="field"><span>Reminder offsets</span><select value={state.notificationPreferences.reminderMinutes[0] ?? 10} onChange={event => void commit(current => updateNotificationPreferences(current, { reminderMinutes: [Number(event.currentTarget.value)] }))}><option value="5">5 minutes before</option><option value="10">10 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option></select></label>
        <div className="delivery-grid">
          {(["tap", "email", "sms", "whatsapp", "telegram"] as const).map(channel => (
            <label key={channel}><input type="checkbox" checked={state.notificationPreferences[channel]} onChange={event => void commit(current => updateNotificationPreferences(current, { [channel]: event.currentTarget.checked }))} /><span>{channel === "tap" ? "TAP channel" : channel.charAt(0).toUpperCase() + channel.slice(1)}</span>{channel === "sms" || channel === "whatsapp" ? <small>Consent required</small> : null}</label>
          ))}
        </div>
        <div className="quiet-hours"><MoonIcon /><div><strong>Quiet hours</strong><small>Urgent changes still appear in TAP</small></div><label className="field"><span>Start</span><input type="time" value={state.notificationPreferences.quietHoursStart} onChange={event => void commit(current => updateNotificationPreferences(current, { quietHoursStart: event.currentTarget.value }))} /></label><label className="field"><span>End</span><input type="time" value={state.notificationPreferences.quietHoursEnd} onChange={event => void commit(current => updateNotificationPreferences(current, { quietHoursEnd: event.currentTarget.value }))} /></label></div>
        <button type="button" className="secondary-button full-width" onClick={() => void testNotification()}><Bell /> Send test notification</button>
        <div className="shared-channels"><header><div><span className="eyebrow">Shared summaries</span><h3>Configured channels</h3></div><button type="button" className="icon-button" aria-label="Add shared channel" onClick={() => setChannelDialogOpen(true)}><Plus /></button></header>{sharedChannels.map(channel => <div key={channel.id}><span><Users /></span><p><strong>{channel.name}</strong><small>{channel.scope} · Permission-aware summaries</small></p><span className="switch"><input type="checkbox" checked={channel.enabled} onChange={event => void commit(current => ({ ...current, notificationChannels: current.notificationChannels.map(item => item.id === channel.id ? { ...item, enabled: event.currentTarget.checked } : item) }))} aria-label={`${channel.enabled ? "Disable" : "Enable"} ${channel.name}`} /><span /></span></div>)}{sharedChannels.length === 0 ? <div className="shared-channel-empty"><span><Users /></span><p><strong>No shared channels yet</strong><small>Add one for a team, calendar, or Event Type.</small></p></div> : null}</div>
      </aside>
    </div>
    {channelDialogOpen ? (
      <AddNotificationChannelDialog
        onClose={() => setChannelDialogOpen(false)}
        onSubmit={async input => {
          const changed = await commit(current => ({
            ...current,
            notificationChannels: [
              ...current.notificationChannels,
              {
                id: createEntityId("channel"),
                name: input.name,
                scope: input.scope,
                enabled: true,
                entries: [],
              },
            ],
          }), "Shared Calendar notification channel added.");
          if (changed) setChannelDialogOpen(false);
          return changed;
        }}
      />
    ) : null}
    </>
  );
}

function AddNotificationChannelDialog({
  onClose,
  onSubmit,
}: {
  readonly onClose: () => void;
  readonly onSubmit: (input: {
    name: string;
    scope: "team" | "calendar" | "event-type";
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"team" | "calendar" | "event-type">("team");
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal
      title="Add a Calendar notifications channel"
      description="Choose who the summaries are for. TAP checks each recipient’s permissions before posting details."
      onClose={onClose}
    >
      <form
        className="schedule-form"
        aria-busy={submitting}
        onSubmit={event => {
          event.preventDefault();
          setSubmitting(true);
          void onSubmit({ name: name.trim(), scope }).finally(() =>
            setSubmitting(false),
          );
        }}
      >
        <label className="field"><span>Channel name</span><input value={name} required maxLength={120} onChange={event => setName(event.currentTarget.value)} /></label>
        <label className="field"><span>Summary scope</span><select value={scope} onChange={event => setScope(event.currentTarget.value as typeof scope)}><option value="team">Selected team</option><option value="calendar">Selected calendar</option><option value="event-type">Selected Event Type</option></select></label>
        <div className="privacy-preview"><ShieldCheck /><div><strong>Permission-aware delivery</strong><p>Full details only reach authorized channel members.</p><small>Everyone else receives a redacted busy summary.</small></div></div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || !name.trim()}><MessageSquareText /> {submitting ? "Adding…" : "Add channel"}</button></div>
      </form>
    </Modal>
  );
}

function AutomationsScreen({ state }: { readonly state: CalendarState }) {
  return (
    <div className="content-stack">
      <section className="automation-hero panel"><div><span className="automation-icon"><Workflow /></span><div><span className="eyebrow">TAP Workflow Builder</span><h2>Build on calendar events and actions</h2><p>The package contributes pure, schema-bound nodes today. Durable event triggers will connect through the Zephyr Calendar gateway rather than pretending the mounted miniapp is a background service.</p></div></div><button type="button" className="primary-button" disabled title="The TAP SDK does not expose a workflow-builder navigation action."><ExternalLink /> Host opens Workflow Builder</button></section>
      <section><div className="section-heading"><div><span className="eyebrow">Node library</span><h2>Calendar workflow nodes</h2><p>Drag these into customer-owned TAP workflows.</p></div><span className="status-chip status-pending">Gateway bridge required for triggers</span></div><div className="node-grid">{state.workflowNodes.map(node => <article className="node-card panel" key={node.id}><span className={`node-kind ${node.kind}`}>{node.kind === "trigger" ? <Zap /> : <GitBranch />}</span><div><span>{node.kind}</span><h3>{node.name}</h3><p>{node.description}</p><code>{node.id}</code></div></article>)}</div></section>
      <section><div className="section-heading"><div><span className="eyebrow">Specialist surface</span><h2>MCP calendar tools</h2><p>Read-only and draft-only tools keep specialists useful without granting a direct customer API.</p></div><span className="status-chip status-confirmed"><ShieldCheck /> Human-governed</span></div><div className="tool-grid"><ToolCard name="list_events" description="Lists a bounded, permission-safe view of visible upcoming calendar items." output="Event summaries · no provider credentials" /><ToolCard name="summarize_day" description="Adds privacy-safe meeting and focused-work totals to daily summaries." output="Aggregate minutes · no event details" /><ToolCard name="find_available_slots" description="Computes candidate times from named availability and fresh Conflict Calendars." output="Ranked ISO time ranges" /><ToolCard name="draft_meeting" description="Prepares a meeting draft for a human to review in TAP Calendar." output="Draft only · never books" /></div></section>
      <section className="slash-command panel"><span className="command-mark">↗</span><div><span className="eyebrow">Channel scheduling</span><h2>Mini Apps → Schedule</h2><p>The channel app opens a dedicated scheduler with trusted TAP members when the host exposes its participant roster. Manual external guests remain available when the roster capability is unavailable.</p></div><span className="status-chip status-confirmed">Available</span></section>
    </div>
  );
}

function SettingsScreen({
  state,
  commit,
  gateway,
  meetingProviderConnections,
  onRefreshMeetingProviderConnections,
  onRequireManage,
  preview,
  announce,
  onAddAccount,
  onAddCalendar,
}: {
  readonly state: CalendarState;
  readonly commit: CommitCalendarState;
  readonly gateway: CalendarGatewayClient;
  readonly meetingProviderConnections: MeetingProviderConnectionsState;
  readonly onRefreshMeetingProviderConnections: RefreshMeetingProviderConnections;
  readonly onRequireManage: RequireCalendarManage;
  readonly preview: boolean;
  readonly announce: (message: string) => void;
  readonly onAddAccount: () => void;
  readonly onAddCalendar: (accountId: string) => void;
}) {
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [disconnectingAccountId, setDisconnectingAccountId] = useState<string | null>(null);
  const [zoomDialogOpen, setZoomDialogOpen] = useState(false);
  const editingAccount = state.accounts.find(account => account.id === editingAccountId) ?? null;
  const disconnectingAccount = state.accounts.find(account => account.id === disconnectingAccountId) ?? null;
  const zoomConnection = meetingProviderConnections.status === "ready"
    ? preferredZoomConnection(meetingProviderConnections.connections)
    : null;
  const zoomStatusLabel = meetingProviderConnections.status === "loading"
    ? "Checking"
    : meetingProviderConnections.status === "error"
      ? "Unavailable"
      : zoomConnection?.status === "connected"
        ? "Connected"
        : zoomConnection?.status === "attention"
          ? "Needs attention"
          : zoomConnection?.status === "pending"
            ? "Setup pending"
            : "Not connected";
  const zoomStatusClass = meetingProviderConnections.status === "error" || zoomConnection?.status === "attention"
    ? "status-declined"
    : zoomConnection?.status === "connected"
      ? "status-confirmed"
      : "status-pending";

  const saveAccountLabel = async (accountId: string, label: string): Promise<string | null> => {
    let domainError: string | null = null;
    const changed = await commit(current => {
      const result = renameCalendarAccount(current, accountId, label);
      if (!result.ok) domainError = result.error.message;
      return result.state;
    }, "Account display name updated.");
    return domainError ?? (changed ? null : "The account display name could not be saved.");
  };

  const disconnectAccount = async (
    accountId: string,
    replacementDestinationId: string | undefined,
  ): Promise<string | null> => {
    const previousState = state;
    let domainError: string | null = null;
    const changed = await commit(current => {
      const result = disconnectCalendarAccount(
        current,
        accountId,
        replacementDestinationId,
      );
      if (!result.ok) domainError = result.error.message;
      return result.state;
    });
    if (!changed) {
      return domainError ?? "The account could not be removed.";
    }
    try {
      await gateway.deleteConnection(accountId);
    } catch (cause: unknown) {
      if (!(cause instanceof CalendarGatewayError) || cause.code !== "connection_not_found") {
        const gatewayMessage = cause instanceof Error
          ? cause.message
          : "The Calendar gateway could not remove this connection.";
        const rolledBack = await commit(() => previousState);
        if (rolledBack) {
          announce("Account removal was rolled back because the Calendar gateway was unavailable.");
        }
        return rolledBack
          ? `${gatewayMessage} TAP Calendar restored the account projection.`
          : `${gatewayMessage} TAP Calendar could not restore the projection; reload before making more changes.`;
      }
    }
    announce("Account removed from TAP Calendar.");
    return null;
  };

  return (
    <>
      <div className="settings-layout">
        <section className="connections-panel panel">
          <header>
            <div><span className="eyebrow">Provider connections</span><h2>Accounts & calendars</h2><p>Visibility, conflicts, and destination are intentionally independent.</p></div>
            <button type="button" className="primary-button" onClick={onAddAccount}><Plus /> Add account</button>
          </header>
          {state.accounts.length === 0 ? (
            <ProductEmptyState
              icon={<Cloud />}
              title="No calendar accounts connected"
              description="Add an account you own or one shared with you, then choose exactly how each calendar participates."
              action={<button type="button" className="primary-button" onClick={onAddAccount}><Plus /> Add calendar account</button>}
            />
          ) : null}
          {state.accounts.map(account => (
            <CalendarAccountGroup
              account={account}
              commit={commit}
              key={account.id}
              onAddCalendar={() => onAddCalendar(account.id)}
              onDisconnect={() => setDisconnectingAccountId(account.id)}
              onEdit={() => setEditingAccountId(account.id)}
            />
          ))}
          <div className="meeting-provider-settings" aria-labelledby="meeting-provider-settings-title">
            <header>
              <div>
                <span className="eyebrow">Conferencing</span>
                <h3 id="meeting-provider-settings-title">Meeting providers</h3>
                <p>Choose which service creates the join link when TAP Calendar books a meeting.</p>
              </div>
            </header>
            {meetingProviderConnections.status === "error" ? (
              <Alert variant="destructive" role="alert">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Zoom status unavailable</AlertTitle>
                <AlertDescription>{meetingProviderConnections.message}</AlertDescription>
              </Alert>
            ) : null}
            <div className="meeting-provider-row">
              <span className="provider-icon provider-google"><Video /></span>
              <span className="meeting-provider-copy">
                <strong>Google Meet</strong>
                <small>Included automatically with your Google Destination Calendar.</small>
              </span>
              <span className="status-chip status-confirmed"><CheckCircle2 /> Available</span>
            </div>
            <div className="meeting-provider-row">
              <span className="provider-icon provider-zoom"><Video /></span>
              <span className="meeting-provider-copy">
                <strong>Zoom</strong>
                <small>{zoomConnection?.status === "connected" ? zoomConnection.label : "Connect your Zoom account to create real Zoom meeting links."}</small>
              </span>
              <span className={`status-chip ${zoomStatusClass}`}>{zoomConnection?.status === "connected" ? <CheckCircle2 /> : zoomConnection?.status === "attention" || meetingProviderConnections.status === "error" ? <AlertTriangle /> : null}{zoomStatusLabel}</span>
              <Button type="button" variant="outline" size="sm" disabled={meetingProviderConnections.status === "loading"} onClick={() => setZoomDialogOpen(true)}>
                {zoomConnection?.status === "connected" ? "Manage" : zoomConnection ? "Continue" : meetingProviderConnections.status === "error" ? "Review" : "Connect Zoom"}
              </Button>
            </div>
          </div>
        </section>
        <aside className="settings-aside"><section className="panel"><span className="eyebrow">Default behavior</span><h2>Scheduling</h2><label className="field"><span>Destination calendar</span><select value={allCalendars(state).find(calendar => calendar.destination)?.id ?? ""} disabled={!allCalendars(state).some(calendar => calendar.writable)} onChange={event => void commit(current => updateCalendar(current, event.currentTarget.value, { destination: true }), "Destination Calendar updated.")}><option value="" disabled>No writable calendar</option>{allCalendars(state).filter(calendar => calendar.writable).map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label><div className="field"><span>Viewer time zone</span><div className="viewer-time-zone"><Globe2 /><span><strong>Automatic</strong><small>{detectedTimeZone()}</small></span></div><small>Calendar views follow this device. Availability schedules have their own configurable time zone.</small></div><label className="setting-row"><span><strong>Offline read-only</strong><small>Keep the last safe calendar view available</small></span><span className="switch"><input type="checkbox" defaultChecked /><span /></span></label></section><section className="panel privacy-card"><ShieldCheck /><div><span className="eyebrow">Privacy boundary</span><h3>Busy by default</h3><p>Shared calendars and team views expose free/busy unless every viewer can read event details. Work Blocks never copy private task or message content to a provider.</p></div></section>{preview ? <section className="panel danger-card"><span className="eyebrow">Local preview</span><h3>Clear local Calendar data</h3><p>Remove locally configured accounts, events, availability, booking pages, and channels.</p><button type="button" className="secondary-button" onClick={() => { resetPreviewCalendar(gateway.principalId); announce("Local Calendar data cleared."); globalThis.location.reload(); }}><RefreshCw /> Clear local data</button></section> : null}</aside>
      </div>
      {editingAccount ? (
        <EditCalendarAccountDialog
          account={editingAccount}
          onClose={() => setEditingAccountId(null)}
          onSubmit={label => saveAccountLabel(editingAccount.id, label)}
        />
      ) : null}
      {disconnectingAccount ? (
        <DisconnectCalendarAccountDialog
          account={disconnectingAccount}
          state={state}
          onClose={() => setDisconnectingAccountId(null)}
          onSubmit={replacementId => disconnectAccount(disconnectingAccount.id, replacementId)}
        />
      ) : null}
      {zoomDialogOpen ? (
        <ZoomConnectionDialog
          gateway={gateway}
          connectionsState={meetingProviderConnections}
          onRefresh={onRefreshMeetingProviderConnections}
          onRequireManage={onRequireManage}
          onClose={() => setZoomDialogOpen(false)}
          announce={announce}
        />
      ) : null}
    </>
  );
}

const preferredZoomConnection = (
  connections: readonly CalendarGatewayMeetingProviderConnection[],
): CalendarGatewayMeetingProviderConnection | null =>
  connections.find(connection => connection.provider === "zoom" && connection.status === "connected") ??
  connections.find(connection => connection.provider === "zoom" && connection.status === "attention") ??
  connections.find(connection => connection.provider === "zoom" && connection.status === "pending") ??
  null;

const isMissingMeetingProviderConnection = (cause: unknown): boolean =>
  cause instanceof CalendarGatewayError &&
  (cause.code === "meeting_provider_connection_not_found" || cause.code === "connection_not_found");

function ZoomConnectionDialog({
  gateway,
  connectionsState,
  onRefresh,
  onRequireManage,
  onClose,
  announce,
}: {
  readonly gateway: CalendarGatewayClient;
  readonly connectionsState: MeetingProviderConnectionsState;
  readonly onRefresh: RefreshMeetingProviderConnections;
  readonly onRequireManage: RequireCalendarManage;
  readonly onClose: () => void;
  readonly announce: (message: string) => void;
}) {
  const connection = connectionsState.status === "ready"
    ? preferredZoomConnection(connectionsState.connections)
    : null;
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pendingConnectionId, setPendingConnectionId] = useState<string | null>(connection?.id ?? null);
  const [busy, setBusy] = useState<"start" | "open" | "check" | "disconnect" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const beginConnection = async (): Promise<void> => {
    if (busy !== null || connection?.status === "connected") return;
    setBusy("start");
    setError(null);
    setNotice(null);
    try {
      await onRequireManage();
      const result = await gateway.startOAuth({
        id: `zoom-${globalThis.crypto.randomUUID()}`,
        provider: "zoom",
        label: "Zoom",
      });
      setPendingConnectionId(result.connectionId);
      setAuthorizationUrl(result.authorizationUrl);
      setNotice("Zoom is ready to authorize. Open Zoom, approve access, then return here.");
      void onRefresh().catch(() => {
        // The authorization link remains usable; the status can be checked after returning.
      });
    } catch (cause: unknown) {
      setError(providerConnectionErrorMessage(cause, "Zoom", "connect"));
    } finally {
      setBusy(null);
    }
  };

  const launchAuthorization = async (): Promise<void> => {
    if (!authorizationUrl || busy !== null) return;
    setBusy("open");
    setError(null);
    const message = await openZoomAuthorization(
      sdk.navigation as ProviderExternalNavigationApi,
      authorizationUrl,
    );
    if (message) setError(message);
    else setNotice("Zoom opened in your browser. Approve access there, then return and check the connection.");
    setBusy(null);
  };

  const checkConnection = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("check");
    setError(null);
    setNotice(null);
    try {
      await onRequireManage();
      const connectionId = pendingConnectionId ?? connection?.id;
      if (connectionId) {
        await gateway.verifyMeetingProviderConnection(connectionId);
      }
      const connections = await onRefresh();
      const refreshed = preferredZoomConnection(connections);
      if (refreshed?.status === "connected") {
        setAuthorizationUrl(null);
        setPendingConnectionId(refreshed.id);
        setNotice(`${refreshed.label} is connected and ready for new meetings.`);
        announce("Zoom connected.");
      } else if (refreshed?.status === "attention") {
        setError("Zoom needs to be connected again before TAP Calendar can create meeting links.");
      } else {
        setNotice("Zoom is still waiting for authorization. Finish approving access in your browser, then check again.");
      }
    } catch {
      setError("TAP Calendar couldn't check your Zoom connection. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const refreshStatus = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("refresh");
    setError(null);
    try {
      await onRefresh();
    } catch {
      setError("TAP Calendar couldn't check your Zoom connection. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (!connection || busy !== null) return;
    setBusy("disconnect");
    setError(null);
    try {
      await onRequireManage();
      try {
        await gateway.deleteMeetingProviderConnection(connection.id);
      } catch (cause: unknown) {
        if (!isMissingMeetingProviderConnection(cause)) {
          throw cause;
        }
      }
      await onRefresh();
      announce("Zoom disconnected.");
      onClose();
    } catch {
      setError("TAP Calendar couldn't disconnect Zoom. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const authorizationPending = authorizationUrl !== null;
  const connected = connection?.status === "connected";
  return (
    <Modal title={connected ? "Manage Zoom" : "Connect Zoom"} description="Authorize your Zoom account so TAP Calendar can create real Zoom meeting links." onClose={onClose}>
      <div className="zoom-connection-dialog" aria-busy={busy !== null}>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Zoom couldn’t connect</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="info" role="status">
            <ExternalLink aria-hidden="true" />
            <AlertTitle>{connected ? "Zoom connected" : "Finish connecting Zoom"}</AlertTitle>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {connected ? (
          <div className="meeting-provider-dialog-summary">
            <span className="provider-icon provider-zoom"><Video /></span>
            <span><strong>{connection.label}</strong><small>Zoom · connected</small></span>
            <span className="status-chip status-confirmed"><CheckCircle2 /> Ready</span>
          </div>
        ) : authorizationPending ? (
          <div className="meeting-provider-dialog-summary">
            <span className="provider-icon provider-zoom"><ExternalLink /></span>
            <span><strong>Authorization waiting</strong><small>Connection {pendingConnectionId ?? "pending"}</small></span>
            <span className="status-chip status-pending">Pending</span>
          </div>
        ) : connection ? (
          <Alert variant="warning" role="status">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{connection.status === "attention" ? "Zoom needs attention" : "Zoom setup is unfinished"}</AlertTitle>
            <AlertDescription>{connection.status === "pending" ? "If you already approved access in Zoom, check the connection. Otherwise restart to get a fresh authorization link." : "Reconnect Zoom before TAP Calendar creates another meeting link."}</AlertDescription>
          </Alert>
        ) : connectionsState.status === "loading" ? (
          <p className="provider-connection-status" role="status">Checking your Zoom connection…</p>
        ) : connectionsState.status === "error" ? (
          <Alert variant="warning" role="status">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Connection status unavailable</AlertTitle>
            <AlertDescription>Check the Calendar service before starting a Zoom connection.</AlertDescription>
          </Alert>
        ) : (
          <div className="meeting-provider-dialog-summary">
            <span className="provider-icon provider-zoom"><Video /></span>
            <span><strong>Zoom isn’t connected</strong><small>Google Meet remains available without separate setup.</small></span>
          </div>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy !== null}>Close</Button>
          {connected ? (
            <Button type="button" variant="outline" onClick={() => void disconnect()} disabled={busy !== null}><Unplug data-icon="inline-start" />{busy === "disconnect" ? "Disconnecting…" : "Disconnect Zoom"}</Button>
          ) : authorizationPending ? (
            <>
              <Button type="button" variant="outline" onClick={() => void launchAuthorization()} disabled={busy !== null}><ExternalLink data-icon="inline-start" />{busy === "open" ? "Opening…" : "Open Zoom"}</Button>
              <Button type="button" onClick={() => void checkConnection()} disabled={busy !== null}><RefreshCw data-icon="inline-start" className={busy === "check" ? "is-spinning" : undefined} />Check connection</Button>
            </>
          ) : connection?.status === "pending" ? (
            <>
              <Button type="button" variant="outline" onClick={() => void checkConnection()} disabled={busy !== null}><RefreshCw data-icon="inline-start" className={busy === "check" ? "is-spinning" : undefined} />Check connection</Button>
              <Button type="button" onClick={() => void beginConnection()} disabled={busy !== null}><ExternalLink data-icon="inline-start" />Restart connection</Button>
            </>
          ) : connectionsState.status === "error" ? (
            <Button type="button" onClick={() => void refreshStatus()} disabled={busy !== null}><RefreshCw data-icon="inline-start" className={busy === "refresh" ? "is-spinning" : undefined} />Try again</Button>
          ) : (
            <Button type="button" onClick={() => void beginConnection()} disabled={busy !== null || connectionsState.status === "loading"}><ExternalLink data-icon="inline-start" />{connection ? "Restart connection" : "Connect Zoom"}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CalendarAccountGroup({
  account,
  commit,
  onAddCalendar,
  onEdit,
  onDisconnect,
}: {
  readonly account: CalendarAccount;
  readonly commit: CommitCalendarState;
  readonly onAddCalendar: () => void;
  readonly onEdit: () => void;
  readonly onDisconnect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `account-actions-${account.id}`;
  const allVisible = account.calendars.every(calendar => calendar.visible);
  const noneVisible = account.calendars.every(calendar => !calendar.visible);
  const conflictCalendars = account.calendars.filter(calendar => calendar.freshness !== "stale");
  const allConflicts =
    conflictCalendars.length > 0 && conflictCalendars.every(calendar => calendar.conflicts);
  const noConflicts = conflictCalendars.every(calendar => !calendar.conflicts);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    globalThis.document.addEventListener("pointerdown", onPointerDown);
    return () => globalThis.document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const closeAndRun = (action: () => void) => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    action();
  };
  const updateAll = (
    update: Partial<Pick<ConnectedCalendar, "visible" | "conflicts">>,
    message: string,
  ) => {
    closeAndRun(() => {
      void commit(
        current => updateCalendarAccountCalendars(current, account.id, update),
        message,
      );
    });
  };
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    const activeIndex = items.indexOf(globalThis.document.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => items.at(index)?.focus();
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(activeIndex >= items.length - 1 ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(-1);
    } else if (event.key === "Tab") {
      setMenuOpen(false);
    }
  };

  return (
    <div className="connection-group">
      <header>
        <span className={`provider-icon provider-${account.provider}`}><Cloud /></span>
        <div><strong>{account.label}</strong><small>{providerNames[account.provider]} · {account.status}</small></div>
        <span className={`health-badge health-${account.status}`}><span /> {account.status}</span>
        <button
          ref={triggerRef}
          type="button"
          className="icon-button"
          aria-controls={menuId}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={`Account actions for ${account.label}`}
          onClick={() => setMenuOpen(open => !open)}
        ><MoreHorizontal /></button>
      </header>
      {menuOpen ? (
        <div
          ref={menuRef}
          className="account-actions-menu"
          id={menuId}
          role="menu"
          aria-label={`Actions for ${account.label}`}
          onKeyDown={onMenuKeyDown}
        >
          <button type="button" role="menuitem" onClick={() => closeAndRun(onAddCalendar)}><Plus /><span>Add calendars…</span></button>
          <button type="button" role="menuitem" onClick={() => closeAndRun(onEdit)}><Settings2 /><span>Edit display name…</span></button>
          <span className="account-menu-separator" role="separator" />
          <button type="button" role="menuitem" disabled={allVisible} onClick={() => updateAll({ visible: true }, `All ${account.label} calendars are visible.`)}><Eye /><span>Show all calendars</span></button>
          <button type="button" role="menuitem" disabled={noneVisible} onClick={() => updateAll({ visible: false }, `All ${account.label} calendars are hidden.`)}><EyeOff /><span>Hide all calendars</span></button>
          <button type="button" role="menuitem" disabled={allConflicts || conflictCalendars.length === 0} onClick={() => updateAll({ conflicts: true }, `${account.label} calendars now participate in conflict checks.`)}><ShieldCheck /><span>Include eligible conflict calendars</span></button>
          <button type="button" role="menuitem" disabled={noConflicts} onClick={() => updateAll({ conflicts: false }, `${account.label} calendars no longer participate in conflict checks.`)}><ShieldOff /><span>Exclude all conflict calendars</span></button>
          <span className="account-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="danger-menu-item" onClick={() => closeAndRun(onDisconnect)}><Unplug /><span>Remove from TAP Calendar…</span></button>
        </div>
      ) : null}
      <div className="connection-table">
        <div className="connection-head"><span>Calendar</span><span>Show</span><span>Conflicts</span><span>Destination</span></div>
        {account.calendars.map(calendar => <CalendarControlRow key={calendar.id} calendar={calendar} commit={commit} />)}
      </div>
    </div>
  );
}

function EditCalendarAccountDialog({
  account,
  onClose,
  onSubmit,
}: {
  readonly account: CalendarAccount;
  readonly onClose: () => void;
  readonly onSubmit: (label: string) => Promise<string | null>;
}) {
  const [label, setLabel] = useState(account.label);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const trimmedLabel = label.trim();
  return (
    <Modal title="Edit account display name" description="Change how this provider account is labeled inside TAP Calendar." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => {
        event.preventDefault();
        if (submitting || !trimmedLabel || trimmedLabel === account.label) return;
        setSubmitting(true);
        setError(null);
        void onSubmit(trimmedLabel).then(message => {
          if (message) setError(message);
          else onClose();
        }).finally(() => setSubmitting(false));
      }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <div className="account-dialog-summary"><span className={`provider-icon provider-${account.provider}`}><Cloud /></span><div><strong>{providerNames[account.provider]}</strong><small>{account.status} · {account.calendars.length} {account.calendars.length === 1 ? "calendar" : "calendars"}</small></div></div>
        <label className="field"><span>Display name</span><input name="account-display-name" autoComplete="off" value={label} required onChange={event => setLabel(event.currentTarget.value)} /><small>This changes only the label shown in TAP Calendar.</small></label>
        <div className="privacy-preview"><ShieldCheck /><div><strong>Provider identity stays unchanged</strong><p>Authorization status, access roles, and freshness come from the Calendar gateway.</p><small>Renaming this account never changes its provider-side email or credentials.</small></div></div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="primary-button" disabled={submitting || !trimmedLabel || trimmedLabel === account.label}><Settings2 /> {submitting ? "Saving…" : "Save display name"}</button></div>
      </form>
    </Modal>
  );
}

function DisconnectCalendarAccountDialog({
  account,
  state,
  onClose,
  onSubmit,
}: {
  readonly account: CalendarAccount;
  readonly state: CalendarState;
  readonly onClose: () => void;
  readonly onSubmit: (replacementDestinationId: string | undefined) => Promise<string | null>;
}) {
  const removesDestination = account.calendars.some(calendar => calendar.destination);
  const replacementCalendars = allCalendars(state).filter(
    calendar => calendar.accountId !== account.id && calendar.writable,
  );
  const [replacementId, setReplacementId] = useState(
    replacementCalendars.find(calendar => calendar.destination)?.id ??
      replacementCalendars.find(calendar => calendar.freshness === "live")?.id ??
      replacementCalendars[0]?.id ??
      "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canDisconnect = !removesDestination || replacementCalendars.length === 0 || replacementId.length > 0;
  const removedCalendarIds = new Set(account.calendars.map(calendar => calendar.id));
  const projectedEvents = state.events.filter(event => removedCalendarIds.has(event.calendarId)).length;
  return (
    <Modal title={`Remove ${account.label}?`} description="Disconnect this account’s projection from TAP Calendar without deleting anything at the provider." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => {
        event.preventDefault();
        if (submitting || !canDisconnect) return;
        setSubmitting(true);
        setError(null);
        void onSubmit(removesDestination ? replacementId : undefined).then(message => {
          if (message) setError(message);
          else onClose();
        }).finally(() => setSubmitting(false));
      }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <div className="disconnect-summary"><Unplug /><div><strong>{account.calendars.length} {account.calendars.length === 1 ? "calendar" : "calendars"} will be removed from this surface</strong><p>{projectedEvents} cached {projectedEvents === 1 ? "event" : "events"} will disappear from TAP Calendar. Provider events are untouched.</p></div></div>
        {removesDestination ? (
          replacementCalendars.length > 0 ? (
            <label className="field"><span>New Destination Calendar</span><select value={replacementId} onChange={event => setReplacementId(event.currentTarget.value)}>{replacementCalendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select><small>Event Types using this account will move to the selected writable calendar.</small></label>
          ) : (
            <div className="dialog-warning" role="status"><AlertTriangle /><span>This removes the last writable calendar. Scheduling will stay unavailable, and affected Event Types will pause until you add another Destination Calendar.</span></div>
          )
        ) : null}
        <div className="privacy-preview"><ShieldCheck /><div><strong>Provider authorization is not revoked</strong><p>This removes only TAP Calendar’s saved projection and cached items.</p><small>Revoking OAuth, app passwords, or server credentials remains a Calendar gateway/provider action.</small></div></div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="danger-button" disabled={submitting || !canDisconnect}><Unplug /> {submitting ? "Removing…" : "Remove account"}</button></div>
      </form>
    </Modal>
  );
}

function RemoveCalendarDialog({
  calendar,
  state,
  onClose,
  onSubmit,
}: {
  readonly calendar: ConnectedCalendar;
  readonly state: CalendarState;
  readonly onClose: () => void;
  readonly onSubmit: (replacementDestinationId: string | undefined) => Promise<string | null>;
}) {
  const account = state.accounts.find(candidate => candidate.id === calendar.accountId);
  const replacementCalendars = allCalendars(state).filter(
    candidate => candidate.id !== calendar.id && candidate.writable,
  );
  const [replacementId, setReplacementId] = useState(
    replacementCalendars.find(candidate => candidate.destination)?.id ??
      replacementCalendars.find(candidate => candidate.freshness === "live")?.id ??
      replacementCalendars[0]?.id ??
      "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const canRemove = !calendar.destination || replacementCalendars.length === 0 || replacementId.length > 0;
  const cachedEvents = state.events.filter(event => event.calendarId === calendar.id).length;

  return (
    <Modal
      title={`Remove ${calendar.name}?`}
      description="Remove this calendar from the TAP Calendar view without changing it at the provider."
      onClose={onClose}
    >
      <form className="schedule-form" onSubmit={event => {
        event.preventDefault();
        if (submitting || !canRemove) return;
        setSubmitting(true);
        setError(null);
        void onSubmit(calendar.destination ? replacementId || undefined : undefined)
          .then(message => {
            if (message) setError(message);
            else onClose();
          })
          .finally(() => setSubmitting(false));
      }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <div className="disconnect-summary"><Unplug /><div><strong>This calendar will leave the sidebar and stop syncing into this view</strong><p>{cachedEvents} cached {cachedEvents === 1 ? "event" : "events"} will be removed from TAP Calendar. Hiding only suppresses display; removal also suppresses future provider discovery for this connection.</p></div></div>
        {calendar.destination ? (
          replacementCalendars.length > 0 ? (
            <label className="field"><span>New Destination Calendar</span><select value={replacementId} onChange={event => setReplacementId(event.currentTarget.value)}>{replacementCalendars.map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select><small>Event Types using this calendar will move to the selected writable calendar.</small></label>
          ) : (
            <div className="dialog-warning" role="status"><AlertTriangle /><span>This removes the last writable calendar. Scheduling will stay unavailable, and affected Event Types will pause until you add another Destination Calendar.</span></div>
          )
        ) : null}
        <div className="privacy-preview"><ShieldCheck /><div><strong>Nothing is deleted from {account ? providerNames[account.provider] : "the provider"}</strong><p>TAP Calendar stores an exclusion so a provider refresh does not add this calendar back.</p><small>You can reconnect or re-import the provider account later if you want to restore it.</small></div></div>
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="danger-button" data-modal-initial-focus disabled={submitting || !canRemove}><Unplug /> {submitting ? "Removing…" : "Remove calendar"}</button></div>
      </form>
    </Modal>
  );
}

function CalendarControlRow({ calendar, commit }: { readonly calendar: ConnectedCalendar; readonly commit: CommitCalendarState }) {
  return (
    <div className="connection-row">
      <span className="connection-name"><span style={{ background: calendar.color }} /><span><strong>{calendar.name}</strong><small>{calendar.role} · {calendar.freshness}</small></span></span>
      <label className="switch"><input type="checkbox" checked={calendar.visible} onChange={event => {
        const visible = event.currentTarget.checked;
        void commit(current => updateCalendar(current, calendar.id, { visible }));
      }} aria-label={`Show ${calendar.name}`} /><span /></label>
      <label className="switch"><input type="checkbox" checked={calendar.conflicts} disabled={calendar.freshness === "stale"} onChange={event => {
        const conflicts = event.currentTarget.checked;
        void commit(current => updateCalendar(current, calendar.id, { conflicts }));
      }} aria-label={`Use ${calendar.name} for conflicts`} /><span /></label>
      <label className="radio-control"><input type="radio" name="destination-calendar" checked={calendar.destination} disabled={!calendar.writable} onChange={() => void commit(current => updateCalendar(current, calendar.id, { destination: true }))} aria-label={`Use ${calendar.name} as destination`} /><span /></label>
    </div>
  );
}

interface AttendeeDraft {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly required: boolean;
}

type SubmitScheduledMeeting = (
  input: Parameters<typeof scheduleMeeting>[1],
) => Promise<ProviderBackedSubmissionResult>;

interface ScheduledMeetingSummary {
  readonly title: string;
  readonly approvalRequired: boolean;
}

function participantInitials(displayName: string): string {
  return displayName
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");
}

function ChannelSchedulerSurface({
  state,
  principalAccess,
  zoomConnected,
  channelId,
  roster,
  error,
  notice,
  onDismissError,
  onSubmit,
}: {
  readonly state: CalendarState;
  readonly principalAccess: ProviderPrincipalAccessState;
  readonly zoomConnected: boolean;
  readonly channelId: string | undefined;
  readonly roster: ChannelParticipantRoster;
  readonly error: string | null;
  readonly notice: string | null;
  readonly onDismissError: () => void;
  readonly onSubmit: SubmitScheduledMeeting;
}) {
  const [completed, setCompleted] = useState<ScheduledMeetingSummary | null>(null);
  return (
    <div className="channel-scheduler-surface">
      <a className="skip-link" href="#channel-scheduler-main">Skip to scheduling</a>
      <div className="live-region" aria-live="polite" aria-atomic="true">{notice}</div>
      <header className="channel-scheduler-header">
        <span className="calendar-logo"><CalendarClock /></span>
        <div>
          <span className="eyebrow">TAP Calendar</span>
          <h1>Schedule a meeting</h1>
          <p>Choose people from this channel or invite an external guest.</p>
        </div>
      </header>
      <main className="channel-scheduler-main" id="channel-scheduler-main">
        {error ? (
          <div className="dialog-warning" role="alert">
            <AlertTriangle />
            <span>{error}</span>
            <button type="button" className="icon-button" onClick={onDismissError} aria-label="Dismiss error"><X /></button>
          </div>
        ) : null}
        {!channelId ? (
          <ProductEmptyState
            icon={<Users />}
            title="Open Schedule from a TAP channel"
            description="This scheduling surface needs an exact TAP channel before it can load participants or create a meeting."
          />
        ) : completed ? (
          <ProductEmptyState
            icon={<CheckCircle2 />}
            title={completed.approvalRequired ? "Meeting request sent" : "Meeting scheduled"}
            description={`${completed.title} was committed through your connected Destination Calendar.`}
            action={<button type="button" className="primary-button" onClick={() => setCompleted(null)}><Plus /> Schedule another</button>}
          />
        ) : (
          <section className="channel-scheduler-card panel" aria-label="Meeting details">
            <ScheduleMeetingEditor
              state={state}
              principalAccess={principalAccess}
              zoomConnected={zoomConnected}
              mode="channel"
              roster={roster}
              onSubmit={onSubmit}
              onSuccess={setCompleted}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function ScheduleMeetingEditor({
  state,
  principalAccess,
  zoomConnected,
  mode,
  initialStart = "",
  roster = { status: "unavailable", participants: [] },
  onCancel,
  onSubmit,
  onSuccess,
}: {
  readonly state: CalendarState;
  readonly principalAccess: ProviderPrincipalAccessState;
  readonly zoomConnected: boolean;
  readonly mode: "workspace" | "channel";
  readonly initialStart?: string;
  readonly roster?: ChannelParticipantRoster;
  readonly onCancel?: () => void;
  readonly onSubmit: SubmitScheduledMeeting;
  readonly onSuccess?: (summary: ScheduledMeetingSummary) => void;
}) {
  const createEntityId = useEntityId();
  const bookingAttemptRef = useRef<{
    readonly canonical: string;
    readonly key: string;
    readonly requestedAt: string;
  } | null>(null);
  const [title, setTitle] = useState("");
  const [attendeeDrafts, setAttendeeDrafts] = useState<readonly AttendeeDraft[]>([]);
  const [selectedParticipantIds, setSelectedParticipantIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [location, setLocation] = useState<MeetingLocation | null>(mode === "channel" ? "google-meet" : null);
  const [slot, setSlot] = useState(initialStart);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const manualAttendees: readonly CalendarAttendee[] = attendeeDrafts
    .filter(attendee => attendee.name.trim() && attendee.email.trim())
    .map(attendee => ({
      id: attendee.key,
      name: attendee.name.trim(),
      email: attendee.email.trim().toLowerCase(),
      kind: "external",
      required: attendee.required,
    }));
  const channelAttendees: readonly CalendarAttendee[] = roster.status === "ready"
    ? roster.participants
        .filter(participant =>
          participant.email && selectedParticipantIds.has(participant.id)
        )
        .map(participant => ({
          id: participant.id,
          name: participant.displayName,
          email: participant.email!,
          kind: "tap" as const,
          required: true,
        }))
    : [];
  const attendeesByEmail = new Map<string, CalendarAttendee>();
  for (const attendee of [...channelAttendees, ...manualAttendees]) {
    if (!attendeesByEmail.has(attendee.email)) {
      attendeesByEmail.set(attendee.email, attendee);
    }
  }
  const attendees = [...attendeesByEmail.values()];
  const compatibility = location ? validateGuestCompatibility(location, attendees) : null;
  const personalEvent = mode === "workspace" && attendees.length === 0 && attendeeDrafts.length === 0;
  const destination = principalWritableDestination(state, principalAccess);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (mode === "channel" && attendees.length === 0) {
      setError("Select at least one attendee.");
      return;
    }
    if (!destination || !slot || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    const start = new Date(slot);
    if (!Number.isFinite(start.getTime())) {
      setError("Choose a valid start time.");
      setSubmitting(false);
      return;
    }
    const draft = {
      title: title.trim(),
      calendarId: destination.id,
      start: start.toISOString(),
      end: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
      location,
      attendees,
      approvalRequired: !personalEvent && approvalRequired,
    };
    const canonical = JSON.stringify(draft);
    const attempt = bookingAttemptRef.current?.canonical === canonical
      ? bookingAttemptRef.current
      : {
          canonical,
          key: createEntityId("meeting"),
          requestedAt: new Date().toISOString(),
        };
    bookingAttemptRef.current = attempt;
    try {
      const result = await onSubmit({
        id: attempt.key,
        ...draft,
        requestedAt: attempt.requestedAt,
      });
      if (result.error && !result.retrySameAttempt) bookingAttemptRef.current = null;
      setError(result.error);
      if (!result.error) {
        bookingAttemptRef.current = null;
        onSuccess?.({ title: draft.title, approvalRequired: draft.approvalRequired });
      }
    } finally {
      setSubmitting(false);
    }
  };
  if (!destination) {
    const checking = principalAccess.status === "loading";
    const accessError = principalAccess.status === "error"
      ? principalAccess.message
      : null;
    return (
      <ProductEmptyState
        icon={<CalendarClock />}
        title={checking
          ? "Checking your Calendar access"
          : accessError
            ? "Your Calendar connections are unavailable"
            : "Authorize a writable Google Calendar"}
        description={checking
          ? "TAP is verifying which Destination Calendars belong to your user."
          : accessError ??
            "Authorize Google and make an owner or writer calendar the Destination Calendar before scheduling."}
        action={onCancel ? <Button type="button" onClick={onCancel}>Return to Calendar</Button> : undefined}
      />
    );
  }
  return (
    <form className="schedule-form" onSubmit={submit}>
        <div className="dialog-context"><span><CalendarClock /></span><div><strong>{destination.name}</strong><small>Google Destination Calendar</small></div><span className="status-chip status-confirmed">Ready</span></div>
        {error || compatibility ? <div className="dialog-warning" role={error ? "alert" : "status"}><AlertTriangle /><span>{error ?? compatibility}</span></div> : null}
        <FieldGroup className="calendar-form-fields">
          <Field>
            <FieldLabel htmlFor="meeting-title">{mode === "workspace" ? "Event title" : "Meeting title"}</FieldLabel>
            <Input
              id="meeting-title"
              name="meeting-title"
              data-modal-initial-focus={mode === "workspace" ? true : undefined}
              autoComplete="off"
              value={title}
              required
              onChange={event => setTitle(event.currentTarget.value)}
            />
          </Field>
        </FieldGroup>
        {mode === "channel" ? (
          <fieldset className="participant-picker">
            <legend>Channel participants</legend>
            <p className="participant-picker-note">Select only the people who should join. Nobody is selected automatically.</p>
            {roster.status === "loading" ? <div className="participant-roster-state" role="status"><RefreshCw className="is-spinning" /><span><strong>Loading channel members</strong><small>Nobody is selected automatically.</small></span></div> : null}
            {roster.status === "unavailable" ? <div className="participant-roster-state"><Users /><span><strong>Channel roster unavailable</strong><small>TAP does not expose this channel's member roster to this miniapp yet. Add invitees by name and email; nobody is selected automatically.</small></span></div> : null}
            {roster.status === "error" ? <div className="participant-roster-state" role="alert"><AlertTriangle /><span><strong>Channel roster could not be loaded</strong><small>{roster.message} Add invitees manually below.</small></span></div> : null}
            {roster.status === "ready" && roster.participants.length === 0 ? <div className="participant-roster-state"><Users /><span><strong>No other human members found</strong><small>Add an external guest below.</small></span></div> : null}
            {roster.status === "ready" ? roster.participants.map(participant => {
              const selectable = participant.email !== null;
              return (
                <label key={participant.id} className={selectable ? undefined : "participant-unavailable"}>
                  <input
                    type="checkbox"
                    checked={selectedParticipantIds.has(participant.id)}
                    disabled={!selectable}
                    aria-label={`Invite ${participant.displayName}`}
                    onChange={event => {
                      const checked = event.currentTarget.checked;
                      setSelectedParticipantIds(current => {
                        const next = new Set(current);
                        if (checked) next.add(participant.id);
                        else next.delete(participant.id);
                        return next;
                      });
                    }}
                  />
                  <span className="participant-avatar" aria-hidden="true">{participantInitials(participant.displayName)}</span>
                  <span><strong>{participant.displayName}</strong><small>{participant.email ?? "No calendar invite email available"}</small></span>
                  <b>{selectable ? "TAP member" : "Unavailable"}</b>
                </label>
              );
            }) : null}
          </fieldset>
        ) : null}
        {attendeeDrafts.length > 0 ? (
          <fieldset className="attendee-editor">
            <legend>{mode === "channel" ? "External guests" : "Guests (optional)"}</legend>
            {attendeeDrafts.map((attendee, index) => {
              const nameId = `attendee-name-${attendee.key}`;
              const emailId = `attendee-email-${attendee.key}`;
              return (
                <div className="attendee-draft" key={attendee.key}>
                  <Field>
                    <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                    <Input
                      id={nameId}
                      name={`attendee-name-${index}`}
                      autoComplete="name"
                      value={attendee.name}
                      required
                      onChange={event => setAttendeeDrafts(current => current.map(item => item.key === attendee.key ? { ...item, name: event.currentTarget.value } : item))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={emailId}>Email</FieldLabel>
                    <Input
                      id={emailId}
                      name={`attendee-email-${index}`}
                      type="email"
                      autoComplete="email"
                      value={attendee.email}
                      required
                      onChange={event => setAttendeeDrafts(current => current.map(item => item.key === attendee.key ? { ...item, email: event.currentTarget.value } : item))}
                    />
                  </Field>
                  <span className="attendee-account-type">External guest</span>
                  <Button
                      type="button"
                      className="attendee-remove-button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove attendee ${index + 1}`}
                      onClick={() => setAttendeeDrafts(current => current.filter(item => item.key !== attendee.key))}
                    >
                      <X aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </fieldset>
        ) : null}
        <Button
          type="button"
          className="add-calendar-row"
          variant="outline"
          onClick={() => setAttendeeDrafts(current => [...current, { key: createEntityId("attendee"), name: "", email: "", required: true }])}
        >
          <Plus data-icon="inline-start" />
          Add external guest
        </Button>
        {mode === "workspace" ? <p className="participant-picker-note">Guests are optional. With no guests, this event blocks time on your calendar.</p> : null}
        <FieldGroup className="calendar-form-fields">
          <div className="form-grid date-duration-grid">
            <Field>
              <FieldLabel htmlFor="schedule-start">Starts</FieldLabel>
              <Input
                id="schedule-start"
                name="schedule-start"
                autoComplete="off"
                type="datetime-local"
                value={slot}
                required
                onChange={event => setSlot(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="schedule-duration">Duration</FieldLabel>
              <NativeSelect
                id="schedule-duration"
                name="schedule-duration"
                value={String(durationMinutes)}
                onChange={event => setDurationMinutes(Number(event.currentTarget.value))}
              >
                <NativeSelectOption value="15">15 minutes</NativeSelectOption>
                <NativeSelectOption value="30">30 minutes</NativeSelectOption>
                <NativeSelectOption value="45">45 minutes</NativeSelectOption>
                <NativeSelectOption value="60">1 hour</NativeSelectOption>
                <NativeSelectOption value="90">90 minutes</NativeSelectOption>
                {mode === "workspace" ? <>
                  <NativeSelectOption value="120">2 hours</NativeSelectOption>
                  <NativeSelectOption value="240">4 hours</NativeSelectOption>
                  <NativeSelectOption value="480">8 hours</NativeSelectOption>
                </> : null}
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="schedule-location">Location</FieldLabel>
            <NativeSelect
              id="schedule-location"
              name="schedule-location"
              value={location ?? "none"}
              onChange={event => setLocation(event.currentTarget.value === "none" ? null : event.currentTarget.value as MeetingLocation)}
            >
              {mode === "workspace" ? <NativeSelectOption value="none">No video call</NativeSelectOption> : null}
              <NativeSelectOption value="google-meet">Google Meet</NativeSelectOption>
              {zoomConnected ? <NativeSelectOption value="zoom">Zoom</NativeSelectOption> : null}
            </NativeSelect>
            <FieldDescription>{location === null ? "This event marks you as busy. Add a video call if you need one." : meetingProviderConnectionDescription(zoomConnected)}</FieldDescription>
          </Field>
        </FieldGroup>
        {!personalEvent ? <label className="approval-check"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.currentTarget.checked)} /><span><strong>Require approval</strong><small>Creates an expiring Tentative Booking Hold for approval.</small></span></label> : null}
        <div className="mutual-slot-summary"><CheckCircle2 /><span><strong>{personalEvent ? "Block your calendar" : attendees.length > 0 ? "Ready to review" : "Add attendees"}</strong><small>{personalEvent ? "Just you · Busy" : `${attendees.length} ${attendees.length === 1 ? "attendee" : "attendees"}`} · {durationMinutes} minutes · {destination.name}</small></span></div>
        <div className="dialog-actions">
          {onCancel ? <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button> : null}
          <Button type="submit" disabled={submitting || (mode === "channel" && attendees.length === 0) || !title.trim() || !slot}>
            {submitting ? "Saving…" : personalEvent ? "Save event" : approvalRequired ? "Send request" : "Schedule meeting"}
          </Button>
        </div>
      </form>
  );
}

export function ScheduleDialog({ state, principalAccess, zoomConnected, initialStart, onClose, onSubmit }: { readonly state: CalendarState; readonly principalAccess: ProviderPrincipalAccessState; readonly zoomConnected: boolean; readonly initialStart: string; readonly onClose: () => void; readonly onSubmit: SubmitScheduledMeeting }) {
  return (
    <Modal title="Create an event" description="Block time for yourself or invite people to a meeting." onClose={onClose}>
      <ScheduleMeetingEditor
        state={state}
        principalAccess={principalAccess}
        zoomConnected={zoomConnected}
        mode="workspace"
        initialStart={initialStart}
        onCancel={onClose}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}

interface CalendarDraft {
  readonly key: string;
  readonly name: string;
  readonly role: CalendarRole;
  readonly color: string;
  readonly visible: boolean;
  readonly conflicts: boolean;
  readonly destination: boolean;
}

const createCalendarDraft = (key: string, destination: boolean): CalendarDraft => ({
  key,
  name: "",
  role: "owner",
  color: "#4f7cff",
  visible: true,
  conflicts: true,
  destination,
});

function ConnectCalendarDialog({
  gateway,
  destinationExists,
  existingAccount,
  onClose,
  onSubmitAccount,
  onSubmitCalendars,
}: {
  readonly gateway: CalendarGatewayClient;
  readonly destinationExists: boolean;
  readonly existingAccount: CalendarAccount | null;
  readonly onClose: () => void;
  readonly onSubmitAccount: (
    input: Parameters<typeof addConnectedAccount>[1],
  ) => Promise<string | null>;
  readonly onSubmitCalendars: (
    accountId: string,
    calendars: readonly ConnectedCalendarInput[],
  ) => Promise<string | null>;
}) {
  const createEntityId = useEntityId();
  const [provider, setProvider] = useState<CalendarProvider>(existingAccount?.provider ?? "google");
  const [accountLabel, setAccountLabel] = useState(existingAccount?.label ?? "");
  const nextRowId = useRef(1);
  const needsDestination = !destinationExists;
  const [calendars, setCalendars] = useState<readonly CalendarDraft[]>(() => [
    createCalendarDraft("calendar-1", needsDestination),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState("Calendar couldn’t connect");
  const [notice, setNotice] = useState<{
    readonly title: string;
    readonly description: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingProvider, setOpeningProvider] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<"checking" | "online" | "offline">("checking");
  const [providerCatalog, setProviderCatalog] =
    useState<CalendarGatewayProviderCatalog | null>(null);
  const [oauthPendingId, setOauthPendingId] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [authorizationOpened, setAuthorizationOpened] = useState(false);
  const addingToExisting = existingAccount !== null;
  useEffect(() => {
    let cancelled = false;
    void Promise.all([gateway.health(), gateway.providers()])
      .then(([, catalog]) => {
        if (cancelled) return;
        setProviderCatalog(catalog);
        setProvider(current =>
          catalog.providers.some(item => item.id === current)
            ? current
            : catalog.providers[0]?.id ?? current
        );
        setGatewayStatus("online");
      })
      .catch(() => {
        if (!cancelled) {
          setProviderCatalog(null);
          setGatewayStatus("offline");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gateway]);
  const providerStatuses = providerCatalog?.providers ?? [];
  const selectedProviderName = providerNames[provider] ?? "Calendar provider";
  const connectionCapabilities = providerConnectionCapabilities(
    providerCatalog,
    provider,
    addingToExisting,
  );
  const oauthAvailable = connectionCapabilities.oauthAvailable;
  const requireOwnedConnection = (
    connection: CalendarGatewayConnection,
  ): CalendarGatewayConnection => {
    if (connection.ownerPrincipalId !== gateway.principalId) {
      throw new Error(
        "The provider connection belongs to a different TAP user and cannot be imported.",
      );
    }
    return connection;
  };
  const gatewayCalendars = (
    connection: CalendarGatewayConnection,
    preferences: ReadonlyMap<string, CalendarDraft> = new Map(),
  ): readonly ConnectedCalendarInput[] => {
    const preferredDestinationId = connection.calendars.find(calendar =>
      calendar.writable && preferences.get(calendar.id)?.destination
    )?.id;
    const automaticDestinationId = !destinationExists && !preferredDestinationId
      ? preferredDestinationCalendar(connection.calendars)?.id
      : undefined;
    return connection.calendars.map(calendar => {
      const preference = preferences.get(calendar.id);
      return {
        id: calendar.id,
        name: calendar.name,
        color: preference?.color ?? calendar.color,
        role: calendar.role,
        visible: preference?.visible ?? true,
        conflicts: preference?.conflicts ?? calendar.freshness !== "stale",
        writable: calendar.writable,
        destination:
          calendar.id === preferredDestinationId ||
          calendar.id === automaticDestinationId,
        primary: calendar.primary,
        freshness: calendar.freshness,
      };
    });
  };
  const importOAuthConnection = async (): Promise<void> => {
    if (!oauthPendingId || submitting) return;
    setSubmitting(true);
    setErrorTitle("Calendar couldn’t connect");
    setError(null);
    setNotice(null);
    try {
      const connection = requireOwnedConnection(
        await gateway.getConnection(oauthPendingId),
      );
      if (connection.status === "pending") {
        return;
      }
      const message = await onSubmitAccount({
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        status: connection.status === "read-only" ? "read-only" : "connected",
        calendars: gatewayCalendars(connection),
      });
      if (message) setError(message);
    } catch (cause: unknown) {
      setError(providerConnectionErrorMessage(cause, selectedProviderName, "import"));
    } finally {
      setSubmitting(false);
    }
  };
  const importDiscoveredProviderCalendars = async (): Promise<void> => {
    if (
      !existingAccount ||
      !connectionCapabilities.providerRefreshAvailable ||
      submitting
    ) return;
    setSubmitting(true);
    setErrorTitle("Calendars couldn’t refresh");
    setError(null);
    setNotice(null);
    try {
      const connection = requireOwnedConnection(
        await gateway.syncConnection(existingAccount.id),
      );
      const existingIds = new Set(
        existingAccount.calendars.map(calendar => calendar.id),
      );
      const discovered = gatewayCalendars(connection).filter(
        calendar => !existingIds.has(calendar.id),
      );
      if (discovered.length === 0) {
        setNotice({
          title: "Calendars are up to date",
          description: "No new calendars were found for this provider account.",
        });
        return;
      }
      const message = await onSubmitCalendars(existingAccount.id, discovered);
      if (message) setError(message);
    } catch (cause: unknown) {
      setError(providerConnectionErrorMessage(cause, providerNames[existingAccount.provider] ?? "Calendar provider", "refresh"));
    } finally {
      setSubmitting(false);
    }
  };
  const launchProviderAuthorization = async (
    url: string,
    oauthProvider: OAuthNavigationProvider,
    directUserClick: boolean,
  ): Promise<void> => {
    setOpeningProvider(true);
    setErrorTitle("Browser couldn’t open");
    setError(null);
    setNotice(null);
    try {
      const outcome = await openProviderAuthorization(
        sdk.navigation as ProviderExternalNavigationApi,
        oauthProvider,
        url,
      );
      if (outcome === "opened") {
        setAuthorizationOpened(true);
        return;
      }
      setAuthorizationOpened(false);
      if (outcome !== "user-gesture-required" || directUserClick) {
        setError(providerExternalNavigationErrorMessage(
          outcome,
          providerNames[oauthProvider] ?? "Calendar provider",
        ));
      }
    } catch {
      setAuthorizationOpened(false);
      setError(providerExternalNavigationErrorMessage(
        "native-open-failed",
        providerNames[oauthProvider] ?? "Calendar provider",
      ));
    } finally {
      setOpeningProvider(false);
    }
  };
  const beginOAuth = async (): Promise<void> => {
    if (!oauthAvailable || submitting || (provider !== "google" && provider !== "microsoft")) return;
    const oauthProvider = provider;
    setSubmitting(true);
    setErrorTitle("Calendar couldn’t connect");
    setError(null);
    setNotice(null);
    setAuthorizationOpened(false);
    try {
      const result = await gateway.startOAuth({
        id: createEntityId("account"),
        provider: oauthProvider,
        ...(accountLabel.trim() ? { label: accountLabel.trim() } : {}),
      });
      setOauthPendingId(result.connectionId);
      setAuthorizationUrl(result.authorizationUrl);
      await launchProviderAuthorization(
        result.authorizationUrl,
        oauthProvider,
        false,
      );
    } catch (cause: unknown) {
      setError(providerConnectionErrorMessage(cause, selectedProviderName, "connect"));
    } finally {
      setSubmitting(false);
    }
  };
  const updateDraft = (key: string, update: Partial<Omit<CalendarDraft, "key">>) => {
    setCalendars(current => current.map(calendar =>
      calendar.key === key ? { ...calendar, ...update } : calendar,
    ));
  };
  const setDestination = (key: string, checked: boolean) => {
    setCalendars(current => current.map(calendar => ({
      ...calendar,
      destination: calendar.key === key ? checked : checked ? false : calendar.destination,
    })));
  };
  return (
    <Modal
      title={addingToExisting ? `Add calendars to ${existingAccount.label}` : "Add a calendar account"}
      description={addingToExisting
        ? "Add one or more calendars from this provider account and configure each calendar independently."
        : "Configure an account and all calendars you want TAP Calendar to use."}
      onClose={onClose}
    >
      <form
        className="schedule-form"
        aria-busy={submitting}
        onSubmit={event => {
          event.preventDefault();
          if (submitting) return;
          if (!connectionCapabilities.localConnectorAvailable) {
            setError(
              "Manual calendar connections are unavailable from this Calendar service.",
            );
            return;
          }
          setSubmitting(true);
          setErrorTitle("Calendar couldn’t connect");
          setError(null);
          setNotice(null);
          const effectiveProvider = existingAccount?.provider ?? provider;
          const calendarRoles = calendars.map(calendar =>
            effectiveProvider === "ics" ? "reader" as const : calendar.role,
          );
          const writableRows = calendarRoles.map(role => role === "owner" || role === "writer");
          const selectedDestinationIndex = calendars.findIndex(
            (calendar, index) => calendar.destination && writableRows[index],
          );
          const automaticDestinationIndex = needsDestination && selectedDestinationIndex < 0
            ? writableRows.findIndex(Boolean)
            : -1;
          const prepared = calendars.map((calendar, index) => {
            const id = createEntityId("calendar");
            const role = calendarRoles[index]!;
            const writable = writableRows[index]!;
            const freshness = effectiveProvider === "ics" ? "delayed" as const : "live" as const;
            return {
              draft: { ...calendar, destination: index === selectedDestinationIndex || index === automaticDestinationIndex },
              gateway: {
                id,
                providerCalendarId: id,
                name: calendar.name.trim(),
                color: calendar.color,
                role,
                writable,
                freshness,
                primary: index === 0,
              } satisfies LocalCalendarGatewayInput,
            };
          });
          void (async () => {
            try {
              const connectionId = existingAccount?.id ?? createEntityId("account");
              const connection = requireOwnedConnection(existingAccount
                ? await gateway.addLocalCalendars(
                    existingAccount.id,
                    prepared.map(item => item.gateway),
                  )
                : await gateway.createLocalConnection({
                    id: connectionId,
                    provider,
                    label: accountLabel.trim(),
                    calendars: prepared.map(item => item.gateway),
                  }));
              const preferences = new Map(
                prepared.map(item => [item.gateway.id, item.draft] as const),
              );
              const addedIds = new Set(prepared.map(item => item.gateway.id));
              const projected = gatewayCalendars(connection, preferences).filter(calendar =>
                addedIds.has(calendar.id),
              );
              const message = existingAccount
                ? await onSubmitCalendars(existingAccount.id, projected)
                : await onSubmitAccount({
                    id: connection.id,
                    provider: connection.provider,
                    label: connection.label,
                    status: connection.status === "read-only" ? "read-only" : "connected",
                    calendars: projected,
                  });
              if (message) {
                try {
                  if (existingAccount) {
                    await gateway.removeLocalCalendars(
                      existingAccount.id,
                      prepared.map(item => item.gateway.id),
                    );
                  } else {
                    await gateway.deleteConnection(connection.id);
                  }
                  setError(message);
                } catch {
                  setError(
                    "TAP Calendar couldn't finish saving this connection or restore the previous state. Close and reopen this dialog before trying again.",
                  );
                }
              } else {
                setError(null);
              }
            } catch (cause: unknown) {
              setError(providerConnectionErrorMessage(
                cause,
                providerNames[effectiveProvider] ?? "Calendar provider",
                "import",
              ));
            } finally {
              setSubmitting(false);
            }
          })();
        }}
      >
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{errorTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="info" role="status">
            <CheckCircle2 aria-hidden="true" />
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription>{notice.description}</AlertDescription>
          </Alert>
        ) : null}
        {connectionCapabilities.localConnectorAvailable ? (
          <div className="manual-connection-note"><ShieldCheck /><div><strong>Local test connection</strong><p>Add manual calendar rows to test TAP Calendar without connecting an external provider.</p></div></div>
        ) : null}
        {gatewayStatus === "checking" ? (
          <p className="provider-connection-status" role="status">Checking available providers…</p>
        ) : null}
        {gatewayStatus === "offline" ? (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Calendar service unavailable</AlertTitle>
            <AlertDescription>Check your connection and try again.</AlertDescription>
          </Alert>
        ) : null}
        {addingToExisting ? (
          <div className="account-dialog-summary"><span className={`provider-icon provider-${existingAccount.provider}`}><Cloud /></span><div><strong>{existingAccount.label}</strong><small>{providerNames[existingAccount.provider]} · {existingAccount.calendars.length} existing {existingAccount.calendars.length === 1 ? "calendar" : "calendars"}</small></div></div>
        ) : (
          <div className="form-grid provider-account-fields">
            <Field>
              <FieldLabel htmlFor="calendar-account-provider">Provider</FieldLabel>
              <NativeSelect id="calendar-account-provider" name="calendar-account-provider" value={provider} disabled={submitting || oauthPendingId !== null || gatewayStatus !== "online" || providerStatuses.length === 0} onChange={event => setProvider(event.currentTarget.value as CalendarProvider)}>
                {providerStatuses.length > 0
                  ? providerStatuses.map(status => <NativeSelectOption value={status.id} key={status.id}>{providerNames[status.id]}</NativeSelectOption>)
                  : <NativeSelectOption value={provider}>{providerNames[provider]}</NativeSelectOption>}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-account-label">{connectionCapabilities.localConnectorAvailable ? "Account name or email" : "Account label (optional)"}</FieldLabel>
              <Input id="calendar-account-label" name="account-label" autoComplete={connectionCapabilities.localConnectorAvailable ? "email" : "off"} value={accountLabel} required={connectionCapabilities.localConnectorAvailable} disabled={submitting || oauthPendingId !== null} onChange={event => setAccountLabel(event.currentTarget.value)} />
            </Field>
          </div>
        )}
        {!addingToExisting && gatewayStatus === "online" ? (
          oauthPendingId ? (
            <Alert variant="info" role="status">
              <ExternalLink aria-hidden="true" />
              <AlertTitle>Finish connecting {providerNames[provider]}</AlertTitle>
              <AlertDescription>{authorizationOpened
                ? `${providerNames[provider]} opened in your browser. Approve access there, then return here.`
                : `Open ${providerNames[provider]} in your browser, approve access there, then return here.`}</AlertDescription>
            </Alert>
          ) : !oauthAvailable ? (
              <Alert variant="warning">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>{providerNames[provider]} is unavailable</AlertTitle>
                <AlertDescription>{providerUnavailableDescription(connectionCapabilities.localConnectorAvailable)}</AlertDescription>
              </Alert>
          ) : null
        ) : null}
        {connectionCapabilities.providerRefreshAvailable ? (
          <p className="provider-connection-status">Import calendars added to this provider account since it was connected.</p>
        ) : null}
        {connectionCapabilities.localConnectorAvailable ? (
          <>
            <div className="calendar-draft-list">
              {calendars.map((calendar, index) => {
                const effectiveProvider = existingAccount?.provider ?? provider;
                const role = effectiveProvider === "ics" ? "reader" : calendar.role;
                const writable = role === "owner" || role === "writer";
                return (
                  <fieldset className="calendar-draft-card" key={calendar.key}>
                    <legend>Calendar {index + 1}</legend>
                    {calendars.length > 1 ? <button type="button" className="icon-button calendar-draft-remove" aria-label={`Remove calendar ${index + 1}`} onClick={() => setCalendars(current => current.filter(item => item.key !== calendar.key))}><X /></button> : null}
                    <div className="form-grid">
                      <label className="field"><span>Calendar name</span><input name={`calendar-name-${index}`} autoComplete="off" value={calendar.name} required onChange={event => updateDraft(calendar.key, { name: event.currentTarget.value })} /></label>
                      <label className="field"><span>Access</span><select value={role} disabled={effectiveProvider === "ics"} onChange={event => { const nextRole = event.currentTarget.value as CalendarRole; const nextWritable = nextRole === "owner" || nextRole === "writer"; updateDraft(calendar.key, { role: nextRole, ...(nextWritable ? {} : { destination: false }) }); }}><option value="owner">I own this calendar</option><option value="writer">Shared · can edit</option><option value="reader">Shared · read only</option><option value="free-busy">Shared · free/busy only</option></select></label>
                    </div>
                    <div className="calendar-draft-options">
                      <label><input type="checkbox" checked={calendar.visible} onChange={event => updateDraft(calendar.key, { visible: event.currentTarget.checked })} /><span>Show in Calendar</span></label>
                      <label><input type="checkbox" checked={calendar.conflicts} onChange={event => updateDraft(calendar.key, { conflicts: event.currentTarget.checked })} /><span>Check for conflicts</span></label>
                      <label><input type="checkbox" checked={calendar.destination && writable} disabled={!writable} onChange={event => setDestination(calendar.key, event.currentTarget.checked)} /><span>Destination Calendar</span></label>
                      <label className="calendar-color-field"><span>Color</span><input name={`calendar-color-${index}`} type="color" value={calendar.color} onChange={event => updateDraft(calendar.key, { color: event.currentTarget.value })} /></label>
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <button type="button" className="secondary-button add-calendar-row" onClick={() => {
              nextRowId.current += 1;
              setCalendars(current => [...current, createCalendarDraft(`calendar-${nextRowId.current}`, false)]);
            }}><Plus /> Add another calendar</button>
            <DialogActions onCancel={onClose} submitLabel={addingToExisting ? "Add calendars" : "Add account & calendars"} submitting={submitting} />
          </>
        ) : (
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
            {connectionCapabilities.providerRefreshAvailable ? (
              <Button type="button" disabled={submitting} onClick={() => void importDiscoveredProviderCalendars()}>
                <RefreshCw data-icon="inline-start" />
                {submitting ? "Importing…" : "Import new calendars"}
              </Button>
            ) : oauthPendingId ? (
              <>
                {authorizationUrl && (provider === "google" || provider === "microsoft") ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={openingProvider}
                    onClick={() => void launchProviderAuthorization(
                      authorizationUrl,
                      provider,
                      true,
                    )}
                  >
                    <ExternalLink data-icon="inline-start" />
                    {openingProvider ? "Opening…" : `Open ${providerNames[provider]}`}
                  </Button>
                ) : null}
                <Button type="button" disabled={submitting || openingProvider} onClick={() => void importOAuthConnection()}>
                  <RefreshCw data-icon="inline-start" />
                  {submitting ? "Checking…" : "Check connection"}
                </Button>
              </>
            ) : oauthAvailable ? (
              <Button type="button" disabled={submitting} onClick={() => void beginOAuth()}>
                <ExternalLink data-icon="inline-start" />
                {submitting ? "Preparing…" : `Connect ${providerNames[provider]}`}
              </Button>
            ) : null}
          </div>
        )}
      </form>
    </Modal>
  );
}

function WorkBlockDialog({ state, principalAccess, platform, workspaceId, onClose, onSubmit }: { readonly state: CalendarState; readonly principalAccess: ProviderPrincipalAccessState; readonly platform: CalendarPlatform; readonly workspaceId: string | undefined; readonly onClose: () => void; readonly onSubmit: (input: Parameters<typeof createWorkBlock>[1]) => Promise<ProviderBackedSubmissionResult> }) {
  const createEntityId = useEntityId();
  const workBlockAttemptRef = useRef<{ readonly canonical: string; readonly key: string } | null>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tapSources, setTapSources] = useState<readonly TapTaskWorkBlockSource[]>([]);
  const [taskSourcesLoading, setTaskSourcesLoading] = useState(true);
  const [taskSourcesError, setTaskSourcesError] = useState<string | null>(null);
  const [taskSourcesAttempt, setTaskSourcesAttempt] = useState(0);
  const automaticTitleRef = useRef<string | null>(null);
  const destination = principalWritableDestination(state, principalAccess);
  useEffect(() => {
    let cancelled = false;
    setTaskSourcesLoading(true);
    setTaskSourcesError(null);
    setTapSources([]);
    setSource("");
    void platform.listTaskWorkBlockSources(workspaceId)
      .then(result => {
        if (cancelled) return;
        if (!result.ok) {
          setTaskSourcesError(result.error.message);
          return;
        }
        setTapSources(result.value);
        const firstSource = result.value[0];
        setSource(firstSource?.sourceId ?? "");
        if (firstSource !== undefined) {
          setTitle(current => {
            if (current.trim().length > 0 && current !== automaticTitleRef.current) return current;
            automaticTitleRef.current = firstSource.suggestedTitle;
            return firstSource.suggestedTitle;
          });
        }
      })
      .catch(cause => {
        if (!cancelled) {
          setTaskSourcesError(cause instanceof Error && cause.message.trim().length > 0 ? cause.message : "The TAP host did not complete the task request.");
        }
      })
      .finally(() => {
        if (!cancelled) setTaskSourcesLoading(false);
      });
    return () => { cancelled = true; };
  }, [platform, taskSourcesAttempt, workspaceId]);
  const availableSources = tapSources.map(item => ({ id: item.sourceId, kind: "task" as const, label: item.sourceLabel }));
  const selected = availableSources.find(item => item.id === source);
  const taskSourceDisabled = submitting || taskSourcesLoading || taskSourcesError !== null || availableSources.length === 0;
  if (!destination) {
    return (
      <Modal title="Google Destination Calendar required" description="Provider-backed Work Blocks currently need a writable Google Calendar." onClose={onClose}>
        <ProductEmptyState icon={<SquareCheckBig />} title="Authorize a writable Google Calendar" description="Authorize Google and make an owner or writer calendar the Destination Calendar before blocking time." action={<Button type="button" onClick={onClose}>Return to Calendar</Button>} />
      </Modal>
    );
  }
  return (
    <Modal title="Block time for TAP work" description="Reserve focus time while keeping private source content inside TAP." onClose={onClose}>
      <form className="schedule-form" onSubmit={event => { event.preventDefault(); if (submitting || !selected || !start || !title.trim()) return; setSubmitting(true); setError(null); const startDate = new Date(start); const draft = { calendarId: destination.id, title: title.trim(), start: startDate.toISOString(), end: new Date(startDate.getTime() + durationMinutes * 60_000).toISOString(), sourceKind: selected.kind, sourceId: selected.id, sourceLabel: selected.label }; const canonical = JSON.stringify(draft); const key = workBlockAttemptRef.current?.canonical === canonical ? workBlockAttemptRef.current.key : createEntityId("work-block"); workBlockAttemptRef.current = { canonical, key }; void onSubmit({ id: key, ...draft }).then(result => { if (result.error && !result.retrySameAttempt) workBlockAttemptRef.current = null; setError(result.error); }).finally(() => setSubmitting(false)); }}>
        {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
        <FieldGroup className="calendar-form-fields">
          <Field data-disabled={taskSourceDisabled}>
            <FieldLabel htmlFor="work-block-task">TAP task</FieldLabel>
            <NativeSelect
              id="work-block-task"
              name="work-block-task"
              value={source}
              disabled={taskSourceDisabled}
              aria-describedby="work-block-task-description"
              onChange={event => {
                const nextSourceId = event.currentTarget.value;
                const nextSource = tapSources.find(item => item.sourceId === nextSourceId);
                setSource(nextSourceId);
                if (nextSource !== undefined) {
                  setTitle(current => {
                    if (current.trim().length > 0 && current !== automaticTitleRef.current) return current;
                    automaticTitleRef.current = nextSource.suggestedTitle;
                    return nextSource.suggestedTitle;
                  });
                }
              }}
            >
              <NativeSelectOption value="">
                {taskSourcesLoading ? "Loading TAP tasks…" : taskSourcesError !== null ? "TAP tasks unavailable" : availableSources.length === 0 ? "No TAP tasks available" : "Choose a task"}
              </NativeSelectOption>
              {availableSources.map(item => <NativeSelectOption value={item.id} key={item.id}>{item.label}</NativeSelectOption>)}
            </NativeSelect>
            <FieldDescription id="work-block-task-description">Choose any task visible to you in this TAP workspace.</FieldDescription>
          </Field>
        </FieldGroup>
        {taskSourcesLoading ? <div className="task-source-loading" role="status"><RefreshCw className="is-spinning" aria-hidden="true" /><span>Loading TAP tasks…</span></div> : null}
        {taskSourcesError !== null ? <div className="dialog-warning task-source-action" role="alert"><AlertTriangle aria-hidden="true" /><span><strong>TAP tasks could not load.</strong> {taskSourcesError}</span><Button type="button" className="task-source-retry" variant="ghost" size="sm" disabled={submitting} onClick={() => setTaskSourcesAttempt(current => current + 1)}><RefreshCw data-icon="inline-start" /> Try again</Button></div> : null}
        {!taskSourcesLoading && taskSourcesError === null && availableSources.length === 0 ? <div className="dialog-warning task-source-action" role="status"><AlertTriangle aria-hidden="true" /><span>No active TAP tasks are available in this workspace. Create or assign one, then refresh.</span><Button type="button" className="task-source-retry" variant="ghost" size="sm" disabled={submitting} onClick={() => setTaskSourcesAttempt(current => current + 1)}><RefreshCw data-icon="inline-start" /> Refresh tasks</Button></div> : null}
        <FieldGroup className="calendar-form-fields">
          <Field>
            <FieldLabel htmlFor="work-block-title">Calendar title</FieldLabel>
            <Input
              id="work-block-title"
              name="work-block-title"
              autoComplete="off"
              value={title}
              required
              disabled={submitting}
              onChange={event => {
                automaticTitleRef.current = null;
                setTitle(event.currentTarget.value);
              }}
            />
          </Field>
          <div className="form-grid date-duration-grid">
            <Field>
              <FieldLabel htmlFor="work-block-start">Starts</FieldLabel>
              <Input
                id="work-block-start"
                name="work-block-start"
                autoComplete="off"
                type="datetime-local"
                value={start}
                required
                disabled={submitting}
                onChange={event => setStart(event.currentTarget.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="work-block-duration">Duration</FieldLabel>
              <NativeSelect
                id="work-block-duration"
                name="work-block-duration"
                value={String(durationMinutes)}
                disabled={submitting}
                onChange={event => setDurationMinutes(Number(event.currentTarget.value))}
              >
                <NativeSelectOption value="30">30 minutes</NativeSelectOption>
                <NativeSelectOption value="60">1 hour</NativeSelectOption>
                <NativeSelectOption value="90">90 minutes</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
        </FieldGroup>
        <div className="privacy-preview"><LockKeyhole /><div><strong>Provider replica</strong><p>“{title}” · Busy · TAP deep link</p><small>Task description, comments, channel messages, and attachments are never copied.</small></div></div>
        <div className="dialog-actions"><Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" disabled={submitting || !selected || !start || !title.trim()}><SquareCheckBig data-icon="inline-start" /> {submitting ? "Creating…" : "Create Work Block"}</Button></div>
      </form>
    </Modal>
  );
}

function PublicBookingPreview({ state, busyEvents, selection, availabilityCacheAnchorDate, availabilityCoverageComplete, availabilitySyncState, onClose, onCommit, onReconcile, onReserveBooking, onProviderReconciled, onAvailabilityAnchorChange, onRefreshAvailability, announce }: {
  readonly state: CalendarState;
  readonly busyEvents: readonly CalendarEvent[];
  readonly selection: { profileId: string; eventTypeId: string };
  readonly availabilityCacheAnchorDate: string;
  readonly availabilityCoverageComplete: boolean;
  readonly availabilitySyncState: ProviderEventSyncState;
  readonly onClose: () => void;
  readonly onCommit: CommitCalendarState;
  readonly onReconcile: PersistCalendarState;
  readonly onReserveBooking: ReserveProviderBooking;
  readonly onProviderReconciled: (idempotencyKey: string, booking: CalendarGatewayCommittedBooking) => Promise<void>;
  readonly onAvailabilityAnchorChange: (date: string) => void;
  readonly onRefreshAvailability: () => void;
  readonly announce: (message: string) => void;
}) {
  const createEntityId = useEntityId();
  const profile = state.bookingProfiles.find(item => item.id === selection.profileId)!;
  const eventType = profile.eventTypes.find(item => item.id === selection.eventTypeId)!;
  const availabilityScheduleId = resolveEventTypeAvailabilityScheduleId(state, eventType);
  const activeSchedule = state.availability.find(
    schedule => schedule.id === availabilityScheduleId,
  );
  const scheduleTimeZone = isSupportedTimeZone(activeSchedule?.timezone ?? "")
    ? activeSchedule!.timezone
    : detectedTimeZone();
  const [policyNow] = useState(() => Date.now());
  const [viewerTimeZone, setViewerTimeZone] = useState(() => detectedTimeZone());
  const policyToday = calendarDateInTimeZone(new Date(policyNow), scheduleTimeZone);
  const viewerToday = calendarDateInTimeZone(new Date(policyNow), viewerTimeZone);
  const [step, setStep] = useState<"date" | "slot" | "details" | "success">("date");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const month = parseCalendarDate(viewerToday);
    month.setUTCDate(1);
    return calendarDateKey(month);
  });
  const [selectedDate, setSelectedDate] = useState(() => viewerToday);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const bookingAttemptRef = useRef<{
    readonly canonical: string;
    readonly key: string;
    readonly requestedAt: string;
  } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef(step);
  const visibleMonthDate = parseCalendarDate(visibleMonth);
  const visibleMonthEnd = addCalendarMonths(visibleMonth, 1);
  const calendarGridStart = addCalendarDays(visibleMonth, -visibleMonthDate.getUTCDay());
  const publicDates = Array.from(
    { length: 42 },
    (_, index) => addCalendarDays(calendarGridStart, index),
  );
  const bookingHorizonDays = activeSchedule?.bookingHorizonDays ?? 0;
  const lastBookingDate = bookingHorizonDays > 0
    ? addCalendarDays(policyToday, bookingHorizonDays - 1)
    : addCalendarDays(policyToday, -1);
  const firstBookingMonth = `${viewerToday.slice(0, 7)}-01`;
  const lastViewerBookingDate = addCalendarDays(lastBookingDate, 2);
  const lastBookingMonth = `${lastViewerBookingDate.slice(0, 7)}-01`;
  const canPageBackward = visibleMonth > firstBookingMonth;
  const canPageForward = visibleMonth < lastBookingMonth;
  const currentPageCovered = availabilityCoverageComplete
    && availabilityCacheAnchorDate === visibleMonth;
  useEffect(() => {
    onAvailabilityAnchorChange(visibleMonth);
  }, [onAvailabilityAnchorChange, visibleMonth]);
  type ViewerBookingSlot = AvailableSlot & {
    readonly hostDate: string;
    readonly hostTimeZone: string;
  };
  const slotsByViewerDate = useMemo(() => {
    const grouped = new Map<string, Map<string, ViewerBookingSlot>>();
    const result = new Map<string, readonly ViewerBookingSlot[]>();
    if (!currentPageCovered || !activeSchedule) return result;
    const firstHostDate = addCalendarDays(calendarGridStart, -2);
    for (let index = 0; index < 46; index += 1) {
      const hostDate = addCalendarDays(firstHostDate, index);
      if (hostDate < policyToday || hostDate > lastBookingDate) continue;
      const availability = availabilityForDate(activeSchedule, hostDate);
      if (availability.windows.length === 0) continue;
      const hostTimeZone = isSupportedTimeZone(availability.timeZone)
        ? availability.timeZone
        : scheduleTimeZone;
      const generated = findAvailableSlotsAcrossWindows({
        date: hostDate,
        timeZone: hostTimeZone,
        durationMinutes: eventType.durationMinutes,
        intervalMinutes: 30,
        windows: availability.windows,
        busy: busyEvents,
        bufferBeforeMinutes: activeSchedule.bufferBeforeMinutes,
        bufferAfterMinutes: activeSchedule.bufferAfterMinutes,
      });
      const available = applyAvailabilityBookingPolicy(generated, {
        timeZone: hostTimeZone,
        horizonTimeZone: scheduleTimeZone,
        calendarDate: hostDate,
        preferredStart: activeSchedule.preferredStart,
        preferredEnd: activeSchedule.preferredEnd,
        minimumNoticeMinutes: activeSchedule.minimumNoticeMinutes,
        bookingHorizonDays: activeSchedule.bookingHorizonDays,
      });
      for (const slot of available) {
        const viewerDate = calendarDateInTimeZone(new Date(slot.start), viewerTimeZone);
        if (viewerDate < calendarGridStart || viewerDate >= addCalendarDays(calendarGridStart, 42)) continue;
        const slotsForDate = grouped.get(viewerDate) ?? new Map<string, ViewerBookingSlot>();
        slotsForDate.set(`${slot.start}\u0000${slot.end}`, {
          ...slot,
          hostDate,
          hostTimeZone,
        });
        grouped.set(viewerDate, slotsForDate);
      }
    }
    for (const [viewerDate, slotsForDate] of grouped) {
      result.set(viewerDate, [...slotsForDate.values()]
        .sort((left, right) => left.start.localeCompare(right.start))
        .slice(0, 24));
    }
    return result;
  }, [
    activeSchedule,
    busyEvents,
    calendarGridStart,
    currentPageCovered,
    eventType.durationMinutes,
    lastBookingDate,
    policyToday,
    scheduleTimeZone,
    viewerTimeZone,
  ]);
  const slots = slotsByViewerDate.get(selectedDate) ?? [];
  const hasAvailableDatesInVisibleMonth = publicDates.some(date =>
    date >= visibleMonth &&
    date < visibleMonthEnd &&
    slotsByViewerDate.has(date)
  );
  const viewerDateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: viewerTimeZone,
    timeZoneName: "short",
  }), [viewerTimeZone]);
  const selectedSlotIsAvailable = selectedSlot === null || slots.some(slot =>
    slot.start === selectedSlot
  );
  const selectedSlotOption = selectedSlot === null
    ? null
    : slots.find(slot => slot.start === selectedSlot) ?? null;
  useEffect(() => {
    if (selectedSlot === null || selectedSlotIsAvailable) return;
    setSelectedSlot(null);
    bookingAttemptRef.current = null;
    setError("That time is no longer available under the host's current hours. Choose another time.");
    setStep("date");
  }, [selectedSlot, selectedSlotIsAvailable]);
  useEffect(() => {
    if (previousStepRef.current === step) return;
    previousStepRef.current = step;
    const frame = globalThis.requestAnimationFrame(() => stepHeadingRef.current?.focus());
    return () => globalThis.cancelAnimationFrame(frame);
  }, [step]);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const previouslyFocused = globalThis.document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(overlayRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])].filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (!overlayRef.current?.contains(globalThis.document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);
  const changeViewerTimeZone = (nextTimeZone: string) => {
    const nextViewerToday = calendarDateInTimeZone(new Date(policyNow), nextTimeZone);
    setViewerTimeZone(nextTimeZone);
    setVisibleMonth(`${nextViewerToday.slice(0, 7)}-01`);
    setSelectedDate(nextViewerToday);
    setSelectedSlot(null);
    bookingAttemptRef.current = null;
    setError(null);
    setStep("date");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSlot || !selectedSlotOption || submitting) return;
    const selectedSlotStillMeetsPolicy = activeSchedule !== undefined && applyAvailabilityBookingPolicy(
      [{ start: selectedSlot, end: new Date(Date.parse(selectedSlot) + eventType.durationMinutes * 60_000).toISOString() }],
      {
        timeZone: selectedSlotOption.hostTimeZone,
        horizonTimeZone: scheduleTimeZone,
        calendarDate: selectedSlotOption.hostDate,
        preferredStart: activeSchedule.preferredStart,
        preferredEnd: activeSchedule.preferredEnd,
        minimumNoticeMinutes: activeSchedule.minimumNoticeMinutes,
        bookingHorizonDays: activeSchedule.bookingHorizonDays,
        now: Date.now(),
      },
    ).length === 1;
    if (!selectedSlotIsAvailable || !selectedSlotStillMeetsPolicy) {
      setSelectedSlot(null);
      bookingAttemptRef.current = null;
      setError("That time no longer meets the host's availability or booking notice. Choose another time.");
      setStep("slot");
      return;
    }
    setSubmitting(true);
    setError(null);
    if (!profile.published || !eventType.active) {
      setError("This booking page is no longer accepting bookings. Refresh before choosing another time.");
      setSubmitting(false);
      return;
    }
    const destination = allCalendars(state).find(
      calendar =>
        calendar.id === eventType.destinationCalendarId &&
        supportsProviderBookingWrites(state, calendar),
    );
    if (!destination) {
      setError("This host's Destination Calendar is unavailable. Try again later.");
      setSubmitting(false);
      return;
    }
    const start = new Date(selectedSlot);
    const end = new Date(start.getTime() + eventType.durationMinutes * 60_000).toISOString();
    const conflictTimeMin = new Date(
      Date.parse(selectedSlot) - (activeSchedule?.bufferBeforeMinutes ?? 0) * 60_000,
    ).toISOString();
    const conflictTimeMax = new Date(
      Date.parse(end) + (activeSchedule?.bufferAfterMinutes ?? 0) * 60_000,
    ).toISOString();
    const canonical = JSON.stringify({
      destinationCalendarId: eventType.destinationCalendarId,
      title: eventType.title,
      start: selectedSlot,
      end,
      conflictTimeMin,
      conflictTimeMax,
      bookingKind: eventType.approvalRequired ? "approval-hold" : "meeting",
      location: eventType.location,
      guestName: name.trim(),
      guestEmail: email.trim().toLowerCase(),
    });
    const attempt = bookingAttemptRef.current?.canonical === canonical
      ? bookingAttemptRef.current
      : {
          canonical,
          key: createEntityId("public-booking"),
          requestedAt: new Date().toISOString(),
        };
    bookingAttemptRef.current = attempt;
    const bookingAttemptId = attempt.key;
    const requestedAt = attempt.requestedAt;
    const attendee: CalendarAttendee = {
      id: `${bookingAttemptId}-guest`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      kind: "external",
      required: true,
    };
    const reserved = await onReserveBooking({
      actionId: CALENDAR_PUBLISH_ACTION,
      idempotencyKey: bookingAttemptId,
      destinationCalendarId: eventType.destinationCalendarId,
      title: eventType.title,
      start: selectedSlot,
      end,
      conflictTimeMin,
      conflictTimeMax,
      bookingKind: eventType.approvalRequired ? "approval-hold" : "meeting",
      location: eventType.location,
      attendees: [attendee],
      reconciliation: {
        kind: "public-booking",
        title: eventType.title,
        calendarId: eventType.destinationCalendarId,
        start: selectedSlot,
        end,
        location: eventType.location,
        attendees: [attendee],
        approvalRequired: eventType.approvalRequired,
        eventTypeId: eventType.id,
        requestedAt,
      },
      ...(eventType.approvalRequired
        ? {
            expiresAt: new Date(
              Date.parse(requestedAt) + 24 * 60 * 60 * 1000,
            ).toISOString(),
          }
        : {}),
    });
    if (!reserved.ok) {
      if (!reserved.retrySameAttempt) bookingAttemptRef.current = null;
      setError(reserved.error);
      setSubmitting(false);
      return;
    }
    let domainError: string | null = null;
    let approvalRequired = eventType.approvalRequired;
    let alreadyReconciled = false;
    try {
      const changed = await onReconcile(latest => {
        alreadyReconciled = latest.events.some(
          candidate => candidate.id === reserved.booking.event.id,
        );
        const scheduled = schedulePublicBooking(latest, {
          id: reserved.booking.event.id,
          ...(approvalRequired ? { bookingRequestId: bookingAttemptId } : {}),
          ...(reserved.booking.providerHtmlLink
            ? { providerHtmlLink: reserved.booking.providerHtmlLink }
            : {}),
          ...(reserved.booking.providerJoinUrl
            ? { providerJoinUrl: reserved.booking.providerJoinUrl }
            : {}),
          title: eventType.title,
          calendarId: eventType.destinationCalendarId,
          start: selectedSlot,
          end,
          location: eventType.location,
          attendees: [attendee],
          approvalRequired,
          eventTypeId: eventType.id,
          requestedAt,
        });
        domainError = scheduled.error;
        alreadyReconciled = alreadyReconciled && scheduled.error === null;
        return scheduled.state;
      });
      if (changed || alreadyReconciled) {
        await onProviderReconciled(bookingAttemptId, reserved.booking);
        setStep("success");
        announce(approvalRequired ? "Booking request submitted." : "Booking confirmed.");
      } else {
        setError(domainError ?? "This time could not be reserved. Choose another slot and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div ref={overlayRef} className="public-preview-overlay" role="dialog" aria-modal="true" aria-label={`${eventType.title} public booking page`}>
      <div className="public-booking-shell">
        <button ref={closeButtonRef} type="button" className="public-booking-close" onClick={onClose} aria-label="Close public booking page"><X aria-hidden="true" /></button>
        {step === "success" ? (
          <div className="public-booking-card public-booking-card-success" data-step="success">
          <section className="booking-success public-booking-success" aria-labelledby="public-preview-title">
            <span><Check /></span>
            <h1 ref={stepHeadingRef} tabIndex={-1} id="public-preview-title">{eventType.approvalRequired ? "Your request is pending" : "You’re booked"}</h1>
            <p>{eventType.approvalRequired
              ? `${profile.displayName} will review your request. We sent a secure management link to ${email}.`
              : `A calendar invitation and secure cancel/reschedule link are on their way to ${email}.`}</p>
            <div className="public-booking-confirmation">
              <strong>{eventType.title}</strong>
              <span>{selectedSlot ? viewerDateTimeFormatter.format(new Date(selectedSlot)) : ""}</span>
              <span>{meetingLocationNames[eventType.location]}</span>
            </div>
            <Button type="button" size="lg" onClick={onClose}>Done</Button>
          </section>
          </div>
        ) : (
          <div className="public-booking-card" data-step={step} aria-labelledby="public-preview-title">
            <aside className="public-booking-info">
              <div className="public-booking-host">
                <span className="public-booking-avatar" aria-hidden="true">{profile.displayName.split(" ").map(word => word[0]).join("").slice(0, 2)}</span>
                <strong>{profile.displayName}</strong>
              </div>
              <h1 id="public-preview-title" className="public-booking-title">{eventType.title}</h1>
              {eventType.description ? <p className="public-booking-description">{eventType.description}</p> : null}
              <ul className="public-booking-meta">
                <li><Clock3 aria-hidden="true" /><span>{eventType.durationMinutes} minutes</span></li>
                <li><Video aria-hidden="true" /><span>{meetingLocationNames[eventType.location]}</span></li>
                {eventType.approvalRequired ? <li><ShieldCheck aria-hidden="true" /><span>Host approval required</span></li> : null}
              </ul>
              <div className="public-booking-note"><CircleUserRound aria-hidden="true" /><span>No TAP account is required to book.</span></div>
            </aside>
            <section className="public-booking-main">
              {step === "date" ? (
                <section className="public-booking-date-step" aria-labelledby="public-booking-date-heading">
                  <header className="public-booking-step-header">
                    <h2 ref={stepHeadingRef} tabIndex={-1} id="public-booking-date-heading">Select a Date &amp; Time</h2>
                  </header>
                  {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
                  <nav className="public-booking-month-nav" aria-label="Booking month">
                    <button type="button" className="public-booking-month-button" aria-label="Previous month" disabled={!canPageBackward} onClick={() => {
                      const nextMonth = addCalendarMonths(visibleMonth, -1);
                      setVisibleMonth(nextMonth);
                      onAvailabilityAnchorChange(nextMonth);
                      setSelectedSlot(null);
                      setError(null);
                      bookingAttemptRef.current = null;
                    }}><ChevronLeft aria-hidden="true" /></button>
                    <strong className="public-booking-month-title">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonthDate)}</strong>
                    <button type="button" className="public-booking-month-button" aria-label="Next month" disabled={!canPageForward} onClick={() => {
                      const nextMonth = addCalendarMonths(visibleMonth, 1);
                      setVisibleMonth(nextMonth);
                      onAvailabilityAnchorChange(nextMonth);
                      setSelectedSlot(null);
                      setError(null);
                      bookingAttemptRef.current = null;
                    }}><ChevronRight aria-hidden="true" /></button>
                  </nav>
                  <div className="public-booking-calendar" aria-label={new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(visibleMonthDate)} aria-busy={!currentPageCovered}>
                    <div className="public-booking-weekdays" aria-hidden="true">
                      {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map(day => <span key={day}>{day}</span>)}
                    </div>
                    <div className="public-booking-days">
                      {publicDates.map(date => {
                        const parsed = parseCalendarDate(date);
                        const inVisibleMonth = date >= visibleMonth && date < visibleMonthEnd;
                        const selectable = currentPageCovered && inVisibleMonth && date >= viewerToday && slotsByViewerDate.has(date);
                        const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
                        return <button
                          type="button"
                          className="public-booking-day"
                          key={date}
                          aria-label={selectable ? `${dateLabel}, view available times` : `${dateLabel}, unavailable`}
                          aria-current={date === viewerToday ? "date" : undefined}
                          aria-pressed={date === selectedDate}
                          data-selected={date === selectedDate}
                          data-today={date === policyToday}
                          data-outside-month={!inVisibleMonth}
                          data-available={selectable}
                          disabled={!selectable}
                          onClick={() => {
                        setSelectedDate(date);
                        setSelectedSlot(null);
                        setError(null);
                        bookingAttemptRef.current = null;
                        setStep("slot");
                      }}><span>{parsed.getUTCDate()}</span>{selectable ? <i aria-hidden="true" /> : null}</button>;
                      })}
                    </div>
                  </div>
                  {!currentPageCovered ? (
                    <div className="public-booking-calendar-status" role="status">
                      <RefreshCw className={availabilitySyncState.status === "error" ? undefined : "is-spinning"} aria-hidden="true" />
                      <span>{availabilitySyncState.status === "error" ? "Calendar availability could not be checked." : "Checking calendar availability…"}</span>
                      {availabilitySyncState.status === "error" || availabilitySyncState.status === "partial" ? <Button type="button" variant="ghost" size="sm" onClick={onRefreshAvailability}><RefreshCw data-icon="inline-start" /> Try again</Button> : null}
                    </div>
                  ) : null}
                  {currentPageCovered && !hasAvailableDatesInVisibleMonth ? (
                    <div className="public-booking-calendar-status" role="status"><CalendarClock aria-hidden="true" /><span>{activeSchedule ? "No dates are available this month." : "This booking page's Availability Schedule is unavailable."}</span></div>
                  ) : null}
                  <div className="public-booking-timezone">
                    <Globe2 aria-hidden="true" />
                    <TimeZoneCombobox
                      className="public-booking-timezone-field"
                      label="Viewer time zone"
                      name="public-booking-timezone"
                      value={viewerTimeZone}
                      onValueChange={changeViewerTimeZone}
                      referenceInstant={selectedSlot ? Date.parse(selectedSlot) : Date.parse(`${visibleMonth}T12:00:00.000Z`)}
                      description="All dates and times are shown in this time zone."
                      required
                    />
                  </div>
                </section>
              ) : step === "slot" ? (
                <section className="public-booking-slots-pane" aria-labelledby="public-booking-slots-heading">
                  <button type="button" className="public-booking-back" onClick={() => setStep("date")}><ArrowLeft aria-hidden="true" /> Back to calendar</button>
                  <header className="public-booking-step-header">
                    <span className="eyebrow">Available times</span>
                    <h2 ref={stepHeadingRef} tabIndex={-1} id="public-booking-slots-heading">{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(parseCalendarDate(selectedDate))}</h2>
                    <p>{timeZoneDisplayLabelForDate(selectedDate, viewerTimeZone, "12:00")} · every option includes its local date and time.</p>
                  </header>
                  {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
                  <div className="slot-list public-booking-slots-list">
                    {currentPageCovered ? slots.map(slot => <button type="button" key={slot.start} className="public-booking-slot" data-selected={selectedSlot === slot.start} aria-pressed={selectedSlot === slot.start} onClick={() => {
                      setSelectedSlot(slot.start);
                      setError(null);
                      bookingAttemptRef.current = null;
                      void onCommit(current => trackFunnel(current, eventType.id, "slotViews"));
                    }}><span>{viewerDateTimeFormatter.format(new Date(slot.start))}</span>{selectedSlot === slot.start ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button>) : (
                      <div className="empty-calendar public-booking-empty" role="status">
                        <RefreshCw className={availabilitySyncState.status === "error" ? undefined : "is-spinning"} />
                        <strong>{availabilitySyncState.status === "error" ? "Calendar conflicts could not be checked" : availabilitySyncState.status === "partial" ? "Some calendars could not be checked" : "Checking calendar conflicts"}</strong>
                        <span>Times stay unavailable until every Conflict Calendar is covered.</span>
                        {availabilitySyncState.status === "error" || availabilitySyncState.status === "partial" ? <Button type="button" variant="outline" onClick={onRefreshAvailability}><RefreshCw data-icon="inline-start" /> Try again</Button> : null}
                      </div>
                    )}
                    {currentPageCovered && slots.length === 0 ? <div className="empty-calendar public-booking-empty"><CalendarClock /><strong>No times on this date</strong><span>{activeSchedule ? "No times remain after conflicts and booking rules are applied." : "This booking page's Availability Schedule is unavailable."}</span></div> : null}
                  </div>
                  <div className="public-booking-actions"><Button type="button" size="lg" disabled={!selectedSlot || !selectedSlotIsAvailable} onClick={() => setStep("details")}>Continue</Button></div>
                </section>
              ) : (
                <form className="public-details public-booking-details" onSubmit={submit}>
                  <button type="button" className="public-booking-back" onClick={() => setStep("slot")}><ArrowLeft aria-hidden="true" /> Choose another time</button>
                  <header className="public-booking-step-header"><span className="eyebrow">Your details</span><h2 ref={stepHeadingRef} tabIndex={-1}>Almost there</h2><p>We use this information only for this booking and its notifications.</p></header>
                  <div className="public-booking-selected-time"><CalendarCheck2 aria-hidden="true" /><span><strong>{selectedSlot ? viewerDateTimeFormatter.format(new Date(selectedSlot)) : ""}</strong><small>{eventType.durationMinutes} minutes · {meetingLocationNames[eventType.location]}</small></span></div>
                  {error ? <div className="dialog-warning" role="alert"><AlertTriangle /><span>{error}</span></div> : null}
                  <FieldGroup className="public-booking-fields">
                    <Field>
                      <FieldLabel htmlFor="public-booking-name">Name</FieldLabel>
                      <Input id="public-booking-name" name="name" autoComplete="name" value={name} required disabled={submitting} onChange={event => setName(event.currentTarget.value)} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="public-booking-email">Email</FieldLabel>
                      <Input id="public-booking-email" name="email" type="email" autoComplete="email" spellCheck={false} value={email} required disabled={submitting} onChange={event => setEmail(event.currentTarget.value)} />
                      <FieldDescription>No email verification step is required.</FieldDescription>
                    </Field>
                  </FieldGroup>
                  <div className="public-booking-actions"><Button type="submit" size="lg" disabled={submitting || !selectedSlotIsAvailable}>{submitting ? "Reserving…" : eventType.approvalRequired ? "Request meeting" : "Confirm booking"}</Button></div>
                </form>
              )}
            </section>
          </div>
        )}
        <footer className="public-footer public-booking-footer">
          <a className="public-booking-powered" href="https://theaiplatform.app/" target="_blank" rel="noreferrer" aria-label="Powered by TAP — visit The AI Platform homepage (opens in a new tab)"><CalendarCheck2 aria-hidden="true" /> Powered by <strong>TAP</strong></a>
          <nav className="public-booking-footer-links" aria-label="Booking page links">
            <a href="https://theaiplatform.app/privacy" target="_blank" rel="noreferrer">Privacy</a>
            <span aria-hidden="true">·</span>
            <a href="mailto:abuse@theaiplatform.app">Report abuse</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}

function EventDrawer({ event, state, onClose }: { readonly event: CalendarEvent; readonly state: CalendarState; readonly onClose: () => void }) {
  const calendar = allCalendars(state).find(item => item.id === event.calendarId);
  return (
    <aside className="event-drawer" role="dialog" aria-modal="false" aria-labelledby="event-drawer-title">
      <header><span className="eyebrow">{event.kind.replace("-", " ")}</span><button className="icon-button" type="button" onClick={onClose} aria-label="Close event details"><X /></button></header>
      <span className="event-drawer-color" style={{ background: calendar?.color }} />
      <h2 id="event-drawer-title">{event.title}</h2>
      <div className="event-detail-list"><p><CalendarDays /><span><strong>{dateTimeFormatter.format(new Date(event.start))}</strong><small>Ends {timeFormatter.format(new Date(event.end))}</small></span></p><p><Video /><span><strong>{event.location ? meetingLocationNames[event.location] : "No meeting location"}</strong><small>{event.location?.startsWith("tap-") ? "External guest access is confirmed at booking" : "Guest policy checked at booking"}</small></span></p><p><Cloud /><span><strong>{calendar?.name}</strong><small>{calendar?.role} · {calendar?.freshness}</small></span></p>{event.source ? <p><Link2 /><span><strong>{event.source.label}</strong><small>Private TAP context stays in TAP</small></span></p> : null}</div>
      <section className="attendee-list"><span className="eyebrow">Attendees</span>{event.attendees.map(attendee => <div key={attendee.id}><span>{attendee.name.split(" ").map(word => word[0]).join("")}</span><p><strong>{attendee.name}</strong><small>{attendee.email} · {attendee.kind}</small></p><CheckCircle2 /></div>)}</section>
      <footer>{event.providerJoinUrl ? <a className="primary-button" href={event.providerJoinUrl} target="_blank" rel="noreferrer"><Video /> Join meeting</a> : null}{event.providerHtmlLink ? <a className="secondary-button" href={event.providerHtmlLink} target="_blank" rel="noreferrer"><ExternalLink /> Open in provider</a> : null}<button type="button" className="secondary-button" disabled title="Secure rescheduling is completed by the Calendar gateway.">Reschedule</button><button type="button" className="text-button danger-text" disabled title="Secure cancellation is completed by the Calendar gateway.">Cancel</button></footer>
    </aside>
  );
}

function Modal({ title, description, onClose, children }: { readonly title: string; readonly description: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const previouslyFocused = globalThis.document.activeElement as HTMLElement | null;
    const initialFocus = cardRef.current?.querySelector<HTMLElement>(
      "[data-modal-initial-focus]:not([disabled])",
    );
    (initialFocus ?? closeRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') ?? [])].filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={cardRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">
        <header><div><span className="eyebrow">TAP Calendar</span><h2 id="modal-title">{title}</h2><p id="modal-description">{description}</p></div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X /></button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function DialogActions({ onCancel, submitLabel, submitting = false }: { readonly onCancel: () => void; readonly submitLabel: string; readonly submitting?: boolean }) {
  return <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>Cancel</button><button type="submit" className="primary-button" disabled={submitting}><CalendarCheck2 /> {submitting ? "Saving…" : submitLabel}</button></div>;
}

function ProductEmptyState({ icon, title, description, action }: { readonly icon: ReactNode; readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return <section className="product-empty-state"><span>{icon}</span><h2>{title}</h2><p>{description}</p>{action ? <div>{action}</div> : null}</section>;
}

function MetricCard({ icon, label, value, detail, tone, actionLabel, onAction }: { readonly icon: ReactNode; readonly label: string; readonly value: string; readonly detail: string; readonly tone: "blue" | "green" | "violet" | "orange"; readonly actionLabel?: string; readonly onAction?: () => void }) {
  return <article className={`metric-card panel metric-${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p>{actionLabel && onAction ? <button type="button" className="metric-card-action" onClick={onAction}>{actionLabel}<ChevronRight /></button> : null}</div></article>;
}

function ToolCard({ name, description, output }: { readonly name: string; readonly description: string; readonly output: string }) {
  return <article className="tool-card panel"><header><span><Bot /></span><code>{name}</code><span className="status-chip status-confirmed">Available</span></header><p>{description}</p><footer><ShieldCheck /><span>{output}</span></footer></article>;
}

function MoonIcon() {
  return <Clock3 />;
}
