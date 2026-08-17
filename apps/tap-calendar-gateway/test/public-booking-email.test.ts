import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1PublicBookingEmailOutbox,
  createPublicBookingManagementEmailPort,
  deliverPublicBookingEmailOutboxSafely,
  enqueuePublicBookingEmailAfterCommitSafely,
  escapePublicBookingEmailHtml,
  publicBookingEmailManagementUrl,
  renderPublicBookingEmail,
  type PublicBookingEmailEnqueueInput,
  type PublicBookingEmailKind,
  type PublicBookingEmailMessage,
  type PublicBookingEmailSendPort,
} from "../src/public-booking-email";
import {
  D1PublicBookingManagementTokenIssuer,
} from "../src/public-booking-store";

const baseNow = Date.parse("2026-08-16T18:00:00.000Z");
const managementSecret = "management-secret-for-email-tests-32-bytes-minimum";
const managementOrigin = "https://cal.with-tap.ai";
const workspace = "workspace-email-test";
const principal = "principal-email-test";
const bookingReference = "pb_email_booking_reference_123456";
const startsAt = "2026-08-20T17:00:00.000Z";
const endsAt = "2026-08-20T17:30:00.000Z";

const idFactory = (): (() => string) => {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
};

const eventFixture = (
  kind: PublicBookingEmailKind = "booking-confirmed",
  overrides: Partial<PublicBookingEmailEnqueueInput> = {},
): PublicBookingEmailEnqueueInput => ({
  eventKey: `email-event-${kind}-001`,
  bookingReference,
  scope: { workspace, principal },
  kind,
  recipient: { name: "Public Guest", email: "guest@example.com" },
  organizerName: "TAP Organizer",
  eventTitle: "Architecture review",
  startsAt,
  endsAt,
  timeZone: "America/New_York",
  ...(kind === "booking-rescheduled" ? {
    previousStartsAt: "2026-08-19T17:00:00.000Z",
    previousEndsAt: "2026-08-19T17:30:00.000Z",
  } : {}),
  ...overrides,
});

const deliveryOptions = {
  managementSecret,
  managementOrigin,
  from: { name: "TAP Calendar", email: "bookings@with-tap.ai" },
  brandName: "TAP",
} as const;

const seedBooking = async (): Promise<string> => {
  const now = new Date(baseNow).toISOString();
  await env.CALENDAR_DB.prepare(
    `INSERT INTO public_booking_attempts (
       workspace_id, principal_id, idempotency_key, request_hash,
       provider_operation_id, booking_reference, revision_id, start_at,
       end_at, guest_name, guest_email, approval_expires_at, state,
       response_json, rejection_code, last_error_code, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending',
               NULL, NULL, NULL, ?, ?)`,
  ).bind(
    workspace,
    principal,
    "email-idempotency-key-00000001",
    "email_request_hash_1234567890",
    "tap_email_provider_operation_123456",
    bookingReference,
    "email-revision-123",
    startsAt,
    endsAt,
    "Public Guest",
    "guest@example.com",
    now,
    now,
  ).run();
  const issuer = new D1PublicBookingManagementTokenIssuer(env.CALENDAR_DB, {
    secret: managementSecret,
    now: () => baseNow,
  });
  const credential = await issuer.issue({
    scope: { workspace, principal },
    bookingReference,
    pageId: "email-page-123",
    revisionId: "email-revision-123",
    destinationCalendarId: "email-destination-calendar-123",
    providerBookingId: "email-provider-booking-123",
    providerOperationId: "tap_email_provider_operation_123456",
    startsAt,
    endsAt,
    guest: { name: "Public Guest", email: "guest@example.com" },
    approvalExpiresAt: null,
    organizerName: "TAP Organizer",
    eventTitle: "Architecture review",
    location: "google-meet",
    locationLabel: "Google Meet",
    timeZone: "America/New_York",
  });
  return credential.token;
};

beforeEach(async () => {
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_email_outbox"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_mutations"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_management_credentials"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_slot_proof_uses"),
    env.CALENDAR_DB.prepare("DELETE FROM public_booking_attempts"),
  ]);
});

describe("public booking email rendering", () => {
  it("renders all lifecycle messages as escaped text and HTML with a fragment-only credential", async () => {
    const token = await seedBooking();
    const kinds: readonly PublicBookingEmailKind[] = [
      "booking-confirmed",
      "approval-requested",
      "approval-approved",
      "approval-declined",
      "approval-expired",
      "booking-cancelled",
      "booking-rescheduled",
    ];
    for (const kind of kinds) {
      const message = await renderPublicBookingEmail(eventFixture(kind, {
        organizerName: "TAP <Organizer>",
        eventTitle: "Architecture & <review>",
      }), deliveryOptions);
      expect(message.subject).toContain("Architecture & <review>");
      expect(message.text).toContain("Powered by TAP");
      expect(message.html).toContain("Powered by TAP");
      expect(message.html).toContain("Architecture &amp; &lt;review&gt;");
      expect(message.html).not.toContain("TAP <Organizer>");
      expect(message.text).toContain(`${managementOrigin}/manage#${token}`);
      expect(message.html).toContain(`${managementOrigin}/manage#${token}`);
      expect(message.text).not.toContain("?token=");
      expect(message.headers).toEqual({ "X-TAP-Booking-Event": kind });
      if (kind === "booking-rescheduled") {
        expect(message.text).toContain("Previous time:");
      }
    }
    expect(escapePublicBookingEmailHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    await expect(publicBookingEmailManagementUrl({
      workspace,
      principal,
      bookingReference,
    }, deliveryOptions)).resolves.toBe(`${managementOrigin}/manage#${token}`);
  });

  it("rejects unsafe, oversized, noncanonical, and structurally invalid payloads", async () => {
    await expect(renderPublicBookingEmail(eventFixture("booking-confirmed", {
      eventTitle: "unsafe\nsubject",
    }), deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_event" });
    await expect(renderPublicBookingEmail(eventFixture("booking-confirmed", {
      recipient: { name: "Guest", email: "UPPER@example.com" },
    }), deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_address" });
    await expect(renderPublicBookingEmail(eventFixture("booking-confirmed", {
      eventTitle: "x".repeat(201),
    }), deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_event" });
    await expect(renderPublicBookingEmail(eventFixture("booking-confirmed", {
      timeZone: "Not/A_Time_Zone",
    }), deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_event" });
    await expect(renderPublicBookingEmail({
      ...eventFixture("booking-confirmed"),
      kind: "booking-rescheduled",
    }, deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_event" });
    await expect(renderPublicBookingEmail(eventFixture("booking-confirmed", {
      previousStartsAt: "2026-08-19T17:00:00.000Z",
      previousEndsAt: "2026-08-19T17:30:00.000Z",
    }), deliveryOptions)).rejects.toMatchObject({ code: "invalid_email_event" });
  });
});

describe("D1 public booking email outbox", () => {
  it("enqueues idempotently, supports an owning D1 batch, and never persists its bearer URL", async () => {
    const token = await seedBooking();
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => baseNow,
      id: idFactory(),
    });
    const prepared = outbox.prepareEnqueue(eventFixture());
    await env.CALENDAR_DB.batch([prepared.statement]);
    const replay = await outbox.enqueue(eventFixture());
    expect(replay).toEqual({ kind: "existing", outboxId: prepared.outboxId });
    expect(await outbox.enqueue(eventFixture("approval-approved"))).toMatchObject({
      kind: "enqueued",
    });
    await expect(outbox.enqueue(eventFixture("booking-confirmed", {
      eventTitle: "Conflicting title",
    }))).rejects.toMatchObject({ code: "email_event_conflict" });

    const rows = await env.CALENDAR_DB.prepare(
      "SELECT * FROM public_booking_email_outbox ORDER BY event_key",
    ).all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(2);
    const serialized = JSON.stringify(rows.results);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain("/manage");
    expect(serialized).not.toContain(managementSecret);
  });

  it("adapts management lifecycle names without sending inside the management request", async () => {
    await seedBooking();
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => baseNow,
      id: idFactory(),
    });
    const managementEmail = createPublicBookingManagementEmailPort(outbox);
    await managementEmail.enqueue({
      eventKey: "management-reschedule-event-001",
      bookingReference,
      scope: { workspace, principal },
      kind: "rescheduled",
      recipient: { name: "Public Guest", email: "guest@example.com" },
      organizerName: "TAP Organizer",
      eventTitle: "Architecture review",
      startsAt,
      endsAt,
      timeZone: "America/New_York",
      previousStartsAt: "2026-08-19T17:00:00.000Z",
      previousEndsAt: "2026-08-19T17:30:00.000Z",
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT kind FROM public_booking_email_outbox",
    ).first<string>("kind")).toBe("booking-rescheduled");
  });

  it("retries transient binding errors with backoff and later marks delivery", async () => {
    await seedBooking();
    let clock = baseNow;
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => clock,
      id: idFactory(),
      baseRetryMilliseconds: 4_000,
      maxRetryMilliseconds: 60_000,
      random: () => 0,
    });
    await outbox.enqueue(eventFixture());
    const sent: PublicBookingEmailMessage[] = [];
    let calls = 0;
    const sender: PublicBookingEmailSendPort = {
      async send(message) {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("must never be stored"), {
            code: "E_RATE_LIMIT_EXCEEDED",
          });
        }
        sent.push(message);
      },
    };
    await expect(outbox.deliverDue(sender, { ...deliveryOptions, limit: 1 })).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retried: 1,
      deadLettered: 0,
      infrastructureFailed: false,
    });
    const retry = await env.CALENDAR_DB.prepare(
      `SELECT state, attempt_count, next_attempt_at, last_error_code
         FROM public_booking_email_outbox`,
    ).first<Record<string, unknown>>();
    expect(retry).toEqual({
      state: "queued",
      attempt_count: 1,
      next_attempt_at: "2026-08-16T18:00:03.000Z",
      last_error_code: "E_RATE_LIMIT_EXCEEDED",
    });
    expect(JSON.stringify(retry)).not.toContain("must never be stored");
    expect(await env.CALENDAR_DB.prepare(
      "SELECT COUNT(*) AS count FROM public_booking_management_credentials",
    ).first<number>("count")).toBe(1);

    clock += 2_999;
    expect((await outbox.deliverDue(sender, { ...deliveryOptions, limit: 1 })).claimed).toBe(0);
    clock += 1;
    await expect(outbox.deliverDue(sender, { ...deliveryOptions, limit: 1 })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("Manage booking:");
    expect(await env.CALENDAR_DB.prepare(
      "SELECT state FROM public_booking_email_outbox",
    ).first<string>("state")).toBe("delivered");
  });

  it("dead-letters permanent failures and bounded retry exhaustion without leaking messages", async () => {
    await seedBooking();
    let clock = baseNow;
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => clock,
      id: idFactory(),
      maxAttempts: 2,
      baseRetryMilliseconds: 1_000,
      maxRetryMilliseconds: 1_000,
      random: () => 0.5,
    });
    await outbox.enqueue(eventFixture());
    const permanentSender: PublicBookingEmailSendPort = {
      async send() {
        throw Object.assign(new Error("guest@example.com secret provider detail"), {
          code: "E_RECIPIENT_SUPPRESSED",
        });
      },
    };
    expect(await outbox.deliverDue(permanentSender, deliveryOptions)).toMatchObject({
      claimed: 1,
      deadLettered: 1,
    });
    const dead = await env.CALENDAR_DB.prepare(
      "SELECT state, attempt_count, last_error_code FROM public_booking_email_outbox",
    ).first<Record<string, unknown>>();
    expect(dead).toEqual({
      state: "dead",
      attempt_count: 1,
      last_error_code: "E_RECIPIENT_SUPPRESSED",
    });
    expect(JSON.stringify(dead)).not.toContain("guest@example.com secret provider detail");

    await outbox.enqueue(eventFixture("approval-approved"));
    const transientSender: PublicBookingEmailSendPort = {
      async send() {
        throw new Error("temporary");
      },
    };
    expect(await outbox.deliverDue(transientSender, deliveryOptions)).toMatchObject({ retried: 1 });
    clock += 1_000;
    expect(await outbox.deliverDue(transientSender, deliveryOptions)).toMatchObject({
      claimed: 1,
      deadLettered: 1,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT attempt_count FROM public_booking_email_outbox WHERE event_key = ?",
    ).bind("email-event-approval-approved-001").first<number>("attempt_count")).toBe(2);
  });

  it("leases atomically so concurrent drains send one queued event once", async () => {
    await seedBooking();
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => baseNow,
      id: idFactory(),
    });
    await outbox.enqueue(eventFixture());
    let sends = 0;
    const sender: PublicBookingEmailSendPort = {
      async send() {
        sends += 1;
      },
    };
    const summaries = await Promise.all([
      outbox.deliverDue(sender, { ...deliveryOptions, limit: 1 }),
      outbox.deliverDue(sender, { ...deliveryOptions, limit: 1 }),
    ]);
    expect(summaries.reduce((total, value) => total + value.claimed, 0)).toBe(1);
    expect(sends).toBe(1);
  });

  it("reclaims expired leases and safe adapters never reject booking or scheduled paths", async () => {
    await seedBooking();
    let clock = baseNow;
    const outbox = new D1PublicBookingEmailOutbox(env.CALENDAR_DB, {
      now: () => clock,
      id: idFactory(),
      maxAttempts: 2,
    });
    const enqueued = await outbox.enqueue(eventFixture());
    await env.CALENDAR_DB.prepare(
      `UPDATE public_booking_email_outbox
          SET state = 'leased', attempt_count = 1, lease_token = ?, lease_until = ?
        WHERE outbox_id = ?`,
    ).bind(
      "11111111-1111-4111-8111-111111111111",
      new Date(baseNow - 1).toISOString(),
      enqueued.outboxId,
    ).run();
    const sender: PublicBookingEmailSendPort = { async send() {} };
    expect(await outbox.deliverDue(sender, deliveryOptions)).toMatchObject({
      claimed: 1,
      delivered: 1,
    });
    expect(await env.CALENDAR_DB.prepare(
      "SELECT attempt_count FROM public_booking_email_outbox WHERE outbox_id = ?",
    ).bind(enqueued.outboxId).first<number>("attempt_count")).toBe(2);

    const missingBooking = eventFixture("approval-approved", {
      bookingReference: "pb_missing_booking_reference_1234",
    });
    await expect(enqueuePublicBookingEmailAfterCommitSafely(outbox, missingBooking)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(deliverPublicBookingEmailOutboxSafely(outbox, sender, {
      ...deliveryOptions,
      managementSecret: "too-short",
    })).resolves.toEqual({
      claimed: 0,
      delivered: 0,
      retried: 0,
      deadLettered: 0,
      infrastructureFailed: true,
    });
    clock += 1;
  });
});
