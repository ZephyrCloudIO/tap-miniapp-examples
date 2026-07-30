import type { MiniAppPlatformApi } from "@theaiplatform/miniapp-sdk";
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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  H1,
  H2,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@theaiplatform/miniapp-sdk/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  compareAsc,
  endOfMonth,
  endOfYear,
  format,
  parseISO,
  startOfMonth,
  startOfYear,
} from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useState } from "react";
import { flushSync } from "react-dom";

import {
  acceptProposal,
  createTrip,
  deleteTimelineItem,
  deleteTrip,
  engagementTypeSchema,
  extractImpactReportFromText,
  extractProposalFromText,
  itineraryItemKindSchema,
  metricConfidenceSchema,
  type RoadieDocument,
  type TimelineItem,
  type Trip,
  tripPurposeSchema,
  updateEngagementOutcome,
  updateShareSettings,
  updateTimelineItem,
  updateTripImpactReport,
} from "./domain";
import { impactYears, summarizeImpact } from "./impact";
import {
  deleteAllRoadieData,
  loadRoadieDocument,
  saveRoadieDocument,
  type StoredRoadieDocument,
} from "./storage";
import {
  DEFAULT_IMPACT_SHARE_OPTIONS,
  impactDigestShareText,
  type ImpactShareOptions,
  tripImpactShareText,
  tripShareText,
  upcomingEngagementsShareText,
} from "./share";
import { createSharedTrip, getWorkspaceContext, listSharedTrips } from "./roadie-api";

const ROADIE_QUERY_KEY = ["roadie", "document"] as const;
const EXAMPLE_TEXT = `Subject: React Summit speaker confirmation

You are confirmed to speak at React Summit in Amsterdam.
Your talk "Shipping AI interfaces that users can trust" is on 12 June 2026 at 14:30 CEST.
Please arrive at the speaker room 30 minutes before your session.`;

const PURPOSE_LABELS: Readonly<Record<Trip["purpose"], string>> = {
  conference: "Conference",
  meetup: "Meetup",
  podcast: "Podcast",
  work: "Work trip",
  personal: "Personal",
  other: "Other",
};

const PURPOSE_STYLES: Readonly<Record<Trip["purpose"], string>> = {
  conference: "bg-roadie-pink",
  meetup: "bg-roadie-lime",
  podcast: "bg-roadie-tangerine",
  work: "bg-roadie-sky",
  personal: "bg-roadie-violet",
  other: "bg-roadie-coral",
};

const ENGAGEMENT_LABELS: Readonly<Record<NonNullable<TimelineItem["engagementType"]>, string>> = {
  talk: "Talk",
  panel: "Panel discussion",
  workshop: "Workshop",
  podcast: "Podcast",
  interview: "Interview",
  keynote: "Keynote",
  livestream: "Livestream",
};

const ITEM_KIND_LABELS: Readonly<Record<TimelineItem["kind"], string>> = {
  talk: "Talk or session",
  social: "Dinner or social",
  meeting: "Meeting",
  travel: "Travel",
  hotel: "Accommodation",
  personal: "Personal",
  other: "Other",
};

const ITEM_KIND_STYLES: Readonly<Record<TimelineItem["kind"], string>> = {
  talk: "border-roadie-pink bg-roadie-pink/10",
  social: "border-roadie-lime bg-roadie-lime/10",
  meeting: "border-roadie-tangerine bg-roadie-tangerine/10",
  travel: "border-roadie-sky bg-roadie-sky/10",
  hotel: "border-roadie-violet bg-roadie-violet/10",
  personal: "border-roadie-coral bg-roadie-coral/10",
  other: "border-roadie-ink bg-roadie-ink/5",
};

type RoadieAppProps = {
  context: TapFederatedSurfaceMountContext;
  platform: MiniAppPlatformApi;
};

type EngagementType = NonNullable<TimelineItem["engagementType"]>;
type UpdateType = "upcoming-engagements" | "trip-plans" | "trip-impact" | "impact-digest";

const UPDATE_TYPE_LABELS: Readonly<Record<UpdateType, string>> = {
  "upcoming-engagements": "Upcoming engagements",
  "trip-plans": "Trip plans",
  "trip-impact": "Trip impact",
  "impact-digest": "Impact digest",
};

function now(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Roadie could not complete that action.";
}

function tripDateLabel(trip: Trip): string {
  if (trip.timeline.length === 0) return "Dates not added yet";
  const sorted = trip.timeline.toSorted((left, right) => compareAsc(left.start, right.start));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return "Dates not added yet";
  const firstDate = formatInTimeZone(first.start, first.timeZone, "d MMM yyyy");
  const lastDate = formatInTimeZone(last.start, last.timeZone, "d MMM yyyy");
  return firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;
}

export function RoadieApp({ context, platform }: RoadieAppProps) {
  const queryClient = useQueryClient();
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [newItemKind, setNewItemKind] = useState<TimelineItem["kind"] | "auto">("auto");
  const [newEngagementType, setNewEngagementType] = useState<EngagementType | "auto" | "none">(
    "auto",
  );
  const [shareStatus, setShareStatus] = useState<{
    kind: "sending" | "success" | "error";
    message: string;
  } | null>(null);
  const [itemStatus, setItemStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteTripOpen, setDeleteTripOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<TimelineItem | null>(null);
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editLocalDateTime, setEditLocalDateTime] = useState("");
  const [editTimeZone, setEditTimeZone] = useState("");
  const [editKind, setEditKind] = useState<TimelineItem["kind"]>("personal");
  const [editEngagementType, setEditEngagementType] = useState<EngagementType | "none">("none");
  const [editAudienceCount, setEditAudienceCount] = useState("");
  const [editAudienceConfidence, setEditAudienceConfidence] = useState<
    "confirmed" | "estimated" | "derived"
  >("estimated");
  const [editOutcomeHighlight, setEditOutcomeHighlight] = useState("");
  const [editOutcomeText, setEditOutcomeText] = useState("");
  const [editFollowUpCount, setEditFollowUpCount] = useState("");
  const [shareMode, setShareMode] = useState<UpdateType | null>(null);
  const [shareDraft, setShareDraft] = useState("");
  const [selectedShareChannelId, setSelectedShareChannelId] = useState("");
  const [impactShareOptions, setImpactShareOptions] = useState<ImpactShareOptions>(
    DEFAULT_IMPACT_SHARE_OPTIONS,
  );
  const [digestPeriod, setDigestPeriod] = useState<"month" | "year">("month");
  const [digestMonth, setDigestMonth] = useState(format(new Date(), "yyyy-MM"));
  const [homeView, setHomeView] = useState<"trips" | "reports" | "impact">("trips");
  const [impactYear, setImpactYear] = useState(new Date().getFullYear());
  const [impactReportOpen, setImpactReportOpen] = useState(false);
  const [impactReportText, setImpactReportText] = useState("");
  const [impactEventAttendance, setImpactEventAttendance] = useState("");
  const [impactAttendanceConfidence, setImpactAttendanceConfidence] = useState<
    "confirmed" | "estimated" | "derived"
  >("estimated");
  const [impactFollowUpCount, setImpactFollowUpCount] = useState("");
  const [impactOutcomes, setImpactOutcomes] = useState("");
  const [impactSponsorValue, setImpactSponsorValue] = useState("");
  const [impactPrivateReflection, setImpactPrivateReflection] = useState("");
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newTripLocation, setNewTripLocation] = useState("");
  const [newTripPurpose, setNewTripPurpose] = useState<Trip["purpose"]>("conference");
  const [sharedTripTitle, setSharedTripTitle] = useState("");
  const queryKey = [...ROADIE_QUERY_KEY, context.workspaceId ?? "personal"];

  const documentQuery = useQuery({
    queryKey,
    queryFn: () => loadRoadieDocument(platform.storage, now()),
  });
  const channelsQuery = useQuery({
    queryKey: ["roadie", "channels", context.workspaceId ?? "personal"],
    queryFn: () => platform.channels.list(),
    enabled: shareMode !== null,
  });
  const workspaceContextQuery = useQuery({
    queryKey: ["roadie", "workspace-context", context.workspaceId],
    queryFn: () => getWorkspaceContext(platform.http, context.workspaceId ?? ""),
    enabled: context.workspaceId !== undefined,
  });
  const sharedTripsQuery = useQuery({
    queryKey: ["roadie", "shared-trips", context.workspaceId],
    queryFn: () => listSharedTrips(platform.http, context.workspaceId ?? ""),
    enabled: context.workspaceId !== undefined,
  });
  const createSharedTripMutation = useMutation({
    mutationFn: () => {
      if (!context.workspaceId) {
        throw new Error("Open Roadie in a workspace to add a shared trip.");
      }
      return createSharedTrip(platform.http, {
        workspaceId: context.workspaceId,
        requestId: context.entropy.randomUUID(),
        title: sharedTripTitle.trim(),
        purpose: "ROADIE_TRIP_PURPOSE_WORK",
      });
    },
    onSuccess: async () => {
      setSharedTripTitle("");
      await queryClient.invalidateQueries({
        queryKey: ["roadie", "shared-trips", context.workspaceId],
      });
    },
  });

  const storeMutation = useMutation({
    mutationFn: ({
      current,
      document,
    }: {
      current: StoredRoadieDocument;
      document: RoadieDocument;
    }) => saveRoadieDocument(platform.storage, current, document),
    onSuccess: (stored) => {
      queryClient.setQueryData(queryKey, stored);
      setActionError(null);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const deleteAllMutation = useMutation({
    mutationFn: (stored: StoredRoadieDocument) =>
      deleteAllRoadieData(platform.storage, stored.revision),
    onSuccess: () => {
      queryClient.setQueryData(queryKey, undefined);
      void queryClient.invalidateQueries({ queryKey });
      setActiveTripId(null);
      setPastedText("");
      setShareStatus(null);
      setDeleteAllOpen(false);
      setActionError(null);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  if (documentQuery.isPending) {
    return (
      <main
        className="bg-background text-foreground grid min-h-full place-items-center p-6"
        data-component="RoadieApp"
      >
        <p className="text-muted-foreground text-sm">Opening Roadie…</p>
      </main>
    );
  }

  if (documentQuery.isError) {
    return (
      <main
        className="bg-background text-foreground grid min-h-full place-items-center p-6"
        data-component="RoadieApp"
      >
        <Alert variant="destructive">
          <AlertTitle>Roadie could not open its saved data</AlertTitle>
          <AlertDescription>{errorMessage(documentQuery.error)}</AlertDescription>
        </Alert>
      </main>
    );
  }

  const stored = documentQuery.data;
  const trips = stored.document.trips;
  const activeTrip = activeTripId
    ? trips.find((candidate) => candidate.id === activeTripId)
    : undefined;
  const busy = storeMutation.isPending || deleteAllMutation.isPending;

  const confirmNewTrip = () => {
    const title = newTripTitle.trim();
    if (title.length === 0) return;
    const createdAt = now();
    const trip = createTrip({
      id: context.entropy.randomUUID(),
      location: newTripLocation,
      now: createdAt,
      purpose: newTripPurpose,
      title,
    });
    storeMutation.mutate(
      {
        current: stored,
        document: {
          ...stored.document,
          trips: [...trips, trip],
          updatedAt: createdAt,
        },
      },
      {
        onSuccess: () => {
          setNewTripOpen(false);
          setNewTripTitle("");
          setNewTripLocation("");
          setNewTripPurpose("conference");
          setActiveTripId(trip.id);
        },
      },
    );
  };

  const addPastedItem = () => {
    if (!activeTrip) return;
    setItemStatus(null);
    try {
      const createdAt = now();
      const proposal = extractProposalFromText({
        capturedAt: createdAt,
        id: context.entropy.randomUUID(),
        ...(newItemKind === "auto" ? {} : { kind: newItemKind }),
        ...(newEngagementType === "auto" || newEngagementType === "none"
          ? {}
          : { engagementType: newEngagementType }),
        text: pastedText,
      });
      const document = acceptProposal({
        document: stored.document,
        now: createdAt,
        proposal,
        tripId: activeTrip.id,
      });
      storeMutation.mutate(
        { current: stored, document },
        {
          onSuccess: () => {
            setPastedText("");
            setNewItemKind("auto");
            setNewEngagementType("auto");
            setItemStatus({
              kind: "success",
              message: `${proposal.title} was added to the itinerary.`,
            });
          },
          onError: (error) => setItemStatus({ kind: "error", message: errorMessage(error) }),
        },
      );
    } catch (error) {
      setItemStatus({ kind: "error", message: errorMessage(error) });
    }
  };

  const beginEditItem = (item: TimelineItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditLocalDateTime(formatInTimeZone(item.start, item.timeZone, "yyyy-MM-dd'T'HH:mm"));
    setEditTimeZone(item.timeZone);
    setEditKind(item.kind);
    setEditEngagementType(item.engagementType ?? "none");
    setEditAudienceCount(
      item.outcome?.audienceCount === undefined ? "" : String(item.outcome.audienceCount),
    );
    setEditAudienceConfidence(item.outcome?.audienceConfidence ?? "estimated");
    setEditOutcomeHighlight(item.outcome?.highlight ?? "");
    setEditOutcomeText(item.outcome?.outcome ?? "");
    setEditFollowUpCount(
      item.outcome?.followUpCount === undefined ? "" : String(item.outcome.followUpCount),
    );
  };

  const saveEditedItem = () => {
    if (!activeTrip || !editingItem) return;
    try {
      const updatedAt = now();
      const { outcome: _outcome, ...itemWithoutOutcome } = editingItem;
      const timelineDocument = updateTimelineItem({
        document: stored.document,
        item: {
          ...itemWithoutOutcome,
          title: editTitle.trim(),
          kind: editKind,
          ...(editEngagementType === "none"
            ? { engagementType: null }
            : { engagementType: editEngagementType }),
          start: fromZonedTime(editLocalDateTime, editTimeZone.trim()).toISOString(),
          timeZone: editTimeZone.trim(),
        },
        now: updatedAt,
        tripId: activeTrip.id,
      });
      const hasOutcome =
        editAudienceCount.trim().length > 0 ||
        editOutcomeHighlight.trim().length > 0 ||
        editOutcomeText.trim().length > 0 ||
        editFollowUpCount.trim().length > 0;
      const document =
        editEngagementType === "none" || !hasOutcome
          ? timelineDocument
          : updateEngagementOutcome({
              document: timelineDocument,
              itemId: editingItem.id,
              now: updatedAt,
              outcome: {
                ...(editAudienceCount.trim()
                  ? {
                      audienceCount: Number.parseInt(editAudienceCount, 10),
                      audienceConfidence: editAudienceConfidence,
                    }
                  : {}),
                ...(editOutcomeHighlight.trim() ? { highlight: editOutcomeHighlight.trim() } : {}),
                ...(editOutcomeText.trim() ? { outcome: editOutcomeText.trim() } : {}),
                ...(editFollowUpCount.trim()
                  ? {
                      followUpCount: Number.parseInt(editFollowUpCount, 10),
                    }
                  : {}),
                links: editingItem.outcome?.links ?? [],
                updatedAt,
              },
              tripId: activeTrip.id,
            });
      storeMutation.mutate(
        { current: stored, document },
        { onSuccess: () => setEditingItem(null) },
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const beginImpactReport = () => {
    if (!activeTrip) return;
    const report = activeTrip.impactReport;
    setImpactReportText(report?.sourceText ?? "");
    setImpactEventAttendance(
      report?.eventAttendance === undefined ? "" : String(report.eventAttendance),
    );
    setImpactAttendanceConfidence(report?.attendanceConfidence ?? "estimated");
    setImpactFollowUpCount(report?.followUpCount === undefined ? "" : String(report.followUpCount));
    setImpactOutcomes(report?.outcomes ?? "");
    setImpactSponsorValue(report?.sponsorValue ?? "");
    setImpactPrivateReflection(report?.privateReflection ?? "");
    setImpactReportOpen(true);
  };

  const saveImpactReport = () => {
    if (!activeTrip) return;
    try {
      const updatedAt = now();
      const extracted = extractImpactReportFromText({
        ...(activeTrip.impactReport ? { existing: activeTrip.impactReport } : {}),
        now: updatedAt,
        text: impactReportText,
      });
      const report = {
        ...extracted,
        ...(impactEventAttendance.trim()
          ? {
              eventAttendance: Number.parseInt(impactEventAttendance, 10),
              attendanceConfidence: impactAttendanceConfidence,
            }
          : {}),
        ...(impactFollowUpCount.trim()
          ? { followUpCount: Number.parseInt(impactFollowUpCount, 10) }
          : {}),
        ...(impactOutcomes.trim() ? { outcomes: impactOutcomes.trim() } : {}),
        ...(impactSponsorValue.trim() ? { sponsorValue: impactSponsorValue.trim() } : {}),
        ...(impactPrivateReflection.trim()
          ? { privateReflection: impactPrivateReflection.trim() }
          : {}),
      };
      const document = updateTripImpactReport({
        document: stored.document,
        now: updatedAt,
        report,
        tripId: activeTrip.id,
      });
      storeMutation.mutate(
        { current: stored, document },
        { onSuccess: () => setImpactReportOpen(false) },
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const confirmDeleteItem = () => {
    if (!activeTrip || !itemToDelete) return;
    const document = deleteTimelineItem({
      document: stored.document,
      itemId: itemToDelete.id,
      now: now(),
      tripId: activeTrip.id,
    });
    storeMutation.mutate({ current: stored, document }, { onSuccess: () => setItemToDelete(null) });
  };

  const confirmDeleteTrip = () => {
    if (!activeTrip) return;
    storeMutation.mutate(
      {
        current: stored,
        document: deleteTrip(stored.document, activeTrip.id, now()),
      },
      {
        onSuccess: () => {
          setDeleteTripOpen(false);
          setActiveTripId(null);
        },
      },
    );
  };

  const sendShareDraft = async () => {
    if (!shareDraft.trim() || !shareMode) return;
    flushSync(() => setShareMode(null));
    setShareStatus({
      kind: "sending",
      message: "Choose a chat destination to send this message.",
    });
    try {
      await platform.chat.sendTextToChat(shareDraft.trim());
      setShareStatus({
        kind: "success",
        message: "Message sent.",
      });
      setActionError(null);
    } catch (error) {
      setShareStatus({ kind: "error", message: errorMessage(error) });
    }
  };

  const digestRange = (period = digestPeriod, month = digestMonth, year = impactYear) => {
    const reference = period === "month" ? parseISO(`${month}-01`) : new Date(year, 0, 1);
    return {
      start: period === "month" ? startOfMonth(reference) : startOfYear(reference),
      end: period === "month" ? endOfMonth(reference) : endOfYear(reference),
      label: period === "month" ? format(reference, "MMMM yyyy") : String(year),
    };
  };

  const shareDraftFor = (
    type: UpdateType,
    options = impactShareOptions,
    period = digestPeriod,
    month = digestMonth,
    year = impactYear,
    tripOverride?: Trip,
  ) => {
    const selectedTrip = tripOverride ?? activeTrip;
    if (type === "upcoming-engagements") {
      return upcomingEngagementsShareText(trips, new Date());
    }
    if (type === "trip-plans") {
      return selectedTrip ? tripShareText(selectedTrip) : "";
    }
    if (type === "trip-impact") {
      return selectedTrip ? tripImpactShareText(selectedTrip, options) : "";
    }
    return impactDigestShareText(trips, digestRange(period, month, year), options);
  };

  const savedDestinationFor = (type: UpdateType) => {
    if (type === "upcoming-engagements") {
      return stored.document.shareSettings.upcomingEngagements;
    }
    if (type === "trip-impact") {
      return stored.document.shareSettings.tripImpact;
    }
    if (type === "impact-digest") {
      return stored.document.shareSettings.impactDigest;
    }
    return undefined;
  };

  const openUpdate = (type: UpdateType, tripOverride?: Trip) => {
    const selectedTrip = tripOverride ?? activeTrip;
    if ((type === "trip-plans" || type === "trip-impact") && !selectedTrip) {
      return;
    }
    if (tripOverride) setActiveTripId(tripOverride.id);
    setShareStatus(null);
    setImpactShareOptions(DEFAULT_IMPACT_SHARE_OPTIONS);
    setShareDraft(
      shareDraftFor(
        type,
        DEFAULT_IMPACT_SHARE_OPTIONS,
        digestPeriod,
        digestMonth,
        impactYear,
        tripOverride,
      ),
    );
    setSelectedShareChannelId(savedDestinationFor(type)?.channelId ?? "");
    setShareMode(type);
  };

  const changeUpdateType = (type: UpdateType) => {
    if ((type === "trip-plans" || type === "trip-impact") && !activeTrip) {
      return;
    }
    setShareMode(type);
    setShareDraft(shareDraftFor(type));
    setSelectedShareChannelId(savedDestinationFor(type)?.channelId ?? "");
  };

  const changeImpactShareOption = (key: keyof ImpactShareOptions, checked: boolean) => {
    const options = { ...impactShareOptions, [key]: checked };
    setImpactShareOptions(options);
    if (shareMode) {
      setShareDraft(shareDraftFor(shareMode, options));
    }
  };

  const changeDigestPeriod = (period: "month" | "year") => {
    setDigestPeriod(period);
    if (shareMode === "impact-digest") {
      setShareDraft(shareDraftFor(shareMode, impactShareOptions, period));
    }
  };

  const changeDigestMonth = (month: string) => {
    setDigestMonth(month);
    if (shareMode === "impact-digest") {
      setShareDraft(shareDraftFor(shareMode, impactShareOptions, "month", month));
    }
  };

  const changeDigestYear = (year: number) => {
    setImpactYear(year);
    if (shareMode === "impact-digest") {
      setShareDraft(shareDraftFor(shareMode, impactShareOptions, "year", digestMonth, year));
    }
  };

  const sendShareDirectly = async () => {
    if (!shareMode || !shareDraft.trim() || !selectedShareChannelId) return;
    const channel = channelsQuery.data?.rooms.find(
      (candidate) => candidate.roomId === selectedShareChannelId,
    );
    if (!channel) {
      setShareStatus({
        kind: "error",
        message: "Choose an available channel and try again.",
      });
      return;
    }
    const mode = shareMode;
    flushSync(() => setShareMode(null));
    setShareStatus({
      kind: "sending",
      message: `Sending directly to ${channel.title ?? "the selected channel"}…`,
    });
    try {
      const settingKey =
        mode === "upcoming-engagements"
          ? "upcomingEngagements"
          : mode === "trip-impact"
            ? "tripImpact"
            : mode === "impact-digest"
              ? "impactDigest"
              : null;
      if (settingKey) {
        const document = updateShareSettings(
          stored.document,
          {
            ...stored.document.shareSettings,
            [settingKey]: {
              channelId: channel.roomId,
              channelTitle: channel.title ?? "Channel",
            },
          },
          now(),
        );
        await storeMutation.mutateAsync({ current: stored, document });
      }
      await platform.channels.sendMessage({
        channelId: channel.roomId,
        content: shareDraft.trim(),
        body: shareDraft.trim(),
        name: "Roadie",
      });
      setShareStatus({
        kind: "success",
        message: `Sent directly to ${channel.title ?? "the selected channel"}.`,
      });
      setActionError(null);
    } catch (error) {
      setShareStatus({ kind: "error", message: errorMessage(error) });
    }
  };

  const hasPublicEngagements = trips.some((trip) =>
    trip.timeline.some(
      (item) =>
        item.engagementType !== null && (item.engagementType !== undefined || item.kind === "talk"),
    ),
  );
  const hasUpcomingEngagements = trips.some((trip) =>
    trip.timeline.some(
      (item) =>
        item.engagementType !== null &&
        (item.engagementType !== undefined || item.kind === "talk") &&
        new Date(item.start) >= new Date(),
    ),
  );

  const sortedTimeline =
    activeTrip?.timeline.toSorted((left, right) => compareAsc(left.start, right.start)) ?? [];
  const availableImpactYears = impactYears(trips);
  const impactSummary = summarizeImpact(trips, impactYear);
  const reportedTrips = trips
    .filter(
      (
        trip,
      ): trip is Trip & {
        impactReport: NonNullable<Trip["impactReport"]>;
      } => trip.impactReport !== undefined,
    )
    .toSorted((left, right) =>
      compareAsc(right.impactReport.updatedAt, left.impactReport.updatedAt),
    );

  return (
    <main
      className="bg-roadie-paper text-roadie-ink font-roadie-body h-full overflow-y-auto"
      data-component="RoadieApp"
      data-testid="roadie-app"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 p-5 md:p-10">
        <header className="bg-roadie-ink text-roadie-paper shadow-roadie-ticket border-roadie-ink rounded-roadie-ticket flex flex-col gap-5 border-2 p-6 md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge className="bg-roadie-lime text-roadie-ink w-fit border-0 font-semibold tracking-widest uppercase">
                Travel desk · Issue 01
              </Badge>
              <H1
                className="font-roadie-display text-roadie-paper text-5xl tracking-tight uppercase md:text-7xl"
                data-testid="roadie-heading"
              >
                Roadie
              </H1>
              <p className="text-roadie-paper/75 max-w-2xl text-sm md:text-base">
                Turn confirmations, bookings, and rough notes into one clear itinerary for every
                trip.
              </p>
            </div>
            {activeTrip ? (
              <Button
                data-testid="roadie-back-to-trips-btn"
                onClick={() => {
                  setActiveTripId(null);
                  setShareStatus(null);
                }}
                className="bg-roadie-lime text-roadie-ink border-roadie-ink hover:bg-roadie-tangerine rounded-full border-2 font-semibold"
                variant="secondary"
              >
                All trips
              </Button>
            ) : (
              <Button
                data-testid="roadie-add-trip-btn"
                disabled={busy}
                onClick={() => setNewTripOpen(true)}
                className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full border-0 font-semibold"
              >
                Add trip
              </Button>
            )}
          </div>
        </header>

        {actionError ? (
          <Alert data-testid="roadie-action-error" variant="destructive">
            <AlertTitle>Roadie could not complete that action</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}
        {shareStatus ? (
          <Alert
            className={
              shareStatus.kind === "success" ? "border-roadie-lime bg-roadie-lime/20" : undefined
            }
            data-testid="roadie-share-status"
            variant={shareStatus.kind === "error" ? "destructive" : "default"}
          >
            <AlertTitle>
              {shareStatus.kind === "sending"
                ? "Choose a destination"
                : shareStatus.kind === "success"
                  ? "Message sent"
                  : "Message not sent"}
            </AlertTitle>
            <AlertDescription>{shareStatus.message}</AlertDescription>
          </Alert>
        ) : null}

        <Card
          className="bg-roadie-violet/15 border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-component="RoadieTeamTracer"
          data-testid="roadie-team-tracer"
        >
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                  Workspace service tracer
                </p>
                <CardTitle className="font-roadie-display text-3xl uppercase">
                  Team Roadie
                </CardTitle>
              </div>
              <Badge className="bg-roadie-lime text-roadie-ink border-0">
                {workspaceContextQuery.isSuccess && sharedTripsQuery.isSuccess
                  ? "Connected"
                  : workspaceContextQuery.isPending || sharedTripsQuery.isPending
                    ? "Connecting…"
                    : "Connection failed"}
              </Badge>
            </div>
            <CardDescription className="text-roadie-muted">
              This narrow tracer verifies authenticated workspace membership and trips shared
              through Roadie&apos;s service.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {workspaceContextQuery.isError || sharedTripsQuery.isError ? (
              <Alert data-testid="roadie-team-tracer-error" variant="destructive">
                <AlertTitle>Team service unavailable</AlertTitle>
                <AlertDescription>
                  {errorMessage(workspaceContextQuery.error ?? sharedTripsQuery.error)}
                </AlertDescription>
              </Alert>
            ) : null}
            {workspaceContextQuery.data ? (
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-roadie-ink text-roadie-paper border-0">
                  Signed in as {workspaceContextQuery.data.currentMember?.displayName}
                </Badge>
                <Badge className="border-roadie-ink text-roadie-ink" variant="outline">
                  {workspaceContextQuery.data.members.length} workspace member
                  {workspaceContextQuery.data.members.length === 1 ? "" : "s"}
                </Badge>
                <Badge className="border-roadie-ink text-roadie-ink" variant="outline">
                  {sharedTripsQuery.data?.trips.length ?? 0} shared trip
                  {(sharedTripsQuery.data?.trips.length ?? 0) === 1 ? "" : "s"}
                </Badge>
              </div>
            ) : null}
            {sharedTripsQuery.data?.trips.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {sharedTripsQuery.data.trips.map((trip) => {
                  const owner =
                    workspaceContextQuery.data?.members.find(
                      (member) => member.userId === trip.ownerUserId,
                    )?.displayName ?? trip.ownerUserId;
                  return (
                    <div
                      className="bg-roadie-paper border-roadie-ink rounded-roadie-ticket border p-3"
                      data-testid={`roadie-shared-trip-${trip.tripId}`}
                      key={trip.tripId}
                    >
                      <p className="font-semibold">{trip.title}</p>
                      <p className="text-roadie-muted text-xs">Added by {owner}</p>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Shared trip name"
                data-testid="roadie-shared-trip-title"
                disabled={!workspaceContextQuery.isSuccess}
                onChange={(event) => setSharedTripTitle(event.target.value)}
                placeholder="Add a trip everyone can see"
                value={sharedTripTitle}
              />
              <Button
                className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine"
                data-testid="roadie-add-shared-trip-btn"
                disabled={sharedTripTitle.trim().length === 0 || createSharedTripMutation.isPending}
                onClick={() => createSharedTripMutation.mutate()}
              >
                Add shared trip
              </Button>
            </div>
            {createSharedTripMutation.isError ? (
              <p className="text-destructive text-sm">
                {errorMessage(createSharedTripMutation.error)}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {!activeTrip ? (
          <section
            className="space-y-5"
            data-component="RoadieTripsHome"
            data-testid="roadie-trips-home"
          >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                  {homeView === "trips"
                    ? "Departures board"
                    : homeView === "reports"
                      ? "Travel archive"
                      : "Field report"}
                </p>
                <H2 className="font-roadie-display text-4xl uppercase">
                  {homeView === "trips"
                    ? "Your trips"
                    : homeView === "reports"
                      ? "Travel reports"
                      : "Your impact"}
                </H2>
                <p className="text-roadie-muted mt-1 text-sm">
                  {homeView === "trips"
                    ? "Open a trip to see its complete itinerary."
                    : homeView === "reports"
                      ? "Read through completed field notes and trip outcomes."
                      : "A year of public engagement, reach, and outcomes."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  data-testid="roadie-trips-view-btn"
                  onClick={() => setHomeView("trips")}
                  variant={homeView === "trips" ? "default" : "outline"}
                >
                  Trips
                </Button>
                <Button
                  data-testid="roadie-reports-view-btn"
                  onClick={() => setHomeView("reports")}
                  variant={homeView === "reports" ? "default" : "outline"}
                >
                  Reports
                </Button>
                <Button
                  data-testid="roadie-impact-view-btn"
                  onClick={() => setHomeView("impact")}
                  variant={homeView === "impact" ? "default" : "outline"}
                >
                  Impact
                </Button>
                <Button
                  data-testid="roadie-create-update-btn"
                  disabled={!hasPublicEngagements}
                  onClick={() =>
                    openUpdate(hasUpcomingEngagements ? "upcoming-engagements" : "impact-digest")
                  }
                  className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine rounded-full font-semibold"
                  variant="secondary"
                >
                  Create update
                </Button>
              </div>
            </div>

            {homeView === "impact" ? (
              <div
                className="space-y-5"
                data-component="RoadieImpactDashboard"
                data-testid="roadie-impact-dashboard"
              >
                <div className="flex justify-end">
                  <Select
                    onValueChange={(value) => setImpactYear(Number.parseInt(value, 10))}
                    value={String(impactYear)}
                  >
                    <SelectTrigger data-testid="roadie-impact-year" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(availableImpactYears.length > 0 ? availableImpactYears : [impactYear]).map(
                        (year) => (
                          <SelectItem key={year} value={String(year)}>
                            {year}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Trips", impactSummary.trips, "bg-roadie-sky"],
                    ["Public engagements", impactSummary.publicEngagements, "bg-roadie-pink"],
                    ["Direct audience", impactSummary.directAudience, "bg-roadie-lime"],
                    [
                      "Estimated event reach",
                      impactSummary.estimatedEventReach,
                      "bg-roadie-tangerine",
                    ],
                    ["Locations", impactSummary.locations, "bg-roadie-violet"],
                    ["Follow-ups", impactSummary.followUps, "bg-roadie-coral"],
                    ["Trips reported", impactSummary.reportedTrips, "bg-roadie-sky"],
                  ].map(([label, value, color]) => (
                    <Card
                      className={`${color} border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2`}
                      key={String(label)}
                    >
                      <CardHeader>
                        <CardDescription className="text-roadie-ink font-semibold tracking-wider uppercase">
                          {label}
                        </CardDescription>
                        <CardTitle className="font-roadie-display text-roadie-ink text-5xl">
                          {Number(value).toLocaleString("en")}
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
                <Card className="bg-roadie-card border-roadie-ink rounded-roadie-ticket border-2">
                  <CardHeader>
                    <CardTitle className="font-roadie-display text-3xl uppercase">
                      Engagement mix
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {engagementTypeSchema.options.map((type) => (
                      <Badge
                        className="border-roadie-ink text-roadie-ink rounded-full px-4 py-2"
                        key={type}
                        variant="outline"
                      >
                        {ENGAGEMENT_LABELS[type]}: {impactSummary.engagementCounts[type] ?? 0}
                      </Badge>
                    ))}
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine rounded-full font-semibold"
                      data-testid="roadie-share-impact-digest-btn"
                      disabled={impactSummary.trips === 0}
                      onClick={() => openUpdate("impact-digest")}
                      variant="secondary"
                    >
                      Share impact digest
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            ) : homeView === "reports" ? (
              reportedTrips.length === 0 ? (
                <Empty className="bg-roadie-card border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2">
                  <EmptyHeader>
                    <EmptyTitle>No travel reports yet</EmptyTitle>
                    <EmptyDescription>
                      Complete a trip report after an event to build your searchable impact archive.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <div
                  className="space-y-4"
                  data-component="RoadieReportsLibrary"
                  data-testid="roadie-reports-library"
                >
                  {reportedTrips.map((trip, index) => (
                    <Card
                      className="bg-roadie-card border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket overflow-hidden border-2"
                      data-testid={`roadie-report-card-${trip.id}`}
                      key={trip.id}
                    >
                      <div className={`${PURPOSE_STYLES[trip.purpose]} h-3 w-full`} />
                      <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-roadie-ink text-roadie-paper border-0 tracking-widest uppercase">
                              Report {String(index + 1).padStart(2, "0")}
                            </Badge>
                            <Badge className="border-roadie-ink text-roadie-ink" variant="outline">
                              {PURPOSE_LABELS[trip.purpose]}
                            </Badge>
                          </div>
                          <CardTitle className="font-roadie-display text-roadie-ink text-3xl uppercase">
                            {trip.title}
                          </CardTitle>
                          <CardDescription className="text-roadie-muted">
                            {[trip.location, tripDateLabel(trip)].filter(Boolean).join(" · ")}
                          </CardDescription>
                        </div>
                        <p className="text-roadie-muted text-xs font-semibold tracking-wide uppercase">
                          Updated {format(new Date(trip.impactReport.updatedAt), "d MMM yyyy")}
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <p className="whitespace-pre-wrap">{trip.impactReport.summary}</p>
                        <div className="flex flex-wrap gap-2">
                          {trip.impactReport.eventAttendance !== undefined ? (
                            <Badge className="bg-roadie-tangerine text-roadie-ink border-0">
                              {trip.impactReport.eventAttendance.toLocaleString("en")} attendees
                            </Badge>
                          ) : null}
                          {trip.impactReport.followUpCount !== undefined ? (
                            <Badge className="bg-roadie-sky text-roadie-ink border-0">
                              {trip.impactReport.followUpCount} follow-ups
                            </Badge>
                          ) : null}
                        </div>
                        {trip.impactReport.outcomes ? (
                          <p>
                            <span className="font-semibold">Outcomes:</span>{" "}
                            {trip.impactReport.outcomes}
                          </p>
                        ) : null}
                        {trip.impactReport.sponsorValue ? (
                          <p>
                            <span className="font-semibold">Programme value:</span>{" "}
                            {trip.impactReport.sponsorValue}
                          </p>
                        ) : null}
                      </CardContent>
                      <CardFooter className="border-roadie-ink/20 flex flex-wrap gap-2 border-t border-dashed pt-4">
                        <Button
                          data-testid={`roadie-open-report-trip-btn-${trip.id}`}
                          onClick={() => {
                            setActiveTripId(trip.id);
                            setShareStatus(null);
                          }}
                          variant="outline"
                        >
                          Open trip
                        </Button>
                        <Button
                          className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine"
                          data-testid={`roadie-share-report-btn-${trip.id}`}
                          onClick={() => openUpdate("trip-impact", trip)}
                          variant="secondary"
                        >
                          Share report
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )
            ) : trips.length === 0 ? (
              <Empty className="bg-roadie-card border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2">
                <EmptyHeader>
                  <EmptyTitle>No trips yet</EmptyTitle>
                  <EmptyDescription>
                    Start with a conference, meetup, work visit, or personal journey.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    data-testid="roadie-add-first-trip-btn"
                    disabled={busy}
                    onClick={() => setNewTripOpen(true)}
                    className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full"
                  >
                    Add your first trip
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {trips.map((trip) => (
                  <Card
                    className="group bg-roadie-card border-roadie-ink shadow-roadie-ticket hover:shadow-roadie-ticket-hover rounded-roadie-ticket relative min-h-72 overflow-hidden border-2 transition-all hover:-translate-y-1"
                    data-component="RoadieTripCard"
                    data-testid={`roadie-trip-card-${trip.id}`}
                    key={trip.id}
                  >
                    <div
                      className={`${PURPOSE_STYLES[trip.purpose]} absolute inset-x-0 top-0 h-4`}
                    />
                    <CardHeader className="pt-9">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <Badge className="bg-roadie-ink text-roadie-paper border-0 text-xs tracking-widest uppercase">
                          {PURPOSE_LABELS[trip.purpose]}
                        </Badge>
                        <span className="text-roadie-muted text-xs font-semibold tracking-wide uppercase">
                          {trip.timeline.length} item
                          {trip.timeline.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <CardTitle className="font-roadie-display text-roadie-ink text-3xl leading-none uppercase">
                        {trip.title}
                      </CardTitle>
                      <CardDescription className="text-roadie-muted">
                        {trip.location ?? "Location not added"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="font-roadie-display text-roadie-coral text-2xl font-semibold uppercase">
                        {tripDateLabel(trip)}
                      </p>
                    </CardContent>
                    <CardFooter className="border-roadie-ink/20 mt-auto border-t border-dashed pt-4">
                      <p className="text-roadie-muted text-xs">
                        Updated {format(new Date(trip.updatedAt), "d MMM yyyy")}
                      </p>
                    </CardFooter>
                    <Button
                      aria-label={`Open ${trip.title}`}
                      className="absolute inset-0 h-full w-full opacity-0"
                      data-testid={`roadie-open-trip-btn-${trip.id}`}
                      onClick={() => {
                        setActiveTripId(trip.id);
                        setShareStatus(null);
                      }}
                      variant="ghost"
                    >
                      Open trip
                    </Button>
                  </Card>
                ))}
              </div>
            )}

            {homeView === "trips" && trips.length > 0 ? (
              <div className="border-roadie-ink/20 flex justify-end border-t border-dashed pt-6">
                <Button
                  data-testid="roadie-delete-all-btn"
                  onClick={() => setDeleteAllOpen(true)}
                  variant="destructive"
                >
                  Delete all Roadie data
                </Button>
              </div>
            ) : null}
          </section>
        ) : (
          <section
            className="space-y-6"
            data-component="RoadieTripDetails"
            data-testid="roadie-trip-details"
          >
            <div className="bg-roadie-card border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket flex flex-col justify-between gap-4 border-2 p-6 md:flex-row md:items-end md:p-8">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={`${PURPOSE_STYLES[activeTrip.purpose]} text-roadie-ink border-0 font-semibold tracking-widest uppercase`}
                  >
                    {PURPOSE_LABELS[activeTrip.purpose]}
                  </Badge>
                  <Badge
                    className="border-roadie-ink text-roadie-ink rounded-full"
                    variant="outline"
                  >
                    {tripDateLabel(activeTrip)}
                  </Badge>
                </div>
                <H2
                  className="font-roadie-display text-4xl uppercase md:text-5xl"
                  data-testid="roadie-trip-heading"
                >
                  {activeTrip.title}
                </H2>
                <p className="text-roadie-muted text-sm">
                  {activeTrip.location ?? "Location not added"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="roadie-share-to-chat-btn"
                  disabled={busy}
                  onClick={() => openUpdate(activeTrip.impactReport ? "trip-impact" : "trip-plans")}
                  className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine rounded-full font-semibold"
                  variant="secondary"
                >
                  {activeTrip.impactReport ? "Share trip impact" : "Share trip plans"}
                </Button>
                <Button
                  data-testid="roadie-impact-report-btn"
                  disabled={busy}
                  onClick={beginImpactReport}
                  className="bg-roadie-tangerine text-roadie-ink hover:bg-roadie-lime rounded-full font-semibold"
                  variant="secondary"
                >
                  {activeTrip.impactReport ? "Edit impact report" : "Add impact report"}
                </Button>
                <Button
                  data-testid="roadie-delete-trip-btn"
                  disabled={busy}
                  onClick={() => setDeleteTripOpen(true)}
                  variant="destructive"
                >
                  Delete trip
                </Button>
              </div>
            </div>

            <Card
              className="bg-roadie-card border-roadie-ink rounded-roadie-ticket border-2 shadow-none"
              data-component="RoadieItinerary"
            >
              <CardHeader>
                <p className="text-roadie-pink text-xs font-bold tracking-widest uppercase">
                  Your running order
                </p>
                <CardTitle className="font-roadie-display text-3xl uppercase">Itinerary</CardTitle>
                <CardDescription className="text-roadie-muted">
                  Talks, dinners, travel, accommodation, meetings, and personal plans in time order.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sortedTimeline.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    Nothing here yet. Paste your first confirmation below.
                  </p>
                ) : (
                  sortedTimeline.map((item) => (
                    <div
                      className={`${ITEM_KIND_STYLES[item.kind]} rounded-roadie-ticket border-l-8 p-4`}
                      data-testid={`roadie-timeline-item-${item.id}`}
                      key={item.id}
                    >
                      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className="border-roadie-ink text-roadie-ink rounded-full"
                              variant="outline"
                            >
                              {ITEM_KIND_LABELS[item.kind]}
                            </Badge>
                            {item.engagementType ? (
                              <Badge className="bg-roadie-ink text-roadie-paper border-0">
                                {ENGAGEMENT_LABELS[item.engagementType]}
                              </Badge>
                            ) : null}
                            {item.outcome?.audienceCount !== undefined ? (
                              <Badge className="bg-roadie-lime text-roadie-ink border-0">
                                {item.outcome.audienceCount.toLocaleString("en")} reached
                              </Badge>
                            ) : null}
                            <p className="text-roadie-muted text-xs">
                              {formatInTimeZone(
                                item.start,
                                item.timeZone,
                                "EEEE, d MMMM · HH:mm 'local'",
                              )}
                            </p>
                          </div>
                          <p className="font-roadie-display mt-2 text-xl font-semibold uppercase">
                            {item.title}
                          </p>
                          <p className="text-roadie-muted mt-2 text-xs">
                            {item.timeZone} · Source: {item.evidence[0]?.sourceLabel}
                          </p>
                          {item.outcome?.highlight ? (
                            <p className="border-roadie-ink/20 mt-3 border-t border-dashed pt-3 text-sm">
                              <span className="font-semibold">Highlight:</span>{" "}
                              {item.outcome.highlight}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            data-testid={`roadie-edit-item-btn-${item.id}`}
                            disabled={busy}
                            onClick={() => beginEditItem(item)}
                            size="sm"
                            variant="outline"
                          >
                            {item.engagementType ? "Edit + impact" : "Edit"}
                          </Button>
                          <Button
                            data-testid={`roadie-delete-item-btn-${item.id}`}
                            disabled={busy}
                            onClick={() => setItemToDelete(item)}
                            size="sm"
                            variant="destructive"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {activeTrip.impactReport ? (
              <Card
                className="bg-roadie-lime/25 border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
                data-component="RoadieImpactReport"
                data-testid="roadie-trip-impact-report"
              >
                <CardHeader>
                  <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                    Post-trip field notes
                  </p>
                  <CardTitle className="font-roadie-display text-3xl uppercase">
                    Impact report
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="whitespace-pre-wrap">{activeTrip.impactReport.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    {activeTrip.impactReport.eventAttendance !== undefined ? (
                      <Badge className="bg-roadie-tangerine text-roadie-ink border-0">
                        {activeTrip.impactReport.eventAttendance.toLocaleString("en")} event
                        attendees · {activeTrip.impactReport.attendanceConfidence}
                      </Badge>
                    ) : null}
                    {activeTrip.impactReport.followUpCount !== undefined ? (
                      <Badge className="bg-roadie-sky text-roadie-ink border-0">
                        {activeTrip.impactReport.followUpCount} follow-ups
                      </Badge>
                    ) : null}
                  </div>
                  {activeTrip.impactReport.outcomes ? (
                    <p>
                      <span className="font-semibold">Outcomes:</span>{" "}
                      {activeTrip.impactReport.outcomes}
                    </p>
                  ) : null}
                  {activeTrip.impactReport.sponsorValue ? (
                    <p>
                      <span className="font-semibold">Sponsor value:</span>{" "}
                      {activeTrip.impactReport.sponsorValue}
                    </p>
                  ) : null}
                  <p className="text-roadie-muted text-xs">
                    Private reflections are never included in shared reports.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Card
              className="bg-roadie-sky/25 border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
              data-component="RoadiePasteItem"
            >
              <CardHeader>
                <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                  Paste it. Roadie sorts it.
                </p>
                <CardTitle className="font-roadie-display text-3xl uppercase">
                  Add to this trip
                </CardTitle>
                <CardDescription className="text-roadie-muted">
                  Paste an email, booking confirmation, calendar invitation, or rough note
                  containing a date and time.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-col gap-2">
                  <Label htmlFor="roadie-new-item-kind">Category</Label>
                  <Select
                    onValueChange={(value) => {
                      if (value === "auto") {
                        setNewItemKind("auto");
                        return;
                      }
                      setNewItemKind(itineraryItemKindSchema.parse(value));
                    }}
                    value={newItemKind}
                  >
                    <SelectTrigger data-testid="roadie-new-item-kind" id="roadie-new-item-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Detect from pasted text</SelectItem>
                      {Object.entries(ITEM_KIND_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mb-4 flex flex-col gap-2">
                  <Label htmlFor="roadie-new-engagement-type">Public engagement</Label>
                  <Select
                    onValueChange={(value) => {
                      if (value === "auto" || value === "none") {
                        setNewEngagementType(value);
                        return;
                      }
                      setNewEngagementType(engagementTypeSchema.parse(value));
                    }}
                    value={newEngagementType}
                  >
                    <SelectTrigger
                      data-testid="roadie-new-engagement-type"
                      id="roadie-new-engagement-type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Detect from pasted text</SelectItem>
                      <SelectItem value="none">Not public</SelectItem>
                      {Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Label htmlFor="roadie-pasted-text">Trip information</Label>
                <Textarea
                  className="mt-2 min-h-44"
                  data-testid="roadie-pasted-text"
                  id="roadie-pasted-text"
                  onChange={(event) => {
                    setPastedText(event.target.value);
                    setItemStatus(null);
                  }}
                  placeholder="Paste a speaker confirmation, dinner invitation, flight, hotel booking, or meeting email…"
                  value={pastedText}
                />
                <p className="text-roadie-muted mt-2 text-xs">
                  Include a date and time so Roadie knows where it belongs.
                </p>
                {itemStatus ? (
                  <Alert
                    className={
                      itemStatus.kind === "success"
                        ? "border-roadie-lime bg-roadie-lime/20 mt-4"
                        : "mt-4"
                    }
                    data-testid="roadie-add-item-status"
                    variant={itemStatus.kind === "error" ? "destructive" : "default"}
                  >
                    <AlertTitle>
                      {itemStatus.kind === "success" ? "Added to itinerary" : "Could not add this"}
                    </AlertTitle>
                    <AlertDescription>{itemStatus.message}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
              <CardFooter className="gap-2">
                <Button
                  data-testid="roadie-add-pasted-item-btn"
                  disabled={busy || pastedText.trim().length === 0}
                  onClick={addPastedItem}
                  className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full font-semibold"
                >
                  Add to itinerary
                </Button>
                <Button
                  data-testid="roadie-load-example-btn"
                  disabled={busy}
                  onClick={() => {
                    setPastedText(EXAMPLE_TEXT);
                    setActionError(null);
                  }}
                  variant="outline"
                >
                  Load example
                </Button>
              </CardFooter>
            </Card>
          </section>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          setNewTripOpen(open);
          if (!open) {
            setNewTripTitle("");
            setNewTripLocation("");
            setNewTripPurpose("conference");
          }
        }}
        open={newTripOpen}
      >
        <DialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-testid="roadie-new-trip-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-roadie-display text-3xl uppercase">Add a trip</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-new-trip-title">Trip name</Label>
              <Input
                autoFocus
                data-testid="roadie-new-trip-title"
                id="roadie-new-trip-title"
                onChange={(event) => setNewTripTitle(event.target.value)}
                placeholder="React Summit 2026"
                value={newTripTitle}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-new-trip-purpose">Purpose</Label>
              <Select
                onValueChange={(value) => setNewTripPurpose(tripPurposeSchema.parse(value))}
                value={newTripPurpose}
              >
                <SelectTrigger data-testid="roadie-new-trip-purpose" id="roadie-new-trip-purpose">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-new-trip-location">Location (optional)</Label>
              <Input
                data-testid="roadie-new-trip-location"
                id="roadie-new-trip-location"
                onChange={(event) => setNewTripLocation(event.target.value)}
                placeholder="Amsterdam"
                value={newTripLocation}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="roadie-cancel-new-trip-btn"
              onClick={() => setNewTripOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full"
              data-testid="roadie-confirm-new-trip-btn"
              disabled={busy || newTripTitle.trim().length === 0}
              onClick={confirmNewTrip}
            >
              Add trip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setImpactReportOpen} open={impactReportOpen}>
        <DialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket max-h-screen overflow-y-auto border-2"
          data-testid="roadie-impact-report-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-roadie-display text-3xl uppercase">
              Trip impact report
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-impact-report-text">What happened and what stood out?</Label>
              <Textarea
                autoFocus
                className="min-h-40"
                data-testid="roadie-impact-report-text"
                id="roadie-impact-report-text"
                onChange={(event) => setImpactReportText(event.target.value)}
                placeholder="Around 450 attendees. My session room was full and three companies asked for follow-up conversations…"
                value={impactReportText}
              />
              <p className="text-roadie-muted text-xs">
                Roadie extracts attendance and follow-up numbers when it can. You can correct them
                below.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="roadie-impact-event-attendance">Event attendance</Label>
                <Input
                  data-testid="roadie-impact-event-attendance"
                  id="roadie-impact-event-attendance"
                  min="0"
                  onChange={(event) => setImpactEventAttendance(event.target.value)}
                  placeholder="450"
                  type="number"
                  value={impactEventAttendance}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="roadie-impact-attendance-confidence">Attendance source</Label>
                <Select
                  onValueChange={(value) =>
                    setImpactAttendanceConfidence(metricConfidenceSchema.parse(value))
                  }
                  value={impactAttendanceConfidence}
                >
                  <SelectTrigger
                    data-testid="roadie-impact-attendance-confidence"
                    id="roadie-impact-attendance-confidence"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estimated">Estimated</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="derived">Derived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-impact-follow-ups">Follow-ups</Label>
              <Input
                data-testid="roadie-impact-follow-ups"
                id="roadie-impact-follow-ups"
                min="0"
                onChange={(event) => setImpactFollowUpCount(event.target.value)}
                placeholder="3"
                type="number"
                value={impactFollowUpCount}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-impact-outcomes">Outcomes</Label>
              <Textarea
                data-testid="roadie-impact-outcomes"
                id="roadie-impact-outcomes"
                onChange={(event) => setImpactOutcomes(event.target.value)}
                placeholder="Useful conversations, invitations, leads, learning, or follow-up actions."
                value={impactOutcomes}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-impact-sponsor-value">Sponsor or programme value</Label>
              <Textarea
                data-testid="roadie-impact-sponsor-value"
                id="roadie-impact-sponsor-value"
                onChange={(event) => setImpactSponsorValue(event.target.value)}
                placeholder="Why this event was valuable and whether it is worth supporting again."
                value={impactSponsorValue}
              />
            </div>
            <div className="bg-roadie-violet/15 border-roadie-violet rounded-roadie-ticket flex flex-col gap-2 border p-4">
              <Label htmlFor="roadie-impact-private-reflection">Private reflection</Label>
              <Textarea
                data-testid="roadie-impact-private-reflection"
                id="roadie-impact-private-reflection"
                onChange={(event) => setImpactPrivateReflection(event.target.value)}
                placeholder="Personal notes that should never be shared."
                value={impactPrivateReflection}
              />
              <p className="text-roadie-muted text-xs">
                Roadie excludes this from every shared report.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="roadie-cancel-impact-report-btn"
              onClick={() => setImpactReportOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full"
              data-testid="roadie-save-impact-report-btn"
              disabled={busy || impactReportText.trim().length === 0}
              onClick={saveImpactReport}
            >
              Save report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setShareMode(null);
          }
        }}
        open={shareMode !== null}
      >
        <DialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket max-h-screen overflow-y-auto border-2"
          data-testid="roadie-share-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-roadie-display text-3xl uppercase">
              Create update
            </DialogTitle>
            {shareMode ? (
              <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                {UPDATE_TYPE_LABELS[shareMode]}
              </p>
            ) : null}
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="roadie-update-type">What are you sharing?</Label>
            <Select
              {...(shareMode ? { value: shareMode } : {})}
              onValueChange={(value) =>
                changeUpdateType(
                  value === "upcoming-engagements" ||
                    value === "trip-plans" ||
                    value === "trip-impact" ||
                    value === "impact-digest"
                    ? value
                    : "upcoming-engagements",
                )
              }
            >
              <SelectTrigger data-testid="roadie-update-type" id="roadie-update-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming-engagements">Upcoming engagements</SelectItem>
                {activeTrip ? <SelectItem value="trip-plans">Trip plans</SelectItem> : null}
                {activeTrip?.impactReport ? (
                  <SelectItem value="trip-impact">Trip impact</SelectItem>
                ) : null}
                <SelectItem value="impact-digest">Impact digest</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-roadie-muted text-xs">
              The update defines the content. The channel defines its audience.
            </p>
          </div>
          {shareMode === "impact-digest" ? (
            <div className="bg-roadie-sky/25 border-roadie-ink rounded-roadie-ticket grid gap-4 border-2 p-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="roadie-digest-period">Reporting period</Label>
                <Select
                  onValueChange={(value) => changeDigestPeriod(value === "year" ? "year" : "month")}
                  value={digestPeriod}
                >
                  <SelectTrigger data-testid="roadie-digest-period" id="roadie-digest-period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="year">Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {digestPeriod === "month" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="roadie-digest-month">Month</Label>
                  <Input
                    data-testid="roadie-digest-month"
                    id="roadie-digest-month"
                    onChange={(event) => changeDigestMonth(event.target.value)}
                    type="month"
                    value={digestMonth}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="roadie-digest-year">Year</Label>
                  <Select
                    onValueChange={(value) => changeDigestYear(Number.parseInt(value, 10))}
                    value={String(impactYear)}
                  >
                    <SelectTrigger data-testid="roadie-digest-year" id="roadie-digest-year">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(availableImpactYears.length > 0 ? availableImpactYears : [impactYear]).map(
                        (year) => (
                          <SelectItem key={year} value={String(year)}>
                            {year}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ) : null}
          {shareMode === "trip-impact" || shareMode === "impact-digest" ? (
            <div className="flex flex-col gap-3">
              <Label>Include in this update</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["includeAttendance", "Event attendance"],
                    ["includeAudience", "Direct audience"],
                    ["includeHighlights", "Highlights"],
                    ["includeOutcomes", "Outcomes"],
                    ["includeFollowUps", "Follow-ups"],
                    ["includeSponsorValue", "Programme or sponsor value"],
                  ] satisfies ReadonlyArray<readonly [keyof ImpactShareOptions, string]>
                ).map(([key, label]) => (
                  <div className="flex items-center gap-2" key={key}>
                    <Checkbox
                      checked={impactShareOptions[key]}
                      data-testid={`roadie-share-option-${key}`}
                      id={`roadie-share-option-${key}`}
                      onCheckedChange={(checked) => changeImpactShareOption(key, checked === true)}
                    />
                    <Label htmlFor={`roadie-share-option-${key}`}>{label}</Label>
                  </div>
                ))}
              </div>
              <p className="text-roadie-muted text-xs">
                Private reflections and personal itinerary details are always excluded.
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="roadie-share-draft">Message</Label>
            <Textarea
              autoFocus
              className="min-h-72"
              data-testid="roadie-share-draft"
              id="roadie-share-draft"
              onChange={(event) => {
                setShareDraft(event.target.value);
                setShareStatus(null);
              }}
              value={shareDraft}
            />
            <p className="text-muted-foreground text-xs">
              Edit this copy freely. Changes here do not alter your saved trip.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="roadie-share-channel">Direct channel</Label>
            <Select
              disabled={channelsQuery.isPending || channelsQuery.isError}
              onValueChange={setSelectedShareChannelId}
              value={selectedShareChannelId}
            >
              <SelectTrigger data-testid="roadie-share-channel" id="roadie-share-channel">
                <SelectValue
                  placeholder={
                    channelsQuery.isPending
                      ? "Loading channels…"
                      : channelsQuery.isError
                        ? "Could not load channels"
                        : channelsQuery.data?.rooms.some((channel) => !channel.archived)
                          ? "Choose a channel"
                          : "No available channels"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {channelsQuery.data?.rooms
                  .filter((channel) => !channel.archived)
                  .map((channel) => (
                    <SelectItem key={channel.roomId} value={channel.roomId}>
                      {channel.title ?? channel.roomId}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {channelsQuery.isError ? (
              <div
                className="border-destructive/40 bg-destructive/10 flex flex-col gap-2 rounded-md border p-3"
                data-testid="roadie-share-channel-error"
              >
                <p className="text-destructive text-sm">{errorMessage(channelsQuery.error)}</p>
                <Button
                  className="self-start"
                  data-testid="roadie-retry-channels-btn"
                  onClick={() => void channelsQuery.refetch()}
                  size="sm"
                  variant="outline"
                >
                  Retry loading channels
                </Button>
              </div>
            ) : null}
            <p className="text-roadie-muted text-xs">
              Roadie remembers destinations for recurring update types.
            </p>
          </div>
          <DialogFooter>
            <Button
              data-testid="roadie-reset-share-btn"
              onClick={() => {
                setShareStatus(null);
                if (shareMode) setShareDraft(shareDraftFor(shareMode));
              }}
              variant="outline"
            >
              Reset
            </Button>
            <Button
              data-testid="roadie-cancel-share-btn"
              onClick={() => {
                setShareMode(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-roadie-lime text-roadie-ink hover:bg-roadie-tangerine rounded-full font-semibold"
              data-testid="roadie-send-direct-btn"
              disabled={shareDraft.trim().length === 0 || selectedShareChannelId.length === 0}
              onClick={() => void sendShareDirectly()}
              variant="secondary"
            >
              Send directly
            </Button>
            <Button
              className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full"
              data-testid="roadie-send-share-btn"
              disabled={shareDraft.trim().length === 0}
              onClick={() => void sendShareDraft()}
            >
              Choose another chat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        open={editingItem !== null}
      >
        <DialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-testid="roadie-edit-item-dialog"
        >
          <DialogHeader>
            <DialogTitle className="font-roadie-display text-3xl uppercase">
              Edit itinerary item
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-edit-item-title">Title</Label>
              <Input
                autoFocus
                data-testid="roadie-edit-item-title"
                id="roadie-edit-item-title"
                onChange={(event) => setEditTitle(event.target.value)}
                value={editTitle}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-edit-item-kind">Category</Label>
              <Select
                onValueChange={(value) => setEditKind(itineraryItemKindSchema.parse(value))}
                value={editKind}
              >
                <SelectTrigger data-testid="roadie-edit-item-kind" id="roadie-edit-item-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ITEM_KIND_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-edit-engagement-type">Public engagement</Label>
              <Select
                onValueChange={(value) =>
                  setEditEngagementType(
                    value === "none" ? "none" : engagementTypeSchema.parse(value),
                  )
                }
                value={editEngagementType}
              >
                <SelectTrigger
                  data-testid="roadie-edit-engagement-type"
                  id="roadie-edit-engagement-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not public</SelectItem>
                  {Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-edit-item-date-time">Local date and time</Label>
              <Input
                data-testid="roadie-edit-item-date-time"
                id="roadie-edit-item-date-time"
                onChange={(event) => setEditLocalDateTime(event.target.value)}
                type="datetime-local"
                value={editLocalDateTime}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="roadie-edit-item-timezone">IANA time zone</Label>
              <Input
                data-testid="roadie-edit-item-timezone"
                id="roadie-edit-item-timezone"
                onChange={(event) => setEditTimeZone(event.target.value)}
                value={editTimeZone}
              />
            </div>
            {editEngagementType !== "none" ? (
              <div className="bg-roadie-lime/20 border-roadie-ink rounded-roadie-ticket space-y-4 border-2 p-4">
                <div>
                  <p className="text-roadie-coral text-xs font-bold tracking-widest uppercase">
                    After the engagement
                  </p>
                  <p className="font-roadie-display text-2xl uppercase">Impact</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="roadie-edit-audience-count">Direct audience</Label>
                    <Input
                      data-testid="roadie-edit-audience-count"
                      id="roadie-edit-audience-count"
                      min="0"
                      onChange={(event) => setEditAudienceCount(event.target.value)}
                      placeholder="180"
                      type="number"
                      value={editAudienceCount}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="roadie-edit-audience-confidence">Audience source</Label>
                    <Select
                      onValueChange={(value) =>
                        setEditAudienceConfidence(metricConfidenceSchema.parse(value))
                      }
                      value={editAudienceConfidence}
                    >
                      <SelectTrigger
                        data-testid="roadie-edit-audience-confidence"
                        id="roadie-edit-audience-confidence"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="estimated">Estimated</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="derived">Derived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="roadie-edit-outcome-highlight">What stood out?</Label>
                  <Textarea
                    data-testid="roadie-edit-outcome-highlight"
                    id="roadie-edit-outcome-highlight"
                    onChange={(event) => setEditOutcomeHighlight(event.target.value)}
                    placeholder="The room was full and the trust section prompted the most questions."
                    value={editOutcomeHighlight}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="roadie-edit-outcome">Outcome or value</Label>
                  <Textarea
                    data-testid="roadie-edit-outcome"
                    id="roadie-edit-outcome"
                    onChange={(event) => setEditOutcomeText(event.target.value)}
                    placeholder="Three companies requested follow-up conversations."
                    value={editOutcomeText}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="roadie-edit-follow-ups">Follow-ups</Label>
                  <Input
                    data-testid="roadie-edit-follow-ups"
                    id="roadie-edit-follow-ups"
                    min="0"
                    onChange={(event) => setEditFollowUpCount(event.target.value)}
                    placeholder="3"
                    type="number"
                    value={editFollowUpCount}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              data-testid="roadie-cancel-edit-item-btn"
              onClick={() => setEditingItem(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="bg-roadie-coral text-roadie-paper hover:bg-roadie-pink rounded-full"
              data-testid="roadie-save-edit-item-btn"
              disabled={
                busy ||
                editTitle.trim().length === 0 ||
                editLocalDateTime.length === 0 ||
                editTimeZone.trim().length === 0
              }
              onClick={saveEditedItem}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setItemToDelete(null);
        }}
        open={itemToDelete !== null}
      >
        <AlertDialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-testid="roadie-delete-item-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this itinerary item?</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete?.title} will be removed from this trip.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="roadie-confirm-delete-item-btn"
              disabled={busy}
              onClick={confirmDeleteItem}
            >
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setDeleteTripOpen} open={deleteTripOpen}>
        <AlertDialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-testid="roadie-delete-trip-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeTrip?.title} and its entire itinerary will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="roadie-confirm-delete-trip-btn"
              disabled={busy}
              onClick={confirmDeleteTrip}
            >
              Delete trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog onOpenChange={setDeleteAllOpen} open={deleteAllOpen}>
        <AlertDialogContent
          className="bg-roadie-paper border-roadie-ink shadow-roadie-ticket rounded-roadie-ticket border-2"
          data-testid="roadie-delete-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all Roadie data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every trip and itinerary item stored by Roadie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="roadie-confirm-delete-btn"
              disabled={deleteAllMutation.isPending}
              onClick={() => deleteAllMutation.mutate(stored)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
