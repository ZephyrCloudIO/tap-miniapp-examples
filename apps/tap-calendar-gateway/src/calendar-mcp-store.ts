import { z } from "zod";
import { CALENDAR_MCP_SCOPES, type CalendarMcpConfiguration, type CalendarMcpScope } from "../../tap-calendar/src/mcp-contract";

export type McpOwner = { readonly workspace: string; readonly principal: string };
export interface CalendarMcpProps extends McpOwner {
  readonly grantId: string;
  readonly scopes: readonly CalendarMcpScope[];
}
export class CalendarMcpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const mcpScopes = z.array(z.enum(CALENDAR_MCP_SCOPES)).min(1).max(3)
  .refine(scopes => new Set(scopes).size === scopes.length);
const id = z.string().min(1).max(255);
const configurationSchema = z.strictObject({
  conflictCalendarIds: z.array(id).max(100),
  eventTypes: z.array(z.strictObject({
    profileId: id, id, title: z.string().min(1).max(255), description: z.string().max(10000),
    durationMinutes: z.number().int().min(5).max(1440), active: z.boolean(), approvalRequired: z.boolean(),
  })).max(400),
});

export async function saveMcpConfiguration(db: D1Database, owner: McpOwner, value: unknown) {
  const parsed = z.strictObject({ sourceRevision: z.number().int().nonnegative(), configuration: configurationSchema }).safeParse(value);
  if (!parsed.success) throw new CalendarMcpError(400, "invalid_mcp_configuration", "Calendar specialist configuration is invalid.");
  const { sourceRevision, configuration } = parsed.data;
  if (new Set(configuration.eventTypes.map(type => JSON.stringify([type.profileId, type.id]))).size !== configuration.eventTypes.length) {
    throw new CalendarMcpError(400, "duplicate_event_type", "Event Type identifiers must be unique within a profile.");
  }
  await db.prepare(`INSERT INTO calendar_mcp_configuration
    (workspace_id, principal_id, source_revision, configuration_json, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (workspace_id, principal_id) DO UPDATE SET
      source_revision = excluded.source_revision, configuration_json = excluded.configuration_json, updated_at = excluded.updated_at
    WHERE excluded.source_revision > calendar_mcp_configuration.source_revision`)
    .bind(owner.workspace, owner.principal, sourceRevision, JSON.stringify(configuration), new Date().toISOString()).run();
  return { saved: true };
}

export async function loadMcpConfiguration(db: D1Database, owner: McpOwner): Promise<CalendarMcpConfiguration> {
  const row = await db.prepare("SELECT configuration_json FROM calendar_mcp_configuration WHERE workspace_id = ? AND principal_id = ?")
    .bind(owner.workspace, owner.principal).first<{ configuration_json: string }>();
  if (!row) throw new CalendarMcpError(409, "calendar_setup_required", "Open TAP Calendar and connect the specialist from Automations to synchronize Event Types and Conflict Calendars.");
  return configurationSchema.parse(JSON.parse(row.configuration_json));
}

export async function requireMcpGrant(db: D1Database, value: unknown, scope?: CalendarMcpScope): Promise<CalendarMcpProps> {
  const parsed = z.strictObject({ workspace: id, principal: id, grantId: id, scopes: mcpScopes }).safeParse(value);
  if (!parsed.success) throw new CalendarMcpError(401, "invalid_calendar_grant", "Reconnect TAP Calendar.");
  const props = parsed.data;
  const row = await db.prepare(`SELECT scopes_json FROM calendar_mcp_grants
    WHERE id = ? AND workspace_id = ? AND principal_id = ? AND revoked_at IS NULL`)
    .bind(props.grantId, props.workspace, props.principal).first<{ scopes_json: string }>();
  if (!row) throw new CalendarMcpError(403, "calendar_grant_revoked", "Calendar access was revoked. Reconnect to continue.");
  const granted = mcpScopes.parse(JSON.parse(row.scopes_json));
  if (props.scopes.some(item => !granted.includes(item)) || (scope && !props.scopes.includes(scope))) {
    throw new CalendarMcpError(403, "calendar_scope_required", `This connection does not allow ${scope ?? "the requested scopes"}.`);
  }
  return props;
}

export async function listMcpGrants(db: D1Database, owner: McpOwner) {
  const rows = await db.prepare(`SELECT id, client_name, scopes_json, created_at FROM calendar_mcp_grants
    WHERE workspace_id = ? AND principal_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`)
    .bind(owner.workspace, owner.principal).all<{ id: string; client_name: string; scopes_json: string; created_at: string }>();
  return { grants: rows.results.map(row => ({ id: row.id, clientName: row.client_name, scopes: mcpScopes.parse(JSON.parse(row.scopes_json)), createdAt: row.created_at })) };
}

export async function revokeMcpGrant(db: D1Database, owner: McpOwner, grantId: string) {
  await db.prepare("UPDATE calendar_mcp_grants SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND principal_id = ?")
    .bind(new Date().toISOString(), grantId, owner.workspace, owner.principal).run();
  return { revoked: true };
}
