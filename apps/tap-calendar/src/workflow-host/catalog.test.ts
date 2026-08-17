import { describe, expect, it } from "@rstest/core";
import {
  draftWorkBlock,
  normalizeBookingCancelled,
  normalizeBookingCreated,
  prepareChannelSummary,
  workflowNodeCatalog,
  type JsonValue,
  type WorkflowNodeInvocation,
} from "./catalog";

function invocation(
  inputName: "booking" | "request",
  value: Record<string, JsonValue>,
): WorkflowNodeInvocation {
  return { inputs: { [inputName]: value }, config: {} };
}

const bookingCreated = {
  bookingId: "booking-1",
  title: "Architecture advisory",
  start: "2026-08-17T14:00:00-04:00",
  end: "2026-08-17T15:00:00-04:00",
  eventTypeId: "event-type-advisory",
  location: "zoom",
  status: "confirmed",
  guestName: "Avery Brooks",
  guestEmail: "avery@example.com",
  bookingAnswers: { confidentialGoal: "Acquisition integration" },
  linkedTapContent: "Private task details",
  audience: {
    canSeeGuestIdentity: false,
    canSeeMeetingDetails: false,
    canSeeLocation: false,
  },
} satisfies Record<string, JsonValue>;

describe("TAP Calendar workflow node catalog", () => {
  it("exports the exact schema-bound node functions", () => {
    expect(Object.keys(workflowNodeCatalog)).toEqual([
      "normalizeBookingCreated",
      "normalizeBookingCancelled",
      "draftWorkBlock",
      "prepareChannelSummary",
    ]);
    for (const node of Object.values(workflowNodeCatalog)) {
      expect(typeof node).toBe("function");
    }
  });

  it("normalizes booking-created events without unauthorized identity or answers", () => {
    const result = normalizeBookingCreated(invocation("booking", bookingCreated));
    expect(result).toEqual({
      outcome: "ready",
      outputs: {
        normalized: {
          bookingId: "booking-1",
          event: "booking.created",
          status: "confirmed",
          title: "Architecture advisory",
          start: "2026-08-17T14:00:00-04:00",
          end: "2026-08-17T15:00:00-04:00",
          eventTypeId: "event-type-advisory",
          location: "zoom",
          audience: {
            canSeeGuestIdentity: false,
            canSeeMeetingDetails: false,
            canSeeLocation: false,
          },
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Avery Brooks");
    expect(serialized).not.toContain("avery@example.com");
    expect(serialized).not.toContain("Acquisition integration");
    expect(serialized).not.toContain("Private task details");
  });

  it("preserves guest identity only when the audience policy permits it", () => {
    const result = normalizeBookingCreated(
      invocation("booking", {
        ...bookingCreated,
        audience: {
          canSeeGuestIdentity: true,
          canSeeMeetingDetails: true,
          canSeeLocation: true,
        },
      }),
    );
    expect(result.outputs.normalized).toMatchObject({
      guestName: "Avery Brooks",
      audience: { canSeeGuestIdentity: true },
    });
    expect(JSON.stringify(result)).not.toContain("avery@example.com");
  });

  it("uses the error outcome without writing off-schema diagnostics", () => {
    const result = normalizeBookingCreated(
      invocation("booking", {
        bookingId: "booking-1",
        title: "Broken meeting",
        start: "2026-08-17T15:00:00Z",
        end: "2026-08-17T14:00:00Z",
        status: "confirmed",
      }),
    );
    expect(result).toEqual({ outcome: "error", outputs: {} });
  });

  it("normalizes cancellation events without free-form cancellation text", () => {
    const result = normalizeBookingCancelled(
      invocation("booking", {
        bookingId: "booking-1",
        cancelledAt: "2026-08-16T18:00:00Z",
        start: "2026-08-17T18:00:00Z",
        reason: "Confidential personnel matter",
        guestName: "Avery Brooks",
        guestEmail: "avery@example.com",
      }),
    );
    expect(result).toEqual({
      outcome: "ready",
      outputs: {
        normalized: {
          bookingId: "booking-1",
          event: "booking.cancelled",
          status: "cancelled",
          occurredAt: "2026-08-16T18:00:00Z",
          start: "2026-08-17T18:00:00Z",
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Confidential personnel matter");
    expect(serialized).not.toContain("Avery Brooks");
    expect(serialized).not.toContain("avery@example.com");
  });

  it("drafts a deterministic, write-free Work Block", () => {
    const request = {
      taskId: "task-launch",
      title: "Prepare confidential launch notes",
      calendarId: "cal-work",
      start: "2026-08-17T09:00:00-04:00",
      end: "2026-08-17T10:00:00-04:00",
      taskLabel: "Task · Customer launch",
      privateContent: "Customer acquisition plan",
    } satisfies Record<string, JsonValue>;
    const result = draftWorkBlock(invocation("request", request));
    expect(result).toEqual({
      outcome: "ready",
      outputs: {
        draft: {
          id: "work-block-16d01286",
          title: "Prepare confidential launch notes",
          calendarId: "cal-work",
          start: "2026-08-17T09:00:00-04:00",
          end: "2026-08-17T10:00:00-04:00",
          kind: "work-block",
          status: "confirmed",
          source: {
            kind: "task",
            id: "task-launch",
            label: "Task · Customer launch",
          },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("Customer acquisition plan");
    expect(draftWorkBlock(invocation("request", request))).toEqual(result);
  });

  it("redacts a shared Calendar Channel Summary by default", () => {
    const result = prepareChannelSummary(
      invocation("booking", {
        bookingId: "booking-1",
        event: "booking.created",
        status: "confirmed",
        start: "2026-08-17T14:00:00-04:00",
        title: "Confidential acquisition review",
        location: "zoom",
        guestName: "Avery Brooks",
        guestEmail: "avery@example.com",
        bookingAnswers: { goal: "Acquire a competitor" },
        linkedTapContent: "Private task details",
        audience: {
          canSeeGuestIdentity: false,
          canSeeMeetingDetails: false,
          canSeeLocation: false,
        },
      }),
    );
    expect(result).toEqual({
      outcome: "ready",
      outputs: {
        summary: {
          title: "Meeting scheduled",
          body: "External guest · Meeting · 2026-08-17T14:00:00-04:00",
          redacted: true,
          bookingId: "booking-1",
          event: "booking.created",
          status: "confirmed",
        },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Avery Brooks");
    expect(serialized).not.toContain("avery@example.com");
    expect(serialized).not.toContain("Acquire a competitor");
    expect(serialized).not.toContain("Private task details");
    expect(serialized).not.toContain("Confidential acquisition review");
  });

  it("includes only fields authorized for every summary viewer", () => {
    const result = prepareChannelSummary(
      invocation("booking", {
        bookingId: "booking-1",
        event: "booking.created",
        status: "confirmed",
        start: "2026-08-17T14:00:00-04:00",
        title: "Architecture advisory",
        location: "zoom",
        guestName: "Avery Brooks",
        audience: {
          canSeeGuestIdentity: true,
          canSeeMeetingDetails: true,
          canSeeLocation: true,
        },
      }),
    );
    expect(result).toEqual({
      outcome: "ready",
      outputs: {
        summary: {
          title: "Meeting scheduled",
          body:
            "Avery Brooks · Architecture advisory · 2026-08-17T14:00:00-04:00 · zoom",
          redacted: false,
          bookingId: "booking-1",
          event: "booking.created",
          status: "confirmed",
        },
      },
    });
  });

  it("is deterministic and does not mutate workflow inputs", () => {
    const input = invocation("booking", bookingCreated);
    const before = JSON.stringify(input);
    expect(normalizeBookingCreated(input)).toEqual(normalizeBookingCreated(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});
