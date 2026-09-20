import { parsePublicBookingPublication, type PublicBookingProfilePublicationInput } from "./public-booking-publication";
import type { CollectiveHost, WorkspaceBookingDefinition, WorkspaceEventType } from "./collective-types";

export type BookingScope = { readonly workspace: string; readonly principal: string };
type Database = Pick<D1Database, "prepare" | "batch">;

export class CollectiveBookingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = (message: string): never => { throw new CollectiveBookingError(400, "invalid_shared_booking", message); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, name: string, max = 160): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value)) return invalid(`${name} is invalid.`);
  return value.trim();
};
const version = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid("The expected version is invalid.");
  return Number(value);
};
const conflict = (): never => { throw new CollectiveBookingError(409, "shared_booking_changed", "These settings changed. Refresh before saving again."); };

export const workspaceProfileScope = (workspace: string): BookingScope & { readonly ownerKind: "workspace" } => ({
  workspace, principal: `workspace:${workspace}`, ownerKind: "workspace",
});
export const workspaceProfileSourceId = "workspace-booking-profile";

export async function readHost(database: Pick<D1Database, "prepare">, scope: BookingScope): Promise<{ readonly enabled: boolean; readonly host: CollectiveHost } | null> {
  const row = await database.prepare("SELECT enabled, policy_json FROM calendar_booking_hosts WHERE workspace_id = ? AND principal_id = ?")
    .bind(scope.workspace, scope.principal).first<{ enabled: number; policy_json: string }>();
  return row ? { enabled: row.enabled === 1, host: JSON.parse(row.policy_json) as CollectiveHost } : null;
}

export async function listHosts(database: Pick<D1Database, "prepare">, workspace: string): Promise<readonly CollectiveHost[]> {
  const rows = await database.prepare("SELECT policy_json FROM calendar_booking_hosts WHERE workspace_id = ? AND enabled = 1 ORDER BY principal_id")
    .bind(workspace).all<{ policy_json: string }>();
  return rows.results.map(row => JSON.parse(row.policy_json) as CollectiveHost);
}

/** A host explicitly delegates availability and booking to this workspace's managers. */
export async function saveHost(database: Database, scope: BookingScope, input: unknown): Promise<{ enabled: boolean; host: CollectiveHost }> {
  if (!record(input) || typeof input.enabled !== "boolean") return invalid("Choose whether to enable shared bookings.");
  const expected = version(input.expectedVersion);
  const current = await readHost(database, scope);
  if ((current?.host.version ?? 0) !== expected) return conflict();
  let host: CollectiveHost;
  if (!input.enabled) {
    if (!current) return invalid("No shared booking settings exist yet.");
    host = { ...current.host, version: expected + 1 };
  } else {
    const destinationCalendarId = text(input.destinationCalendarId, "Destination calendar", 255);
    // Invite identity comes from a discovered, owned Google primary calendar,
    // never an email supplied by another member or a mutable connection label.
    const identity = await database.prepare(`SELECT primary_cal.provider_calendar_id AS email
      FROM provider_calendars destination JOIN calendar_connections connection ON connection.id = destination.connection_id
      JOIN provider_calendars primary_cal ON primary_cal.connection_id = connection.id
      WHERE destination.id = ? AND destination.writable = 1 AND connection.workspace_id = ?
        AND connection.principal_id = ? AND connection.provider = 'google' AND connection.mode = 'oauth'
        AND connection.status = 'connected' AND primary_cal.is_primary = 1 AND primary_cal.role = 'owner'`)
      .bind(destinationCalendarId, scope.workspace, scope.principal).first<{ email: string }>();
    if (!identity || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(identity.email)) {
      throw new CollectiveBookingError(409, "host_calendar_unavailable", "Connect and refresh your Google calendars before enabling shared bookings.");
    }
    const publication = parsePublicBookingPublication({
      schemaVersion: "tap.calendar.publication.v1", sourceProfileId: "host-policy", profileSlug: "host-policy",
      displayName: text(input.displayName, "Display name"), ownerType: "individual", sourceEventTypeId: "host-policy",
      eventTypeSlug: "host-policy", title: "Shared availability", description: "", durationMinutes: 30,
      approvalRequired: false, location: "google-meet", destinationCalendarId,
      conflictCalendarIds: input.conflictCalendarIds, sourceAvailabilityScheduleId: input.sourceAvailabilityScheduleId,
      schedule: input.schedule,
    });
    const ids = publication.conflictCalendarIds;
    if (!ids.includes(destinationCalendarId)) return invalid("The destination must also be a Conflict Calendar.");
    const count = await database.prepare(`SELECT COUNT(*) AS count FROM provider_calendars c
      JOIN calendar_connections a ON a.id = c.connection_id WHERE a.workspace_id = ? AND a.principal_id = ?
        AND a.provider = 'google' AND a.mode = 'oauth' AND a.status = 'connected'
        AND c.id IN (${ids.map(() => "?").join(",")})`).bind(scope.workspace, scope.principal, ...ids).first<number>("count");
    if (count !== ids.length) return invalid("Choose only your connected Google Conflict Calendars.");
    host = { principalId: scope.principal, version: expected + 1, displayName: publication.displayName,
      email: identity.email.toLowerCase(), destinationCalendarId, conflictCalendarIds: ids,
      sourceAvailabilityScheduleId: publication.sourceAvailabilityScheduleId, schedule: publication.schedule };
  }
  const result = await database.prepare(`INSERT INTO calendar_booking_hosts
    (workspace_id, principal_id, version, enabled, policy_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, principal_id) DO UPDATE SET version = excluded.version, enabled = excluded.enabled,
      policy_json = excluded.policy_json, updated_at = excluded.updated_at WHERE calendar_booking_hosts.version = ?`)
    .bind(scope.workspace, scope.principal, host.version, input.enabled ? 1 : 0, JSON.stringify(host), new Date().toISOString(), expected).run();
  if (result.meta.changes !== 1) return conflict();
  return { enabled: input.enabled, host };
}

export async function assertHostsCurrent(database: Pick<D1Database, "prepare">, workspace: string, hosts: readonly CollectiveHost[]): Promise<void> {
  for (const host of hosts) {
    const current = await readHost(database, { workspace, principal: host.principalId });
    if (!current?.enabled || current.host.version !== host.version) {
      throw new CollectiveBookingError(409, "shared_host_changed", "A host's availability changed. The booking manager needs to refresh this shared link.");
    }
  }
}

export async function readWorkspaceDefinition(database: Pick<D1Database, "prepare">, workspace: string): Promise<WorkspaceBookingDefinition | null> {
  const row = await database.prepare("SELECT definition_json FROM calendar_workspace_booking_profiles WHERE workspace_id = ?")
    .bind(workspace).first<{ definition_json: string }>();
  return row ? JSON.parse(row.definition_json) as WorkspaceBookingDefinition : null;
}

export function parseWorkspaceDefinition(input: unknown): WorkspaceBookingDefinition {
  if (!record(input) || !Array.isArray(input.events) || input.events.length > 20 || typeof input.published !== "boolean") return invalid("The workspace booking profile is invalid.");
  const slug = (value: unknown): string => { const s = text(value, "Public name", 64); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(s) || s.length < 2) return invalid("Use a public name with lowercase letters, numbers, and hyphens."); return s; };
  const events: WorkspaceEventType[] = input.events.map(value => {
    if (!record(value) || !Array.isArray(value.hostIds) || value.hostIds.length < 1 || value.hostIds.length > 10 ||
      !Number.isInteger(value.durationMinutes) || Number(value.durationMinutes) < 5 || Number(value.durationMinutes) > 480 ||
      typeof value.approvalRequired !== "boolean" || !["google-meet", "zoom"].includes(String(value.location))) return invalid("Each meeting needs 1–10 hosts and a valid duration and location.");
    const hostIds = value.hostIds.map(id => text(id, "Host", 255));
    const organizerId = text(value.organizerId, "Organizer", 255);
    if (new Set(hostIds).size !== hostIds.length || !hostIds.includes(organizerId)) return invalid("The organizer must be one of the unique required hosts.");
    return { id: text(value.id, "Event type", 255), slug: slug(value.slug), title: text(value.title, "Title"),
      description: typeof value.description === "string" ? value.description.trim().slice(0, 2000) : "",
      durationMinutes: Number(value.durationMinutes), hostIds, organizerId,
      location: value.location as WorkspaceEventType["location"], approvalRequired: value.approvalRequired };
  });
  if (new Set(events.map(e => e.id)).size !== events.length || new Set(events.map(e => e.slug)).size !== events.length) return invalid("Meeting IDs and public names must be unique.");
  return { version: version(input.expectedVersion) + 1, profileSlug: slug(input.profileSlug), displayName: text(input.displayName, "Workspace booking name"), published: input.published, events };
}

export async function storeWorkspaceDefinition(database: Database, scope: BookingScope, definition: WorkspaceBookingDefinition): Promise<void> {
  const result = await database.prepare(`INSERT INTO calendar_workspace_booking_profiles
    (workspace_id, version, definition_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET version = excluded.version, definition_json = excluded.definition_json,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at WHERE calendar_workspace_booking_profiles.version = ?`)
    .bind(scope.workspace, definition.version, JSON.stringify(definition), scope.principal, new Date().toISOString(), definition.version - 1).run();
  if (result.meta.changes !== 1) return conflict();
}

export async function workspacePublication(database: Database, workspace: string, definition: WorkspaceBookingDefinition): Promise<PublicBookingProfilePublicationInput> {
  const available = new Map((await listHosts(database, workspace)).map(host => [host.principalId, host]));
  const publications = definition.events.map(event => {
    const hosts = [event.organizerId, ...event.hostIds.filter(id => id !== event.organizerId)].map(id => {
      const host = available.get(id);
      if (!host) throw new CollectiveBookingError(409, "host_not_enrolled", "Every selected host must enable shared bookings first.");
      return host;
    });
    const organizer = hosts[0]!;
    return { ...parsePublicBookingPublication({
      schemaVersion: "tap.calendar.publication.v1", sourceProfileId: workspaceProfileSourceId,
      profileSlug: definition.profileSlug, displayName: definition.displayName, ownerType: "individual",
      sourceEventTypeId: event.id, eventTypeSlug: event.slug, title: event.title, description: event.description,
      durationMinutes: event.durationMinutes, approvalRequired: event.approvalRequired, location: event.location,
      destinationCalendarId: organizer.destinationCalendarId, conflictCalendarIds: organizer.conflictCalendarIds,
      sourceAvailabilityScheduleId: organizer.sourceAvailabilityScheduleId, schedule: organizer.schedule,
    }), collectiveHosts: hosts };
  });
  const scope = workspaceProfileScope(workspace);
  const generation = await database.prepare("SELECT publication_generation FROM public_booking_profiles WHERE workspace_id = ? AND principal_id = ? AND source_profile_id = ? AND owner_kind = 'workspace'")
    .bind(workspace, scope.principal, workspaceProfileSourceId).first<number>("publication_generation");
  return { schemaVersion: "tap.calendar.profile-publication.v1", sourceProfileId: workspaceProfileSourceId,
    profileSlug: definition.profileSlug, displayName: definition.displayName, ownerType: "individual", expectedGeneration: generation ?? 0, publications };
}

export async function hostBusyIntervals(database: Pick<D1Database, "prepare">, scope: BookingScope, start: string, end: string, exclude?: { principal: string; operation: string }): Promise<readonly { start: string; end: string }[]> {
  const rows = await database.prepare(`SELECT start_ms, end_ms FROM calendar_active_host_reservations
    WHERE workspace_id = ? AND host_principal_id = ? AND start_ms < ? AND end_ms > ?
      AND NOT (organizer_principal_id = ? AND booking_operation_id = ?)`)
    .bind(scope.workspace, scope.principal, Date.parse(end), Date.parse(start), exclude?.principal ?? "", exclude?.operation ?? "")
    .all<{ start_ms: number; end_ms: number }>();
  return rows.results.map(row => ({ start: new Date(row.start_ms).toISOString(), end: new Date(row.end_ms).toISOString() }));
}

export async function reserveHosts(database: Database, scope: BookingScope, operation: string, start: string, end: string,
  hosts: readonly { readonly principalId: string; readonly beforeMs: number; readonly afterMs: number; readonly snapshot?: CollectiveHost }[], reservationId = "initial"): Promise<boolean> {
  try {
    await database.batch(hosts.map(host => database.prepare(`INSERT OR IGNORE INTO calendar_host_reservations
      (workspace_id, organizer_principal_id, booking_operation_id, host_principal_id, reservation_id,
       start_ms, end_ms, buffer_before_ms, buffer_after_ms, host_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(scope.workspace, scope.principal, operation, host.principalId, reservationId,
        Date.parse(start) - host.beforeMs, Date.parse(end) + host.afterMs, host.beforeMs, host.afterMs,
        host.snapshot ? JSON.stringify(host.snapshot) : null)));
    return true;
  } catch (error) {
    if (String(error).includes("calendar_host_slot_conflict")) return false;
    throw error;
  }
}

export async function bookedHosts(database: Pick<D1Database, "prepare">, scope: BookingScope, operation: string): Promise<readonly CollectiveHost[]> {
  const rows = await database.prepare(`SELECT host_snapshot_json FROM calendar_host_reservations WHERE workspace_id = ?
    AND organizer_principal_id = ? AND booking_operation_id = ? AND reservation_id = 'initial' AND host_snapshot_json IS NOT NULL`)
    .bind(scope.workspace, scope.principal, operation).all<{ host_snapshot_json: string }>();
  return rows.results.map(row => JSON.parse(row.host_snapshot_json) as CollectiveHost);
}
