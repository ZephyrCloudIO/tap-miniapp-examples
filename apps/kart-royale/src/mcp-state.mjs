/**
 * ============================================================================
 *  MCP RACE PROJECTION (reader) — QuickJS-safe, no browser APIs
 * ============================================================================
 *  The package-runtime reader behind the `get_race_state` tool. Reads the
 *  surface-written projection from TAP storage for the trusted execution
 *  context's user and channel, validates it, and returns a bounded copy.
 * ============================================================================
 */

const STORAGE_NAMESPACE = "kart-royale";
const PROJECTION_SCHEMA = "kart-royale.mcp.current";
const PROJECTION_VERSION = 1;
const MAX_KEY_CHARS = 512;
const MAX_MEMBERS = 16;
const MAX_STANDINGS = 8;
const PHASES = new Set(["idle", "lobby", "countdown", "running", "finished"]);
const ROLES = new Set(["player", "spectator"]);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const PATH_SEPARATORS = /[\\/]/u;

function invalid(message) {
  throw new TypeError(`Kart Royale race-state projection: ${message}`);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedId(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    invalid(`${label} must be a bounded string.`);
  }
  if (CONTROL_CHARS.test(value) || PATH_SEPARATORS.test(value)) {
    invalid(`${label} must not contain control or path characters.`);
  }
  return value;
}

function boundedText(value, label, maxChars = 64) {
  if (typeof value !== "string") return "";
  if (value.length > maxChars) return value.slice(0, maxChars);
  if (CONTROL_CHARS.test(value)) return "";
  return value;
}

function parseProjection(value) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) invalid("stored projection is not an object.");
  if (value.projectionSchema !== PROJECTION_SCHEMA) {
    invalid("stored projection has an unknown schema.");
  }
  if (value.projectionVersion !== undefined && value.projectionVersion > PROJECTION_VERSION) {
    invalid("stored projection is newer than this reader.");
  }
  if (typeof value.channelId !== "string" || !value.channelId) {
    invalid("stored projection has no channel.");
  }
  const phase = PHASES.has(value.phase) ? value.phase : "idle";
  const membersIn = Array.isArray(value.members) ? value.members : [];
  const standingsIn = Array.isArray(value.standings) ? value.standings : [];
  const members = [];
  for (const m of membersIn.slice(0, MAX_MEMBERS)) {
    if (!isRecord(m) || typeof m.userId !== "string") continue;
    members.push({
      userId: boundedText(m.userId, "member.userId", 128),
      displayName: boundedText(m.displayName, "member.displayName", 48) || "player",
      role: ROLES.has(m.role) ? m.role : "spectator",
      slot: Number.isSafeInteger(m.slot) ? m.slot : null,
      ready: m.ready === true,
      connected: m.connected === true,
    });
  }
  const standings = [];
  for (const st of standingsIn.slice(0, MAX_STANDINGS)) {
    if (!isRecord(st) || !Number.isSafeInteger(st.slot)) continue;
    standings.push({
      slot: st.slot,
      displayName: boundedText(st.displayName, "standing.displayName", 48) || "player",
      lap: Number.isSafeInteger(st.lap) ? st.lap : 0,
      place: Number.isSafeInteger(st.place) ? st.place : 0,
      finished: st.finished === true,
    });
  }
  standings.sort((a, b) => a.place - b.place);
  return {
    schemaVersion: 1,
    source: "tap-channel-projection",
    projectionTruncated:
      value.projectionTruncated === true ||
      membersIn.length > MAX_MEMBERS ||
      standingsIn.length > MAX_STANDINGS,
    raceId: typeof value.raceId === "string" ? value.raceId : null,
    channelId: value.channelId,
    phase,
    members,
    standings,
    totalMemberCount:
      Number.isSafeInteger(value.totalMemberCount) ? value.totalMemberCount : membersIn.length,
    updatedAtMs: Number.isSafeInteger(value.updatedAtMs) ? value.updatedAtMs : 0,
  };
}

function parseArguments(args) {
  if (args === undefined || args === null) return { raceId: undefined };
  if (!isRecord(args)) invalid("tool arguments must be an object.");
  const raceId = args.raceId;
  if (raceId === undefined || raceId === null) return { raceId: undefined };
  if (typeof raceId !== "string" || raceId.length === 0 || raceId.length > 128) {
    invalid("raceId must be a bounded string.");
  }
  return { raceId };
}

export function kartRoyaleMcpProjectionKey(userId, channelId) {
  const key = `mcp/users/${userId}/channels/${channelId}/current`;
  if (key.length > MAX_KEY_CHARS) invalid("projection key is too long.");
  return key;
}

export function createRaceStateReader({ readStorage, getExecutionContext }) {
  if (typeof readStorage !== "function" || typeof getExecutionContext !== "function") {
    throw new TypeError("Kart Royale MCP runtime dependencies are required.");
  }
  return async function getRaceState(args) {
    const { raceId } = parseArguments(args);
    const context = await getExecutionContext();
    if (!isRecord(context)) invalid("MCP execution context is unavailable.");
    const userId = boundedId(context.userId, "trusted user identifier");
    const channelId = boundedId(context.channelId, "trusted channel identifier");
    const stored = await readStorage({
      namespace: STORAGE_NAMESPACE,
      key: kartRoyaleMcpProjectionKey(userId, channelId),
    });
    const value = isRecord(stored) ? stored.value : null;
    const projection = parseProjection(value);
    if (projection && raceId && projection.raceId !== raceId) {
      return {
        ...projection,
        raceId: null,
        phase: "idle",
        members: [],
        standings: [],
        totalMemberCount: 0,
        staleFor: raceId,
      };
    }
    return (
      projection ?? {
        schemaVersion: 1,
        source: "tap-channel-projection",
        projectionTruncated: false,
        raceId: null,
        channelId,
        phase: "idle",
        members: [],
        standings: [],
        totalMemberCount: 0,
        updatedAtMs: 0,
      }
    );
  };
}
