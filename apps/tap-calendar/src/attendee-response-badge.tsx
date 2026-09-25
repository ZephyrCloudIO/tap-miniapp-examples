import { CheckCircle2, CircleHelp, CircleMinus, Clock3, XCircle } from "lucide-react";
import {
  attendeeResponseLabels,
  eventViewerResponse,
  viewerResponseLabels,
  type CalendarResponseStatus,
} from "./attendee-response";
import type { CalendarEvent } from "./domain";

const responseIcons = {
  accepted: CheckCircle2,
  needsAction: Clock3,
  tentative: CircleHelp,
  declined: XCircle,
  unknown: CircleMinus,
};

export function AttendeeResponseBadge({
  response = "unknown",
  viewer = false,
  compact = false,
}: {
  readonly response?: CalendarResponseStatus;
  readonly viewer?: boolean;
  readonly compact?: boolean;
}) {
  const Icon = responseIcons[response];
  const label = (viewer ? viewerResponseLabels : attendeeResponseLabels)[response];
  return (
    <span className={`rsvp-badge rsvp-badge-${response}${compact ? " rsvp-compact" : ""}`} title={label}>
      <Icon aria-hidden="true" />
      <span className="rsvp-label">{label}</span>
    </span>
  );
}

export const eventResponseClassName = (event: CalendarEvent): string => {
  const response = event.status === "cancelled" ? "cancelled" : eventViewerResponse(event);
  return response ? `rsvp-event rsvp-${response}` : "";
};

export const eventResponseLabel = (event: CalendarEvent): string => {
  if (event.status === "cancelled") return "Cancelled";
  const response = eventViewerResponse(event);
  return response ? viewerResponseLabels[response] : event.status;
};

export function EventResponseBadge({ event, compact = false, showBookingStatus = false }: {
  readonly event: CalendarEvent;
  readonly compact?: boolean;
  readonly showBookingStatus?: boolean;
}) {
  if (event.status === "cancelled") return <span className="status-chip status-cancelled">Cancelled</span>;
  const response = eventViewerResponse(event);
  return response ? <AttendeeResponseBadge response={response} viewer compact={compact} />
    : showBookingStatus ? <span className={`status-chip status-${event.status}`}>{event.status}</span> : null;
}
