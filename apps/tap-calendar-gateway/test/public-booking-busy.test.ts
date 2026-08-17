import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { loadPublicBookingBusyIntervals } from "../src/public-booking-busy";
import {
  D1PublicBookingAttemptStore,
  D1PublicBookingManagementTokenIssuer,
} from "../src/public-booking-store";

const workspace = "workspace-public-busy";
const principal = "principal-public-busy";
const now = "2026-08-16T12:00:00.000Z";

interface BookingSeed {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly state?: "pending" | "committed" | "rejected";
  readonly bookingKind?: "meeting" | "approval-hold" | "work-block";
  readonly resolutionStatus?: "approved" | "declined" | null;
  readonly holdExpiredAt?: string | null;
  readonly bookingWorkspace?: string;
  readonly bookingPrincipal?: string;
  readonly calendarId?: string;
}

async function seedBooking(seed: BookingSeed): Promise<void> {
  await env.CALENDAR_DB.prepare(
    `INSERT INTO provider_booking_commits (
       workspace_id, principal_id, idempotency_key, request_hash,
       destination_calendar_id, provider_event_id, booking_kind, start_at,
       end_at, state, response_json, last_error_code, created_at, updated_at,
       resolution_status, conflict_calendar_ids_json, hold_expires_at,
       hold_expired_at, request_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, '[]', NULL, ?, NULL)`,
  ).bind(
    seed.bookingWorkspace ?? workspace,
    seed.bookingPrincipal ?? principal,
    seed.id,
    `hash-${seed.id}`,
    seed.calendarId ?? "calendar-busy-primary",
    `event-${seed.id}`,
    seed.bookingKind ?? "meeting",
    seed.start,
    seed.end,
    seed.state ?? "committed",
    now,
    now,
    seed.resolutionStatus ?? null,
    seed.holdExpiredAt ?? null,
  ).run();
}

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_resolutions"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commit_locks"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_booking_commits"),
    env.CALENDAR_DB.prepare("DELETE FROM provider_calendars"),
    env.CALENDAR_DB.prepare("DELETE FROM calendar_connections"),
    env.CALENDAR_DB.prepare(
      `INSERT INTO calendar_connections (
         id, workspace_id, principal_id, provider, mode, label, status,
         credential_ciphertext, token_expires_at, created_at, updated_at
       ) VALUES ('connection-public-busy', ?, ?, 'google', 'oauth', 'Busy test',
                 'connected', 'ciphertext', ?, ?, ?)`,
    ).bind(workspace, principal, "2026-08-17T12:00:00.000Z", now, now),
    ...["calendar-busy-primary", "calendar-busy-secondary"].map((calendarId, index) =>
      env.CALENDAR_DB.prepare(
        `INSERT INTO provider_calendars (
           id, connection_id, provider_calendar_id, name, color, role, writable,
           freshness, is_primary, raw_json, created_at, updated_at
         ) VALUES (?, 'connection-public-busy', ?, ?, '#6758e8', 'owner', 1,
                   'live', ?, '{}', ?, ?)`,
      ).bind(calendarId, `${calendarId}@provider.test`, calendarId, index === 0 ? 1 : 0, now, now)
    ),
  ]);
});

describe("public booking busy intervals", () => {
  it("fails closed for pending and committed rows while returning a minimal coalesced projection", async () => {
    await seedBooking({
      id: "pending",
      state: "pending",
      start: "2026-08-18T09:30:00.000Z",
      end: "2026-08-18T10:30:00.000Z",
    });
    await seedBooking({
      id: "committed",
      start: "2026-08-18T10:15:00.000Z",
      end: "2026-08-18T12:30:00.000Z",
    });
    await seedBooking({
      id: "adjacent",
      bookingKind: "work-block",
      start: "2026-08-18T12:30:00.000Z",
      end: "2026-08-18T13:00:00.000Z",
    });

    await expect(loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: ["calendar-busy-primary"],
      timeMin: "2026-08-18T10:00:00Z",
      timeMax: "2026-08-18T12:45:00Z",
    })).resolves.toEqual([{
      start: "2026-08-18T10:00:00.000Z",
      end: "2026-08-18T12:45:00.000Z",
    }]);
  });

  it("excludes rejected, declined, and expired approval holds", async () => {
    await seedBooking({
      id: "rejected",
      state: "rejected",
      start: "2026-08-18T09:00:00.000Z",
      end: "2026-08-18T09:30:00.000Z",
    });
    await seedBooking({
      id: "declined",
      bookingKind: "approval-hold",
      resolutionStatus: "declined",
      start: "2026-08-18T10:00:00.000Z",
      end: "2026-08-18T10:30:00.000Z",
    });
    await seedBooking({
      id: "expired",
      bookingKind: "approval-hold",
      holdExpiredAt: now,
      start: "2026-08-18T11:00:00.000Z",
      end: "2026-08-18T11:30:00.000Z",
    });
    await seedBooking({
      id: "active-hold",
      bookingKind: "approval-hold",
      start: "2026-08-18T12:00:00.000Z",
      end: "2026-08-18T12:30:00.000Z",
    });

    await expect(loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: ["calendar-busy-primary"],
      timeMin: "2026-08-18T08:00:00.000Z",
      timeMax: "2026-08-18T13:00:00.000Z",
    })).resolves.toEqual([{
      start: "2026-08-18T12:00:00.000Z",
      end: "2026-08-18T12:30:00.000Z",
    }]);
  });

  it("binds workspace, principal, destination calendars, and half-open overlap bounds", async () => {
    const seeds: readonly BookingSeed[] = [
      { id: "wrong-workspace", bookingWorkspace: "workspace-other", start: "2026-08-18T10:00:00.000Z", end: "2026-08-18T10:30:00.000Z" },
      { id: "wrong-principal", bookingPrincipal: "principal-other", start: "2026-08-18T10:30:00.000Z", end: "2026-08-18T11:00:00.000Z" },
      { id: "wrong-calendar", calendarId: "calendar-busy-secondary", start: "2026-08-18T11:00:00.000Z", end: "2026-08-18T11:30:00.000Z" },
      { id: "ends-at-min", start: "2026-08-18T09:30:00.000Z", end: "2026-08-18T10:00:00.000Z" },
      { id: "starts-at-max", start: "2026-08-18T12:00:00.000Z", end: "2026-08-18T12:30:00.000Z" },
      { id: "overlaps-start", start: "2026-08-18T09:59:59.999Z", end: "2026-08-18T10:15:00.000Z" },
      { id: "overlaps-end", start: "2026-08-18T11:45:00.000Z", end: "2026-08-18T12:00:00.001Z" },
    ];
    for (const seed of seeds) await seedBooking(seed);

    await expect(loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: ["calendar-busy-primary", "calendar-busy-primary"],
      timeMin: "2026-08-18T10:00:00.000Z",
      timeMax: "2026-08-18T12:00:00.000Z",
    })).resolves.toEqual([
      { start: "2026-08-18T10:00:00.000Z", end: "2026-08-18T10:15:00.000Z" },
      { start: "2026-08-18T11:45:00.000Z", end: "2026-08-18T12:00:00.000Z" },
    ]);
  });

  it("short-circuits an empty conflict calendar set and rejects invalid ranges", async () => {
    await expect(loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: [],
      timeMin: "2026-08-18T10:00:00.000Z",
      timeMax: "2026-08-18T11:00:00.000Z",
    })).resolves.toEqual([]);
    await expect(loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: ["calendar-busy-primary"],
      timeMin: "2026-08-18T11:00:00.000Z",
      timeMax: "2026-08-18T10:00:00.000Z",
    })).rejects.toThrow("timeMax must be later than timeMin");
  });

  it("projects a managed booking's current interval and stops treating it as busy after cancellation", async () => {
    const operationId = "managed-public-operation-123456";
    const start = "2026-08-18T10:00:00.000Z";
    const end = "2026-08-18T10:30:00.000Z";
    await seedBooking({ id: operationId, start, end });
    const managementSecret = "busy-management-secret-at-least-32-bytes";
    const attempts = new D1PublicBookingAttemptStore(env.CALENDAR_DB, {
      managementSecret,
      managementOrigin: "https://cal.with-tap.ai",
      now: () => Date.parse(now),
      bookingReference: () => "pb_busy_management_reference_12345",
    });
    const claimed = await attempts.claim({
      scope: { workspace, principal },
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requestHash: `hash-${operationId}`,
      slotProofFingerprint: "busy_management_slot_proof_123456",
      providerOperationId: operationId,
      startsAt: start,
      endsAt: end,
      revisionId: "revision-public-busy-managed",
      guest: { name: "Busy Guest", email: "busy@example.com" },
      approvalExpiresAt: null,
    });
    if (claimed.kind !== "claimed") throw new Error("Expected the managed attempt claim.");
    const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
      secret: managementSecret,
      now: () => Date.parse(now),
    });
    await issuer.issue({
      scope: { workspace, principal },
      bookingReference: claimed.attempt.bookingReference,
      pageId: "page-public-busy-managed",
      revisionId: "revision-public-busy-managed",
      destinationCalendarId: "calendar-busy-primary",
      providerBookingId: `event-${operationId}`,
      providerOperationId: operationId,
      startsAt: start,
      endsAt: end,
      guest: { name: "Busy Guest", email: "busy@example.com" },
      approvalExpiresAt: null,
      organizerName: "Busy Organizer",
      eventTitle: "Managed meeting",
      location: "google-meet",
      locationLabel: "Google Meet",
      timeZone: "America/New_York",
    });

    const load = () => loadPublicBookingBusyIntervals({
      database: env.CALENDAR_DB,
      workspace,
      principal,
      conflictCalendarIds: ["calendar-busy-primary"],
      timeMin: "2026-08-18T09:00:00.000Z",
      timeMax: "2026-08-18T13:00:00.000Z",
    });
    await expect(load()).resolves.toEqual([{ start, end }]);

    await env.CALENDAR_DB.prepare(
      `UPDATE public_booking_management_credentials
          SET start_at = ?, end_at = ?, version = 2, updated_at = ?
        WHERE booking_reference = ?`,
    ).bind(
      "2026-08-18T11:00:00.000Z",
      "2026-08-18T11:30:00.000Z",
      now,
      claimed.attempt.bookingReference,
    ).run();
    await expect(load()).resolves.toEqual([{
      start: "2026-08-18T11:00:00.000Z",
      end: "2026-08-18T11:30:00.000Z",
    }]);

    await env.CALENDAR_DB.prepare(
      `UPDATE public_booking_management_credentials
          SET status = 'cancelled', booking_status = 'cancelled',
              cancelled_at = ?, version = 3, updated_at = ?
        WHERE booking_reference = ?`,
    ).bind(now, now, claimed.attempt.bookingReference).run();
    await expect(load()).resolves.toEqual([]);
  });
});
