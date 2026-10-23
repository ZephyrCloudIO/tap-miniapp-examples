import { crmBookingPage } from "./crm-config";
import {
  CRM_MAX_DELIVERY_ATTEMPTS,
  buildCrmBookingPayload,
  crmRetryDelayMs,
  postCrmBooking,
  type CrmBookingStatus,
  type CrmOutcome,
  type CrmPerson,
} from "./crm-delivery";

const LEASE_MS = 2 * 60_000;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;
// The default stored when a page has no display name.
const DEFAULT_ORGANIZER_NAME = "TAP organizer";

export type CrmConnectionStatus = "connected" | "attention";
export type CrmConnectionReason = "invalid_key" | "missing_scope" | "unreachable";

export interface CrmConnectionRow {
  readonly workspace_id: string;
  readonly key_ciphertext: string;
  readonly status: CrmConnectionStatus;
  readonly status_reason: CrmConnectionReason | null;
  readonly connected_by: string;
  readonly connected_at: string;
  readonly updated_at: string;
  readonly last_verified_at: string | null;
  readonly last_delivered_at: string | null;
}

type Database = Pick<D1Database, "prepare" | "batch">;

export async function readCrmConnection(
  database: Database,
  workspace: string,
): Promise<CrmConnectionRow | null> {
  return database.prepare("SELECT * FROM crm_connections WHERE workspace_id = ?")
    .bind(workspace).first<CrmConnectionRow>();
}

/** Reconnecting keeps `connected_at`, so bookings changed while it was broken still go out. */
export async function saveCrmConnection(database: Database, input: {
  readonly workspace: string;
  readonly keyCiphertext: string;
  readonly connectedBy: string;
  readonly now: string;
}): Promise<void> {
  await database.prepare(
    `INSERT INTO crm_connections
       (workspace_id, key_ciphertext, status, status_reason, connected_by,
        connected_at, updated_at, last_verified_at)
     VALUES (?, ?, 'connected', NULL, ?, ?, ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET
       key_ciphertext = excluded.key_ciphertext,
       status = 'connected', status_reason = NULL, connected_by = excluded.connected_by,
       updated_at = excluded.updated_at, last_verified_at = excluded.last_verified_at`,
  ).bind(
    input.workspace, input.keyCiphertext, input.connectedBy,
    input.now, input.now, input.now,
  ).run();
}

export async function markCrmConnection(
  database: Database,
  workspace: string,
  state: { readonly status: "connected" } | { readonly status: "attention"; readonly reason: CrmConnectionReason },
  now: string,
): Promise<void> {
  await database.prepare(
    `UPDATE crm_connections
        SET status = ?, status_reason = ?, updated_at = ?,
            last_verified_at = CASE WHEN ? = 'connected' THEN ? ELSE last_verified_at END
      WHERE workspace_id = ?`,
  ).bind(
    state.status, state.status === "attention" ? state.reason : null, now,
    state.status, now, workspace,
  ).run();
}

/** Deletes the key and anything still waiting to be sent; delivered history stays. */
export async function deleteCrmConnection(database: Database, workspace: string): Promise<void> {
  await database.batch([
    database.prepare(
      `DELETE FROM crm_booking_deliveries
        WHERE workspace_id = ? AND state IN ('queued', 'leased')`,
    ).bind(workspace),
    database.prepare("DELETE FROM crm_connections WHERE workspace_id = ?").bind(workspace),
  ]);
}

export async function pendingCrmDeliveries(database: Database, workspace: string): Promise<number> {
  const row = await database.prepare(
    `SELECT COUNT(*) AS pending FROM crm_booking_deliveries
      WHERE workspace_id = ? AND state IN ('queued', 'leased')`,
  ).bind(workspace).first<{ pending: number }>();
  return row?.pending ?? 0;
}

interface BookingSourceRow {
  readonly booking_reference: string;
  readonly workspace_id: string;
  readonly principal_id: string;
  readonly provider_operation_id: string;
  readonly version: number;
  readonly booking_status: "confirmed" | "cancelled" | "declined" | "expired";
  readonly event_title: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly guest_name: string;
  readonly guest_email: string;
  readonly details_json: string | null;
  readonly join_url: string | null;
  readonly page_slug: string | null;
  readonly profile_slug: string | null;
  readonly organizer_name: string;
  readonly organizer_email: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const storedDetails = (json: string | null): { notes?: string; additionalGuests: string[] } => {
  try {
    const value: unknown = JSON.parse(json ?? "{}");
    if (!isRecord(value)) return { additionalGuests: [] };
    return {
      ...(typeof value.notes === "string" ? { notes: value.notes } : {}),
      additionalGuests: Array.isArray(value.additionalGuests)
        ? value.additionalGuests.filter((item): item is string => typeof item === "string")
        : [],
    };
  } catch {
    return { additionalGuests: [] };
  }
};

/**
 * Collective hosts are snapshotted with the booking. An individual page's host is
 * the page owner: the connected account of its destination calendar.
 */
const bookingHosts = async (database: Database, row: BookingSourceRow): Promise<CrmPerson[]> => {
  const reservations = await database.prepare(
    `SELECT host_snapshot_json FROM calendar_host_reservations
      WHERE workspace_id = ? AND organizer_principal_id = ? AND booking_operation_id = ?
        AND reservation_id = 'initial' AND host_snapshot_json IS NOT NULL`,
  ).bind(row.workspace_id, row.principal_id, row.provider_operation_id)
    .all<{ host_snapshot_json: string }>();
  const hosts: CrmPerson[] = [];
  for (const reservation of reservations.results) {
    try {
      const host: unknown = JSON.parse(reservation.host_snapshot_json);
      if (!isRecord(host) || typeof host.email !== "string" || !host.email) continue;
      hosts.push({
        email: host.email,
        ...(typeof host.displayName === "string" && host.displayName ? { name: host.displayName } : {}),
      });
    } catch {
      // A corrupt snapshot only costs the hosts field, never the booking.
    }
  }
  if (hosts.length === 0 && row.organizer_email && EMAIL_PATTERN.test(row.organizer_email)) {
    hosts.push({
      email: row.organizer_email,
      ...(row.organizer_name && row.organizer_name !== DEFAULT_ORGANIZER_NAME
        ? { name: row.organizer_name }
        : {}),
    });
  }
  return hosts;
};

const deliveryStatus = (row: BookingSourceRow): CrmBookingStatus =>
  row.booking_status === "confirmed" ? "CONFIRMED" : "CANCELLED";

/**
 * Fills the queue from booking state, so every place a booking is confirmed,
 * approved, rescheduled, cancelled, declined or expired is covered without
 * another hook beside the email outbox. A pending booking is never sent, and a
 * decline or expiry is sent only for a booking the CRM was already told about.
 * One message per (booking, status, version); the CRM ignores anything at or
 * below the version it has applied.
 */
export async function reconcileCrmDeliveries(database: Database, options: {
  readonly now: string;
  readonly limit: number;
  readonly id: () => string;
}): Promise<number> {
  const due = (await database.prepare(
    `SELECT m.booking_reference, m.workspace_id, m.principal_id, m.provider_operation_id,
            m.version, m.booking_status, m.event_title, m.start_at, m.end_at,
            m.guest_name, m.guest_email, a.details_json,
            json_extract(c.response_json, '$.booking.providerJoinUrl') AS join_url,
            page.current_slug AS page_slug, profile.current_slug AS profile_slug,
            m.organizer_name, connected.label AS organizer_email
       FROM public_booking_management_credentials AS m
       JOIN crm_connections AS k
         ON k.workspace_id = m.workspace_id AND k.status = 'connected'
        AND m.updated_at >= k.connected_at
       LEFT JOIN public_booking_attempts AS a ON a.booking_reference = m.booking_reference
       LEFT JOIN provider_booking_commits AS c
         ON c.workspace_id = m.workspace_id AND c.principal_id = m.principal_id
        AND c.idempotency_key = m.provider_operation_id
       LEFT JOIN public_booking_pages AS page ON page.id = m.page_id
       LEFT JOIN public_booking_profiles AS profile ON profile.id = page.profile_id
       LEFT JOIN provider_calendars AS destination ON destination.id = m.destination_calendar_id
       LEFT JOIN calendar_connections AS connected ON connected.id = destination.connection_id
      WHERE (
        (m.booking_status = 'confirmed' AND m.status = 'active' AND NOT EXISTS (
          SELECT 1 FROM crm_booking_deliveries AS d
           WHERE d.booking_reference = m.booking_reference
             AND d.event_key = 'CONFIRMED:v' || m.version))
        OR
        (m.booking_status IN ('cancelled', 'declined', 'expired')
          AND (m.booking_status = 'cancelled' OR EXISTS (
            SELECT 1 FROM crm_booking_deliveries AS sent
             WHERE sent.booking_reference = m.booking_reference
               AND sent.booking_status = 'CONFIRMED'))
          AND NOT EXISTS (
            SELECT 1 FROM crm_booking_deliveries AS d
             WHERE d.booking_reference = m.booking_reference
               AND d.event_key = 'CANCELLED:v' || m.version))
      )
      ORDER BY m.updated_at, m.booking_reference
      LIMIT ?`,
  ).bind(options.limit).all<BookingSourceRow>()).results;
  let enqueued = 0;
  for (const row of due) {
    const status = deliveryStatus(row);
    const details = storedDetails(row.details_json);
    const hosts = await bookingHosts(database, row);
    const payload = buildCrmBookingPayload({
      bookingReference: row.booking_reference,
      status,
      version: row.version,
      title: row.event_title,
      startsAt: row.start_at,
      endsAt: row.end_at,
      meetingUrl: row.join_url,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      additionalGuestEmails: details.additionalGuests,
      hosts,
      notes: details.notes ?? null,
      bookingPage: row.profile_slug && row.page_slug
        ? crmBookingPage(row.profile_slug, row.page_slug)
        : null,
    });
    const result = await database.prepare(
      `INSERT OR IGNORE INTO crm_booking_deliveries
         (delivery_id, booking_reference, event_key, workspace_id, booking_status,
          booking_version, payload_json, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      options.id(), row.booking_reference, `${status}:v${row.version}`, row.workspace_id,
      status, row.version, JSON.stringify(payload), options.now, options.now, options.now,
    ).run();
    enqueued += Number(result.meta.changes ?? 0);
  }
  return enqueued;
}

interface LeasedDelivery {
  readonly delivery_id: string;
  readonly workspace_id: string;
  readonly payload_json: string;
  readonly attempt_count: number;
  readonly lease_token: string;
}

async function leaseNextDelivery(
  database: Database,
  now: string,
  leaseToken: string,
): Promise<LeasedDelivery | null> {
  const leaseUntil = new Date(Date.parse(now) + LEASE_MS).toISOString();
  const due = `attempt_count < ? AND (
      (state = 'queued' AND next_attempt_at <= ?) OR (state = 'leased' AND lease_until <= ?))
    AND EXISTS (SELECT 1 FROM crm_connections AS k
                 WHERE k.workspace_id = crm_booking_deliveries.workspace_id
                   AND k.status = 'connected')`;
  return database.prepare(
    `UPDATE crm_booking_deliveries
        SET state = 'leased', attempt_count = attempt_count + 1,
            lease_token = ?, lease_until = ?, updated_at = ?
      WHERE delivery_id = (
        SELECT delivery_id FROM crm_booking_deliveries
         WHERE ${due}
         ORDER BY next_attempt_at, created_at, delivery_id LIMIT 1)
        AND ${due}
      RETURNING delivery_id, workspace_id, payload_json, attempt_count, lease_token`,
  ).bind(
    leaseToken, leaseUntil, now,
    CRM_MAX_DELIVERY_ATTEMPTS, now, now,
    CRM_MAX_DELIVERY_ATTEMPTS, now, now,
  ).first<LeasedDelivery>();
}

export interface CrmDeliveryDependencies {
  readonly database: Database;
  /** The CRM this environment may write to (the gateway's CRM_API_URL). */
  readonly apiUrl: string;
  readonly fetch: typeof fetch;
  /** Decrypts the stored bot key; throws if it cannot. */
  readonly decryptKey: (ciphertext: string) => Promise<string>;
  readonly now: () => number;
  readonly random: () => number;
  readonly id: () => string;
  readonly log: (level: "info" | "warn", message: string, fields: Record<string, unknown>) => void;
}

export interface CrmDeliverySummary {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly stopped: number;
  readonly paused: number;
}

export async function deliverCrmBookings(
  dependencies: CrmDeliveryDependencies,
  limit: number,
): Promise<CrmDeliverySummary> {
  const { database } = dependencies;
  const summary = { claimed: 0, delivered: 0, retried: 0, stopped: 0, paused: 0 };
  const stamp = (): string => new Date(dependencies.now()).toISOString();
  await database.prepare(
    `UPDATE crm_booking_deliveries
        SET state = 'dead', payload_json = NULL, lease_token = NULL, lease_until = NULL,
            last_error_code = COALESCE(last_error_code, 'CRM_ATTEMPTS_EXHAUSTED'),
            updated_at = ?, dead_at = ?
      WHERE state = 'leased' AND lease_until <= ? AND attempt_count >= ?`,
  ).bind(stamp(), stamp(), stamp(), CRM_MAX_DELIVERY_ATTEMPTS).run();
  const connections = new Map<string, { apiUrl: string; botKey: string } | null>();
  for (let index = 0; index < limit; index += 1) {
    const leased = await leaseNextDelivery(database, stamp(), dependencies.id());
    if (!leased) break;
    summary.claimed += 1;
    let connection = connections.get(leased.workspace_id);
    if (connection === undefined) {
      const row = await readCrmConnection(database, leased.workspace_id);
      try {
        connection = row && row.status === "connected"
          ? { apiUrl: dependencies.apiUrl, botKey: await dependencies.decryptKey(row.key_ciphertext) }
          : null;
      } catch {
        // An unreadable key is as good as a revoked one: reconnect stores a new one.
        await markCrmConnection(
          database, leased.workspace_id, { status: "attention", reason: "invalid_key" }, stamp(),
        );
        connection = null;
      }
      connections.set(leased.workspace_id, connection);
    }
    if (!connection) {
      await settle(database, leased, { kind: "pause" }, stamp());
      summary.paused += 1;
      continue;
    }
    const outcome = await postCrmBooking(
      dependencies.fetch,
      connection,
      JSON.parse(leased.payload_json),
      dependencies.now(),
    );
    const now = stamp();
    if (outcome.kind === "delivered") {
      await settle(database, leased, { kind: "delivered", outcome }, now);
      await database.prepare(
        "UPDATE crm_connections SET last_delivered_at = ? WHERE workspace_id = ?",
      ).bind(now, leased.workspace_id).run();
      summary.delivered += 1;
    } else if (outcome.kind === "invalid_key" || outcome.kind === "missing_scope") {
      // The key was revoked or rescoped. Stop for this workspace and show it in
      // Settings; the message stays queued and goes out after a reconnect.
      await markCrmConnection(
        database, leased.workspace_id, { status: "attention", reason: outcome.kind }, now,
      );
      connections.set(leased.workspace_id, null);
      await settle(database, leased, { kind: "pause" }, now);
      dependencies.log("warn", "crm connection needs attention", {
        workspace_id: leased.workspace_id,
        reason: outcome.kind,
        request_id: outcome.requestId,
      });
      summary.paused += 1;
    } else if (outcome.kind === "retry" && leased.attempt_count < CRM_MAX_DELIVERY_ATTEMPTS) {
      const delay = Math.max(
        outcome.retryAfterMs ?? 0,
        crmRetryDelayMs(leased.attempt_count, dependencies.random()),
      );
      await settle(database, leased, { kind: "retry", outcome, delay }, now);
      summary.retried += 1;
    } else {
      const code = outcome.kind === "rejected" ? outcome.code : "CRM_ATTEMPTS_EXHAUSTED";
      await settle(database, leased, { kind: "dead", code, outcome }, now);
      // Never the body: the request id is how the CRM side finds the error.
      dependencies.log("warn", "crm delivery stopped", {
        delivery_id: leased.delivery_id,
        code,
        request_id: outcome.requestId,
      });
      summary.stopped += 1;
    }
  }
  return summary;
}

type Settlement =
  | { readonly kind: "delivered"; readonly outcome: Extract<CrmOutcome, { kind: "delivered" }> }
  | { readonly kind: "retry"; readonly outcome: Extract<CrmOutcome, { kind: "retry" }>; readonly delay: number }
  | { readonly kind: "dead"; readonly code: string; readonly outcome: CrmOutcome }
  | { readonly kind: "pause" };

async function settle(
  database: Database,
  leased: LeasedDelivery,
  settlement: Settlement,
  now: string,
): Promise<void> {
  const where = "WHERE delivery_id = ? AND state = 'leased' AND lease_token = ?";
  const keys = [leased.delivery_id, leased.lease_token] as const;
  const requestId = "outcome" in settlement ? settlement.outcome.requestId : null;
  let statement: D1PreparedStatement;
  switch (settlement.kind) {
    case "delivered":
      statement = database.prepare(
        `UPDATE crm_booking_deliveries
            SET state = 'delivered', payload_json = NULL, lease_token = NULL, lease_until = NULL,
                last_error_code = NULL, last_request_id = ?, updated_at = ?, delivered_at = ? ${where}`,
      ).bind(requestId, now, now, ...keys);
      break;
    case "retry":
      statement = database.prepare(
        `UPDATE crm_booking_deliveries
            SET state = 'queued', lease_token = NULL, lease_until = NULL,
                last_error_code = ?, last_request_id = ?, next_attempt_at = ?, updated_at = ? ${where}`,
      ).bind(
        settlement.outcome.code, requestId,
        new Date(Date.parse(now) + settlement.delay).toISOString(), now, ...keys,
      );
      break;
    case "dead":
      statement = database.prepare(
        `UPDATE crm_booking_deliveries
            SET state = 'dead', payload_json = NULL, lease_token = NULL, lease_until = NULL,
                last_error_code = ?, last_request_id = ?, updated_at = ?, dead_at = ? ${where}`,
      ).bind(settlement.code, requestId, now, now, ...keys);
      break;
    case "pause":
      // Not the delivery's fault, so the attempt is not spent.
      statement = database.prepare(
        `UPDATE crm_booking_deliveries
            SET state = 'queued', attempt_count = MAX(attempt_count - 1, 0),
                lease_token = NULL, lease_until = NULL, updated_at = ? ${where}`,
      ).bind(now, ...keys);
      break;
  }
  await statement.run();
}
