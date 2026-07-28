const STORAGE_NAMESPACE = "brainrot-td";
const PROJECTION_KEY_TEMPLATE =
  "mcp/users/{userId}/channels/{channelId}/current";
const PROJECTION_SCHEMA = "brainrot-td.mcp.current";
const PROJECTION_VERSION = 1;
const MAX_PROJECTED_MEMBERS = 64;
const MAX_PROJECTED_DEFENDERS = 128;
const MAX_PROJECTED_ENEMIES = 256;
const MAX_PROJECTED_RECENT_ACTIONS = 12;
const MAX_TOTAL_MEMBERS = 512;
const MAX_TOTAL_DEFENDERS = 256;
const MAX_TOTAL_ENEMIES = 512;
const MAX_TOTAL_RECENT_ACTIONS = 12;
const MAX_STORAGE_KEY_CHARACTERS = 512;
const LEVEL_NAMES = Object.freeze([
  "Backyard Wi-Fi",
  "School Hallway Rush",
  "Food Court Frenzy",
  "Suburban Doomscroll",
  "Final Feed",
]);
const SESSION_STATUSES = new Set([
  "lobby",
  "between_waves",
  "running",
  "paused",
  "victory",
  "defeat",
  "abandoned",
]);
const MEMBER_ROLES = new Set(["host", "player", "spectator", "disconnected"]);
const TARGET_POLICIES = new Set(["first", "last", "strong", "fast"]);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const STORAGE_SEPARATOR = /[\\/]/u;
const PROJECTION_FIELDS = new Set([
  "projectionSchema",
  "projectionVersion",
  "projectionTruncated",
  "schemaVersion",
  "source",
  "sessionId",
  "channelId",
  "name",
  "level",
  "levelName",
  "wave",
  "totalWaves",
  "status",
  "baseHealth",
  "score",
  "tick",
  "sequence",
  "activePlayerCount",
  "spectatorCount",
  "livePresenceCount",
  "defeatedEnemies",
  "leakedEnemies",
  "pendingEnemyCount",
  "totalMemberCount",
  "totalDefenderCount",
  "totalEnemyCount",
  "totalRecentActionCount",
  "members",
  "defenders",
  "enemies",
  "recentActions",
]);
const MEMBER_FIELDS = new Set([
  "playerId",
  "displayName",
  "role",
  "slot",
  "ready",
  "resources",
  "contribution",
]);
const DEFENDER_FIELDS = new Set([
  "id",
  "ownerId",
  "kind",
  "x",
  "y",
  "level",
  "path",
  "targetPolicy",
]);
const ENEMY_FIELDS = new Set([
  "id",
  "kind",
  "path",
  "progress",
  "health",
  "maxHealth",
  "slowedTicks",
  "armor",
]);
const RECENT_ACTION_FIELDS = new Set(["sequence", "actor", "label"]);

function invalid(message) {
  throw new Error(`Brainrot Tower Defense state is unavailable: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value, label) {
  if (!isRecord(value)) invalid(`${label} is malformed.`);
  return value;
}

function exactRecord(value, label, fields) {
  const result = record(value, label);
  const keys = Object.keys(result);
  if (
    keys.length !== fields.size ||
    keys.some((key) => !fields.has(key))
  ) {
    invalid(`${label} has an unsupported shape.`);
  }
  return result;
}

function boundedString(value, label, maximum, { storageSegment = false } = {}) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    [...value].length > maximum ||
    CONTROL_CHARACTER.test(value) ||
    (storageSegment && STORAGE_SEPARATOR.test(value))
  ) {
    invalid(`${label} is malformed.`);
  }
  return value;
}

function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(`${label} is out of bounds.`);
  }
  return value;
}

function oneOf(value, values, label) {
  if (!values.has(value)) invalid(`${label} is unsupported.`);
  return value;
}

function list(value, label, maximum, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    invalid(`${label} is out of bounds.`);
  }
  return value;
}

function parseArguments(arguments_) {
  if (arguments_ === undefined) return {};
  const input = record(arguments_, "tool input");
  if (Object.keys(input).some((key) => key !== "sessionId")) {
    invalid("tool input contains unsupported fields.");
  }
  if (input.sessionId === undefined) return {};
  return {
    sessionId: boundedString(
      input.sessionId,
      "requested session identifier",
      128,
      { storageSegment: true },
    ),
  };
}

function projectMember(value, index) {
  const member = exactRecord(
    value,
    `member ${index}`,
    MEMBER_FIELDS,
  );
  const role = oneOf(member.role, MEMBER_ROLES, `member ${index} role`);
  const slot =
    member.slot === null
      ? null
      : integer(member.slot, `member ${index} slot`, 0, 3);
  if (typeof member.ready !== "boolean") invalid(`member ${index} ready is malformed.`);
  if (
    (role === "host" || role === "player" || role === "disconnected") !==
    (slot !== null)
  ) {
    invalid(`member ${index} role and slot disagree.`);
  }
  return {
    playerId: boundedString(member.playerId, `member ${index} playerId`, 256),
    displayName: boundedString(member.displayName, `member ${index} displayName`, 40),
    role,
    slot,
    ready: member.ready,
    resources: integer(member.resources, `member ${index} resources`, 0),
    contribution: integer(member.contribution, `member ${index} contribution`, 0),
  };
}

function projectDefender(value, index) {
  const defender = exactRecord(
    value,
    `defender ${index}`,
    DEFENDER_FIELDS,
  );
  if (typeof defender.path !== "string" || [...defender.path].length > 80) {
    invalid(`defender ${index} path is malformed.`);
  }
  return {
    id: boundedString(defender.id, `defender ${index} id`, 128),
    ownerId: boundedString(defender.ownerId, `defender ${index} ownerId`, 256),
    kind: boundedString(defender.kind, `defender ${index} kind`, 64),
    x: integer(defender.x, `defender ${index} x`, 0, 1000),
    y: integer(defender.y, `defender ${index} y`, 0, 562),
    level: integer(defender.level, `defender ${index} level`, 1, 5),
    path: defender.path,
    targetPolicy: oneOf(
      defender.targetPolicy,
      TARGET_POLICIES,
      `defender ${index} target policy`,
    ),
  };
}

function projectEnemy(value, index) {
  const enemy = exactRecord(
    value,
    `enemy ${index}`,
    ENEMY_FIELDS,
  );
  return {
    id: boundedString(enemy.id, `enemy ${index} id`, 128),
    kind: boundedString(enemy.kind, `enemy ${index} kind`, 64),
    path: integer(enemy.path, `enemy ${index} path`, 0, 3),
    progress: integer(enemy.progress, `enemy ${index} progress`, 0, 1000),
    health: integer(enemy.health, `enemy ${index} health`, Number.MIN_SAFE_INTEGER),
    maxHealth: integer(enemy.maxHealth, `enemy ${index} maxHealth`, 1),
    slowedTicks: integer(enemy.slowedTicks, `enemy ${index} slowedTicks`, 0, 65_535),
    armor: integer(enemy.armor, `enemy ${index} armor`, 0, 255),
  };
}

function projectRecentAction(value, index, sequence) {
  const action = exactRecord(
    value,
    `recent action ${index}`,
    RECENT_ACTION_FIELDS,
  );
  const actionSequence = integer(
    action.sequence,
    `recent action ${index} sequence`,
    1,
  );
  if (actionSequence > sequence) {
    invalid(`recent action ${index} is newer than its projection.`);
  }
  return {
    sequence: actionSequence,
    actor: boundedString(action.actor, `recent action ${index} actor`, 40),
    label: boundedString(action.label, `recent action ${index} label`, 160),
  };
}

function assertUnique(items, select, label) {
  if (new Set(items.map(select)).size !== items.length) {
    invalid(`${label} contains duplicate identifiers.`);
  }
}

function projectStoredProjection(value, channelId, requestedSessionId) {
  const projection = exactRecord(
    value,
    "current channel projection",
    PROJECTION_FIELDS,
  );
  if (
    projection.projectionSchema !== PROJECTION_SCHEMA ||
    projection.projectionVersion !== PROJECTION_VERSION ||
    projection.schemaVersion !== 1 ||
    projection.source !== "tap-channel-projection"
  ) {
    invalid("current channel projection uses an unsupported schema.");
  }
  if (typeof projection.projectionTruncated !== "boolean") {
    invalid("current channel projection truncation marker is malformed.");
  }

  const projectedChannelId = boundedString(
    projection.channelId,
    "projection channel identifier",
    256,
    { storageSegment: true },
  );
  const sessionId = boundedString(
    projection.sessionId,
    "projection session identifier",
    128,
    { storageSegment: true },
  );
  if (
    projectedChannelId !== channelId ||
    (requestedSessionId !== undefined && sessionId !== requestedSessionId)
  ) {
    invalid("current channel projection does not match its trusted scope.");
  }

  const level = integer(projection.level, "level", 1, LEVEL_NAMES.length);
  if (projection.levelName !== LEVEL_NAMES[level - 1]) {
    invalid("level name does not match the projected level.");
  }
  const sequence = integer(projection.sequence, "sequence", 0);
  const members = list(
    projection.members,
    "members",
    MAX_PROJECTED_MEMBERS,
    1,
  ).map(projectMember);
  const defenders = list(
    projection.defenders,
    "defenders",
    MAX_PROJECTED_DEFENDERS,
  ).map(projectDefender);
  const enemies = list(
    projection.enemies,
    "enemies",
    MAX_PROJECTED_ENEMIES,
  ).map(projectEnemy);
  const recentActions = list(
    projection.recentActions,
    "recent actions",
    MAX_PROJECTED_RECENT_ACTIONS,
  ).map((action, index) => projectRecentAction(action, index, sequence));
  assertUnique(members, (member) => member.playerId, "projected members");
  assertUnique(defenders, (defender) => defender.id, "projected defenders");
  assertUnique(enemies, (enemy) => enemy.id, "projected enemies");

  const totalMemberCount = integer(
    projection.totalMemberCount,
    "total member count",
    members.length,
    MAX_TOTAL_MEMBERS,
  );
  const totalDefenderCount = integer(
    projection.totalDefenderCount,
    "total defender count",
    defenders.length,
    MAX_TOTAL_DEFENDERS,
  );
  const totalEnemyCount = integer(
    projection.totalEnemyCount,
    "total enemy count",
    enemies.length,
    MAX_TOTAL_ENEMIES,
  );
  const totalRecentActionCount = integer(
    projection.totalRecentActionCount,
    "total recent action count",
    recentActions.length,
    MAX_TOTAL_RECENT_ACTIONS,
  );
  const listTruncated = [
    [totalMemberCount, members.length],
    [totalDefenderCount, defenders.length],
    [totalEnemyCount, enemies.length],
    [totalRecentActionCount, recentActions.length],
  ].some(([total, represented]) => total !== represented);
  if (listTruncated && !projection.projectionTruncated) {
    invalid("current channel projection truncation metadata is inconsistent.");
  }

  const activePlayerCount = integer(
    projection.activePlayerCount,
    "active player count",
    1,
    4,
  );
  const spectatorCount = integer(
    projection.spectatorCount,
    "spectator count",
    0,
    MAX_TOTAL_MEMBERS,
  );
  const representedActivePlayers = members.filter(
    (member) => member.role === "host" || member.role === "player",
  ).length;
  const representedSpectators = members.filter(
    (member) => member.role === "spectator",
  ).length;
  if (
    members.filter((member) => member.role === "host").length !== 1 ||
    representedActivePlayers > activePlayerCount ||
    representedSpectators > spectatorCount ||
    (totalMemberCount === members.length &&
      (representedActivePlayers !== activePlayerCount ||
        representedSpectators !== spectatorCount))
  ) {
    invalid("current channel projection member counts are inconsistent.");
  }

  return {
    schemaVersion: 1,
    source: "tap-channel-projection",
    projectionTruncated: projection.projectionTruncated,
    sessionId,
    channelId,
    name: boundedString(projection.name, "game name", 80),
    level,
    levelName: projection.levelName,
    wave: integer(projection.wave, "wave", 0, 5),
    totalWaves: integer(projection.totalWaves, "total waves", 0, 5),
    status: oneOf(projection.status, SESSION_STATUSES, "session status"),
    baseHealth: integer(projection.baseHealth, "base health", 0, 65_535),
    score: integer(projection.score, "score", 0),
    tick: integer(projection.tick, "tick", 0),
    sequence,
    activePlayerCount,
    spectatorCount,
    livePresenceCount: integer(
      projection.livePresenceCount,
      "live presence count",
      0,
      MAX_TOTAL_MEMBERS,
    ),
    defeatedEnemies: integer(projection.defeatedEnemies, "defeated enemies", 0),
    leakedEnemies: integer(
      projection.leakedEnemies,
      "leaked enemies",
      0,
      65_535,
    ),
    pendingEnemyCount: integer(
      projection.pendingEnemyCount,
      "pending enemy count",
      0,
      MAX_TOTAL_ENEMIES,
    ),
    totalMemberCount,
    totalDefenderCount,
    totalEnemyCount,
    totalRecentActionCount,
    members,
    defenders,
    enemies,
    recentActions,
  };
}

async function readValue(readStorage, key) {
  const entry = record(
    await readStorage({ namespace: STORAGE_NAMESPACE, key }),
    "current channel projection storage entry",
  );
  if (!Object.hasOwn(entry, "value")) {
    invalid("current channel projection storage entry is malformed.");
  }
  if (entry.value === null) invalid("current channel projection is missing.");
  return entry.value;
}

export function brainrotMcpProjectionKey(userId, channelId) {
  const key = `mcp/users/${userId}/channels/${channelId}/current`;
  if ([...key].length > MAX_STORAGE_KEY_CHARACTERS) {
    invalid("trusted projection storage key is out of bounds.");
  }
  return key;
}

export function createGameStateReader({ readStorage, getExecutionContext }) {
  if (typeof readStorage !== "function" || typeof getExecutionContext !== "function") {
    throw new TypeError("Brainrot MCP runtime dependencies are required.");
  }
  return async function getGameState(arguments_) {
    const { sessionId: requestedSessionId } = parseArguments(arguments_);
    const context = record(
      await getExecutionContext(),
      "MCP execution context",
    );
    if (context.channelId === null) {
      invalid("the trusted execution context has no channel.");
    }
    if (context.userId === null || context.userId === undefined) {
      invalid("the trusted execution context has no user.");
    }
    const userId = boundedString(
      context.userId,
      "trusted user identifier",
      256,
      { storageSegment: true },
    );
    const channelId = boundedString(
      context.channelId,
      "trusted channel identifier",
      256,
      { storageSegment: true },
    );
    return projectStoredProjection(
      await readValue(
        readStorage,
        brainrotMcpProjectionKey(userId, channelId),
      ),
      channelId,
      requestedSessionId,
    );
  };
}

export const brainrotMcpStorageNamespace = STORAGE_NAMESPACE;
export const brainrotMcpStorageKeyTemplate = PROJECTION_KEY_TEMPLATE;
