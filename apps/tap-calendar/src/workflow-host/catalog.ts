export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface WorkflowNodeInvocation {
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly config: Readonly<Record<string, JsonValue>>;
}

export interface WorkflowNodeResult {
  readonly outcome: "ready" | "error";
  readonly outputs: Readonly<Record<string, JsonValue>>;
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const createdStatuses = new Set(["pending", "confirmed"]);
const normalizedStatuses = new Set(["pending", "confirmed", "cancelled"]);
const normalizedEvents = new Set(["booking.created", "booking.cancelled"]);

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeString(
  row: Record<string, JsonValue>,
  key: string,
  label: string,
  errors: string[],
  options: { readonly required?: boolean; readonly maxLength?: number } = {},
): string {
  const value = row[key];
  if (value === undefined || value === null) {
    if (options.required) errors.push(`${label} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${label} must be a string.`);
    return "";
  }
  const trimmed = value.trim();
  if (options.required && !trimmed) errors.push(`${label} is required.`);
  if (
    trimmed.length > (options.maxLength ?? 256) ||
    CONTROL_CHARACTER.test(trimmed)
  ) {
    errors.push(`${label} is malformed.`);
    return "";
  }
  return trimmed;
}

function safeTimestamp(
  row: Record<string, JsonValue>,
  key: string,
  label: string,
  errors: string[],
  required = true,
): string {
  const value = safeString(row, key, label, errors, {
    required,
    maxLength: 64,
  });
  if (value && !Number.isFinite(Date.parse(value))) {
    errors.push(`${label} must be a valid timestamp.`);
  }
  return value;
}

function inputObject(
  inputs: Readonly<Record<string, JsonValue>>,
  name: "booking" | "request",
): Record<string, JsonValue> | null {
  return isRecord(inputs[name]) ? inputs[name] : null;
}

function errorOutcome(): WorkflowNodeResult {
  // Error attempts intentionally emit no output port. Emitting diagnostics on
  // a typed success port would violate its additionalProperties:false schema.
  return { outcome: "error", outputs: {} };
}

function optionalFields(
  values: Readonly<Record<string, string | null>>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== "" && value !== null),
  ) as Record<string, JsonValue>;
}

function audiencePolicy(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!isRecord(value)) return null;
  return {
    canSeeGuestIdentity: value.canSeeGuestIdentity === true,
    canSeeMeetingDetails: value.canSeeMeetingDetails === true,
    canSeeLocation: value.canSeeLocation === true,
  };
}

/**
 * Normalize a Booking into the schema-bound workflow event without copying
 * participant identity, contact details, Booking Questions, or linked TAP
 * content into the automation payload.
 */
export function normalizeBookingCreated(
  invocation: WorkflowNodeInvocation,
): WorkflowNodeResult {
  const booking = inputObject(invocation.inputs, "booking");
  if (!booking) return errorOutcome();

  const errors: string[] = [];
  const bookingId = safeString(booking, "bookingId", "Booking ID", errors, {
    required: true,
    maxLength: 256,
  });
  const title = safeString(booking, "title", "Booking title", errors, {
    required: true,
    maxLength: 160,
  });
  const start = safeTimestamp(booking, "start", "Booking start", errors);
  const end = safeTimestamp(booking, "end", "Booking end", errors);
  if (
    start &&
    end &&
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    Date.parse(end) <= Date.parse(start)
  ) {
    errors.push("Booking end must be after its start.");
  }
  const status = safeString(booking, "status", "Booking status", errors, {
    required: true,
    maxLength: 16,
  });
  if (status && !createdStatuses.has(status)) {
    errors.push("Booking status must be pending or confirmed.");
  }
  const eventTypeId = safeString(
    booking,
    "eventTypeId",
    "Event Type ID",
    errors,
    { maxLength: 256 },
  );
  const occurredAt = safeTimestamp(
    booking,
    "occurredAt",
    "Occurrence time",
    errors,
    false,
  );
  const locationValue = booking.location;
  let location: string | null = null;
  if (locationValue !== undefined && locationValue !== null) {
    location = safeString(booking, "location", "Meeting Location", errors, {
      maxLength: 128,
    });
  }
  const audience = audiencePolicy(booking.audience);
  const guestName =
    audience?.canSeeGuestIdentity === true
      ? safeString(booking, "guestName", "Guest name", errors, {
          maxLength: 160,
        })
      : "";

  if (errors.length > 0) return errorOutcome();
  return {
    outcome: "ready",
    outputs: {
      normalized: {
        bookingId,
        event: "booking.created",
        status,
        title,
        start,
        end,
        ...optionalFields({ eventTypeId, occurredAt, location }),
        ...(guestName ? { guestName } : {}),
        ...(audience ? { audience } : {}),
      },
    },
  };
}

/**
 * Normalize a cancellation without forwarding the free-form reason or guest
 * identity. The bounded event is safe to route through customer workflows.
 */
export function normalizeBookingCancelled(
  invocation: WorkflowNodeInvocation,
): WorkflowNodeResult {
  const booking = inputObject(invocation.inputs, "booking");
  if (!booking) return errorOutcome();

  const errors: string[] = [];
  const bookingId = safeString(booking, "bookingId", "Booking ID", errors, {
    required: true,
    maxLength: 256,
  });
  const cancelledAt = safeTimestamp(
    booking,
    "cancelledAt",
    "Cancellation time",
    errors,
  );
  const eventTypeId = safeString(
    booking,
    "eventTypeId",
    "Event Type ID",
    errors,
    { maxLength: 256 },
  );
  const title = safeString(booking, "title", "Booking title", errors, {
    maxLength: 160,
  });
  const start = safeTimestamp(
    booking,
    "start",
    "Scheduled start",
    errors,
    false,
  );
  const end = safeTimestamp(booking, "end", "Scheduled end", errors, false);
  const audience = audiencePolicy(booking.audience);
  const guestName =
    audience?.canSeeGuestIdentity === true
      ? safeString(booking, "guestName", "Guest name", errors, {
          maxLength: 160,
        })
      : "";

  if (errors.length > 0) return errorOutcome();
  return {
    outcome: "ready",
    outputs: {
      normalized: {
        bookingId,
        event: "booking.cancelled",
        status: "cancelled",
        occurredAt: cancelledAt,
        ...optionalFields({ eventTypeId, title, start, end }),
        ...(guestName ? { guestName } : {}),
        ...(audience ? { audience } : {}),
      },
    },
  };
}

function deterministicWorkBlockId(taskId: string, start: string, end: string): string {
  let hash = 2_166_136_261;
  for (const character of `${taskId}\u0000${start}\u0000${end}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `work-block-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Prepare a deterministic Work Block draft. This function performs no write. */
export function draftWorkBlock(
  invocation: WorkflowNodeInvocation,
): WorkflowNodeResult {
  const request = inputObject(invocation.inputs, "request");
  if (!request) return errorOutcome();

  const errors: string[] = [];
  const taskId = safeString(request, "taskId", "Task ID", errors, {
    required: true,
    maxLength: 256,
  });
  const title = safeString(request, "title", "Work Block title", errors, {
    required: true,
    maxLength: 160,
  });
  const calendarId = safeString(
    request,
    "calendarId",
    "Destination Calendar ID",
    errors,
    { required: true, maxLength: 256 },
  );
  const start = safeTimestamp(request, "start", "Work Block start", errors);
  const end = safeTimestamp(request, "end", "Work Block end", errors);
  if (
    start &&
    end &&
    Number.isFinite(Date.parse(start)) &&
    Number.isFinite(Date.parse(end)) &&
    Date.parse(end) <= Date.parse(start)
  ) {
    errors.push("Work Block end must be after its start.");
  }
  const taskLabel =
    safeString(request, "taskLabel", "Task label", errors, {
      maxLength: 160,
    }) || "Linked TAP task";

  if (errors.length > 0) return errorOutcome();
  return {
    outcome: "ready",
    outputs: {
      draft: {
        id: deterministicWorkBlockId(taskId, start, end),
        title,
        calendarId,
        start,
        end,
        kind: "work-block",
        status: "confirmed",
        source: {
          kind: "task",
          id: taskId,
          label: taskLabel,
        },
      },
    },
  };
}

function permission(
  audience: Record<string, JsonValue> | null,
  key: string,
): boolean {
  return audience?.[key] === true;
}

/**
 * Prepare a flat, schema-bound Calendar Channel Summary. Audience policy is
 * optional input metadata; every absent permission fails closed. Contact
 * details, Booking Questions, and linked TAP content are never copied into
 * this summary schema.
 */
export function prepareChannelSummary(
  invocation: WorkflowNodeInvocation,
): WorkflowNodeResult {
  const booking = inputObject(invocation.inputs, "booking");
  if (!booking) return errorOutcome();

  const errors: string[] = [];
  const bookingId = safeString(booking, "bookingId", "Booking ID", errors, {
    required: true,
    maxLength: 256,
  });
  let event = safeString(booking, "event", "Booking event", errors, {
    maxLength: 32,
  });
  let status = safeString(booking, "status", "Booking status", errors, {
    maxLength: 16,
  });
  if (!event && booking.cancelledAt !== undefined) event = "booking.cancelled";
  if (!event) event = "booking.created";
  if (!status && event === "booking.cancelled") status = "cancelled";
  if (!status) status = "confirmed";
  if (!normalizedEvents.has(event)) errors.push("Booking event is unsupported.");
  if (!normalizedStatuses.has(status)) errors.push("Booking status is unsupported.");

  const start = safeTimestamp(
    booking,
    "start",
    "Booking start",
    errors,
    false,
  );
  const bookingTitle = safeString(booking, "title", "Booking title", errors, {
    maxLength: 160,
  });
  const guestName = safeString(booking, "guestName", "Guest name", errors, {
    maxLength: 160,
  });
  const location = safeString(booking, "location", "Meeting Location", errors, {
    maxLength: 128,
  });
  const audience = isRecord(booking.audience) ? booking.audience : null;
  if (errors.length > 0) return errorOutcome();

  const maySeeIdentity = permission(
    audience,
    "canSeeGuestIdentity",
  );
  const maySeeDetails = permission(
    audience,
    "canSeeMeetingDetails",
  );
  const maySeeLocation = permission(audience, "canSeeLocation");
  const identityRedacted = Boolean(guestName) && !maySeeIdentity;
  const detailsRedacted = Boolean(bookingTitle) && !maySeeDetails;
  const locationRedacted = Boolean(location) && !maySeeLocation;
  const protectedFieldsPresent =
    booking.guestEmail !== undefined ||
    booking.bookingAnswers !== undefined ||
    booking.linkedTapContent !== undefined;
  const redacted =
    identityRedacted ||
    detailsRedacted ||
    locationRedacted ||
    protectedFieldsPresent;
  const guestLabel = maySeeIdentity && guestName ? guestName : "External guest";
  const meetingLabel = maySeeDetails && bookingTitle ? bookingTitle : "Meeting";
  const timeLabel = start || "Time unavailable";
  const locationLabel = maySeeLocation && location ? ` · ${location}` : "";
  const cancelled = event === "booking.cancelled";

  return {
    outcome: "ready",
    outputs: {
      summary: {
        title: cancelled ? "Meeting cancelled" : "Meeting scheduled",
        body: `${guestLabel} · ${meetingLabel} · ${timeLabel}${locationLabel}`,
        redacted,
        bookingId,
        event,
        status,
      },
    },
  };
}

export const workflowNodeCatalog = Object.freeze({
  normalizeBookingCreated,
  normalizeBookingCancelled,
  draftWorkBlock,
  prepareChannelSummary,
});

// TAP's verified workflow ABI requires lowercase export identifiers. Keep the
// descriptive TypeScript exports above for local use and expose canonical ABI
// aliases for the manifest bindings.
export const normalizebookingcreated = normalizeBookingCreated;
export const normalizebookingcancelled = normalizeBookingCancelled;
export const draftworkblock = draftWorkBlock;
export const preparechannelsummary = prepareChannelSummary;

export default workflowNodeCatalog;
