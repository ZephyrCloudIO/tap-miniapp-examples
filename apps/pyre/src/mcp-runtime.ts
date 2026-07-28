import { defineMcpServer } from "@theaiplatform/miniapp-sdk/mcp";
import {
  sdk,
  type MiniAppJsonValue,
  type MiniAppMaybePromise,
  type MiniAppMcpExecutionContext,
  type MiniAppStorageAddress,
  type MiniAppStorageEntry,
} from "@theaiplatform/miniapp-sdk/sdk";
import {
  emptyState,
  isPyreState,
  migrateState,
  type Investigation,
  type PyreState,
} from "./domain";

const CURRENT_ADDRESS = {
  namespace: "pyre",
  key: "investigations/v2",
} as const;
const LEGACY_ADDRESS = {
  namespace: "pyre",
  key: "investigations/v1",
} as const;
const MAX_STORED_BYTES = 1_000_000;
const MAX_INVESTIGATIONS = 256;
const MAX_COLLECTION_ITEMS = 512;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const UNSAFE_TEXT_CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const LEGACY_SEVERITIES = new Set([
  "unassessed",
  "SEV-1",
  "SEV-2",
  "SEV-3",
  "SEV-4",
]);
const LEGACY_STATUSES = new Set(["investigating", "monitoring", "resolved"]);
const LEGACY_PHASES = new Set([
  "intake",
  "evidence collection",
  "analysis",
  "action planning",
  "review",
  "published",
  "follow-up",
]);
const LEGACY_ROLES = new Set([
  "lead",
  "facilitator",
  "investigator",
  "sme",
  "evidence-owner",
  "editor",
  "reviewer",
  "stakeholder",
]);

export type PyreMcpExecutionContext = MiniAppMcpExecutionContext;

export interface PyreMcpRuntime {
  getExecutionContext(): MiniAppMaybePromise<PyreMcpExecutionContext>;
  readStorage(
    address: MiniAppStorageAddress,
  ): MiniAppMaybePromise<MiniAppStorageEntry>;
}

const defaultRuntime: PyreMcpRuntime = {
  getExecutionContext: () => {
    if (!sdk.mcp) {
      return storageError(
        "the host did not provide package-runtime MCP execution context.",
      );
    }
    return sdk.mcp.getExecutionContext();
  },
  readStorage: (address) => sdk.storage.get(address),
};

function storageError(message: string): never {
  throw new Error(`Pyre MCP storage is unavailable: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExecutionContext(value: unknown): asserts value is PyreMcpExecutionContext {
  if (!isRecord(value)) storageError("the execution context is malformed.");
  const { channelId, userId } = value;
  if (
    channelId !== null &&
    (typeof channelId !== "string" ||
      !channelId.trim() ||
      channelId.length > 256 ||
      CONTROL_CHARACTER.test(channelId))
  ) {
    storageError("the execution context channel is malformed.");
  }
  if (
    userId !== null &&
    (typeof userId !== "string" ||
      !userId.trim() ||
      userId.length > 256 ||
      CONTROL_CHARACTER.test(userId))
  ) {
    storageError("the execution context user is malformed.");
  }
}

function decodeStoredValue(value: MiniAppJsonValue, label: string): unknown {
  if (typeof value !== "string") return value;
  if (utf8ByteLength(value) > MAX_STORED_BYTES) {
    return storageError(`${label} exceeds the MCP read limit.`);
  }
  try {
    return JSON.parse(value);
  } catch {
    return storageError(`${label} is not valid JSON.`);
  }
}

function assertArray(
  value: unknown,
  label: string,
  maximum = MAX_COLLECTION_ITEMS,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    storageError(`${label} is malformed or exceeds its bounded size.`);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
  }
  return bytes;
}

function assertSerializedStateBound(value: unknown, label: string): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return storageError(`${label} is not JSON-compatible.`);
  }
  if (
    serialized === undefined ||
    utf8ByteLength(serialized) > MAX_STORED_BYTES
  ) {
    storageError(`${label} exceeds the MCP read limit.`);
  }
}

function assertBoundedLegacyString(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    CONTROL_CHARACTER.test(value)
  ) {
    storageError(`${label} is malformed.`);
  }
}

function assertBoundedLegacyText(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    UNSAFE_TEXT_CONTROL_CHARACTER.test(value)
  ) {
    storageError(`${label} is malformed.`);
  }
}

function assertLegacyStringArray(
  value: unknown,
  label: string,
): asserts value is string[] {
  assertArray(value, label);
  for (const [index, item] of value.entries()) {
    assertBoundedLegacyString(item, `${label} item ${index}`, 2_048);
  }
}

function assertLegacyRecordArray(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown>[] {
  assertArray(value, label);
  value.forEach((item, index) => {
    if (!isRecord(item)) storageError(`${label} item ${index} is malformed.`);
  });
}

function assertLegacyEvidence(value: Record<string, unknown>, label: string) {
  for (const field of ["id", "title", "source", "collectedAt", "collector"] as const) {
    assertBoundedLegacyString(value[field], `${label} ${field}`, 2_048);
  }
  for (const field of ["description", "digest", "reliability"] as const) {
    assertBoundedLegacyText(value[field], `${label} ${field}`, 10_000);
  }
  if (
    ![
      "log",
      "alert",
      "screenshot",
      "metric",
      "ticket",
      "code",
      "message",
      "testimony",
      "API result",
      "api-result",
      "file",
    ].includes(String(value.kind)) ||
    !["investigation", "restricted", "public-approved"].includes(
      String(value.visibility),
    )
  ) {
    storageError(`${label} kind or visibility is malformed.`);
  }
  for (const field of ["systems", "supports", "contradicts"] as const) {
    assertLegacyStringArray(value[field], `${label} ${field}`);
  }
}

function assertLegacyTimelineEvent(
  value: Record<string, unknown>,
  label: string,
) {
  for (const field of ["id", "at", "original"] as const) {
    assertBoundedLegacyString(value[field], `${label} ${field}`, 2_048);
  }
  for (const field of ["actor", "description"] as const) {
    assertBoundedLegacyText(value[field], `${label} ${field}`, 10_000);
  }
  if (
    ![
      "incident",
      "detection",
      "escalation",
      "mitigation",
      "recovery",
      "investigation",
    ].includes(String(value.type)) ||
    !["confirmed", "likely", "uncertain", "disputed"].includes(
      String(value.confidence),
    )
  ) {
    storageError(`${label} type or confidence is malformed.`);
  }
  assertLegacyStringArray(value.evidenceIds, `${label} evidenceIds`);
}

function assertLegacyWhy(value: Record<string, unknown>, label: string) {
  for (const field of ["id", "author"] as const) {
    assertBoundedLegacyString(value[field], `${label} ${field}`, 2_048);
  }
  for (const field of [
    "question",
    "answer",
    "assumptions",
    "alternatives",
  ] as const) {
    assertBoundedLegacyText(value[field], `${label} ${field}`, 10_000);
  }
  if (
    !["unverified", "supported", "contradicted"].includes(
      String(value.confidence),
    ) ||
    !["continue", "branch", "revise", "stop"].includes(
      String(value.decision),
    ) ||
    ![
      "trigger",
      "proximate cause",
      "contributing factor",
      "latent condition",
      "detection gap",
      "impact amplifier",
      "confirmed non-cause",
    ].includes(String(value.factorType))
  ) {
    storageError(`${label} classification is malformed.`);
  }
  assertLegacyStringArray(value.evidenceIds, `${label} evidenceIds`);
  assertLegacyStringArray(value.contradictingIds, `${label} contradictingIds`);
}

function assertLegacyAction(value: Record<string, unknown>, label: string) {
  for (const field of ["id", "title"] as const) {
    assertBoundedLegacyString(value[field], `${label} ${field}`, 2_048);
  }
  for (const field of [
    "owner",
    "acceptance",
    "verification",
    "requiredEvidence",
  ] as const) {
    assertBoundedLegacyText(value[field], `${label} ${field}`, 10_000);
  }
  if (
    ![
      "containment",
      "correction",
      "prevention",
      "detection",
      "resilience",
    ].includes(String(value.category)) ||
    !["low", "medium", "high", "critical"].includes(String(value.priority)) ||
    ![
      "open",
      "in progress",
      "in-progress",
      "awaiting-verification",
      "verified",
      "cancelled",
    ].includes(String(value.status))
  ) {
    storageError(`${label} classification is malformed.`);
  }
}

function assertLegacyAudit(value: Record<string, unknown>, label: string) {
  for (const field of ["id", "at", "actor", "action"] as const) {
    assertBoundedLegacyString(value[field], `${label} ${field}`, 2_048);
  }
  assertBoundedLegacyText(value.detail, `${label} detail`, 10_000);
}

function assertLegacyInvestigation(
  value: unknown,
  index: number,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) storageError(`legacy investigation ${index} is malformed.`);
  for (const [field, maximum] of [
    ["id", 256],
    ["title", 512],
    ["statement", 10_000],
    ["impact", 10_000],
    ["createdAt", 128],
    ["createdBy", 256],
  ] as const) {
    assertBoundedLegacyString(
      value[field],
      `legacy investigation ${index} ${field}`,
      maximum,
    );
  }
  for (const [field, values] of [
    ["severity", LEGACY_SEVERITIES],
    ["status", LEGACY_STATUSES],
    ["phase", LEGACY_PHASES],
  ] as const) {
    if (typeof value[field] !== "string" || !values.has(value[field])) {
      storageError(`legacy investigation ${index} ${field} is malformed.`);
    }
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    storageError(`legacy investigation ${index} revision is malformed.`);
  }
  for (const field of ["systems", "regions", "sourceLinks"] as const) {
    assertArray(value[field], `legacy investigation ${index} ${field}`);
    for (const [itemIndex, item] of value[field].entries()) {
      assertBoundedLegacyString(
        item,
        `legacy investigation ${index} ${field} item ${itemIndex}`,
        2_048,
      );
    }
  }
  if (!isRecord(value.times)) {
    storageError(`legacy investigation ${index} times is malformed.`);
  }
  for (const [timeName, timestamp] of Object.entries(value.times)) {
    assertBoundedLegacyString(
      timestamp,
      `legacy investigation ${index} time ${timeName}`,
      128,
    );
  }
  if (!isRecord(value.members)) {
    storageError(`legacy investigation ${index} members is malformed.`);
  }
  const members = Object.entries(value.members);
  if (members.length > MAX_COLLECTION_ITEMS) {
    storageError(`legacy investigation ${index} members exceeds its bounded size.`);
  }
  for (const [memberId, role] of members) {
    assertBoundedLegacyString(
      memberId,
      `legacy investigation ${index} member identifier`,
      256,
    );
    if (typeof role !== "string" || !LEGACY_ROLES.has(role)) {
      storageError(`legacy investigation ${index} member role is malformed.`);
    }
  }
  for (const field of [
    "evidence",
    "timeline",
    "whys",
    "actions",
    "audit",
  ] as const) {
    assertLegacyRecordArray(
      value[field],
      `legacy investigation ${index} ${field}`,
    );
  }
  const evidence = value.evidence as Record<string, unknown>[];
  const timeline = value.timeline as Record<string, unknown>[];
  const whys = value.whys as Record<string, unknown>[];
  const actions = value.actions as Record<string, unknown>[];
  const audit = value.audit as Record<string, unknown>[];
  evidence.forEach((item, itemIndex) =>
    assertLegacyEvidence(item, `legacy investigation ${index} evidence ${itemIndex}`),
  );
  timeline.forEach((item, itemIndex) =>
    assertLegacyTimelineEvent(
      item,
      `legacy investigation ${index} timeline ${itemIndex}`,
    ),
  );
  whys.forEach((item, itemIndex) =>
    assertLegacyWhy(item, `legacy investigation ${index} why ${itemIndex}`),
  );
  actions.forEach((item, itemIndex) =>
    assertLegacyAction(item, `legacy investigation ${index} action ${itemIndex}`),
  );
  audit.forEach((item, itemIndex) =>
    assertLegacyAudit(item, `legacy investigation ${index} audit ${itemIndex}`),
  );
  for (const field of ["questions", "decisions"] as const) {
    assertArray(value[field], `legacy investigation ${index} ${field}`);
    for (const [itemIndex, item] of value[field].entries()) {
      assertBoundedLegacyString(
        item,
        `legacy investigation ${index} ${field} item ${itemIndex}`,
        10_000,
      );
    }
  }
}

function assertLegacyState(
  value: unknown,
): asserts value is {
  schemaVersion: 1;
  investigations: Record<string, unknown>[];
  activeId?: string;
} {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    storageError("legacy state uses an unsupported schema.");
  }
  assertSerializedStateBound(value, "legacy state");
  assertArray(value.investigations, "legacy investigations", MAX_INVESTIGATIONS);
  value.investigations.forEach(assertLegacyInvestigation);
  const investigations = value.investigations as Record<string, unknown>[];
  if (value.investigations.length > 0 && value.activeId === undefined) {
    storageError("legacy activeId is required when investigations exist.");
  }
  if (value.activeId !== undefined) {
    assertBoundedLegacyString(value.activeId, "legacy activeId", 256);
    if (
      !investigations.some(
        (investigation) => investigation.id === value.activeId,
      )
    ) {
      storageError("legacy activeId does not reference an investigation.");
    }
  }
}

function assertReadableString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
  allowFormatting = false,
): asserts value is string {
  const controlCharacter = allowFormatting
    ? UNSAFE_TEXT_CONTROL_CHARACTER
    : CONTROL_CHARACTER;
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value.length > maximum ||
    controlCharacter.test(value)
  ) {
    storageError(`${label} is malformed.`);
  }
}

function assertOptionalReadableString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
  allowFormatting = false,
): asserts value is string | undefined {
  if (value !== undefined) {
    assertReadableString(value, label, maximum, allowEmpty, allowFormatting);
  }
}

function assertReadableEnum(
  value: unknown,
  label: string,
  allowed: ReadonlySet<string>,
): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) {
    storageError(`${label} is malformed.`);
  }
}

function assertReadableInteger(
  value: unknown,
  label: string,
  minimum = 0,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    storageError(`${label} is malformed.`);
  }
}

function assertReadableStringArray(
  value: unknown,
  label: string,
  maximumLength = 2_048,
): asserts value is string[] {
  assertArray(value, label);
  for (const [index, item] of value.entries()) {
    assertReadableString(item, `${label} item ${index}`, maximumLength);
  }
}

function assertUniqueRecordIds(
  records: Record<string, unknown>[],
  label: string,
): void {
  const identifiers = new Set<string>();
  for (const [index, record] of records.entries()) {
    assertReadableString(record.id, `${label} item ${index} id`, 256);
    if (identifiers.has(record.id)) {
      storageError(`${label} contains duplicate id ${record.id}.`);
    }
    identifiers.add(record.id);
  }
}

function readableRecords(
  value: unknown,
  label: string,
): Record<string, unknown>[] {
  assertLegacyRecordArray(value, label);
  const records = value as Record<string, unknown>[];
  assertUniqueRecordIds(records, label);
  return records;
}

function assertReadableTimes(value: unknown, label: string): void {
  if (!isRecord(value)) storageError(`${label} is malformed.`);
  const allowed = new Set(["start", "detected", "mitigated", "recovered", "ended"]);
  for (const [key, timestamp] of Object.entries(value)) {
    if (!allowed.has(key)) storageError(`${label} field ${key} is unsupported.`);
    assertReadableString(timestamp, `${label} ${key}`, 128);
  }
}

function assertReadableBindings(value: unknown, label: string): void {
  if (!isRecord(value)) storageError(`${label} is malformed.`);
  const allowed = new Set([
    "projectId",
    "channelId",
    "specialistId",
    "vfsConversationId",
    "vfsRoot",
    "lastCheckpointMessageId",
  ]);
  for (const [key, identifier] of Object.entries(value)) {
    if (!allowed.has(key)) storageError(`${label} field ${key} is unsupported.`);
    assertReadableString(identifier, `${label} ${key}`, 2_048);
  }
}

function assertReadableMember(value: Record<string, unknown>, label: string): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.displayName, `${label} displayName`, 512);
  assertReadableEnum(value.role, `${label} role`, LEGACY_ROLES);
  assertReadableString(value.joinedAt, `${label} joinedAt`, 128);
}

function assertReadableEvidence(
  value: Record<string, unknown>,
  label: string,
): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.title, `${label} title`, 512);
  assertReadableEnum(
    value.kind,
    `${label} kind`,
    new Set([
      "log",
      "alert",
      "screenshot",
      "metric",
      "ticket",
      "code",
      "message",
      "testimony",
      "api-result",
      "file",
    ]),
  );
  assertReadableString(value.source, `${label} source`, 2_048, true);
  assertReadableString(
    value.description,
    `${label} description`,
    10_000,
    true,
    true,
  );
  assertReadableString(value.collectedAt, `${label} collectedAt`, 128);
  assertReadableString(value.collectedBy, `${label} collectedBy`, 256);
  assertOptionalReadableString(value.incidentFrom, `${label} incidentFrom`, 128);
  assertOptionalReadableString(value.incidentTo, `${label} incidentTo`, 128);
  assertReadableEnum(
    value.visibility,
    `${label} visibility`,
    new Set(["investigation", "restricted", "public-approved"]),
  );
  assertReadableString(value.digest, `${label} digest`, 2_048, true);
  assertOptionalReadableString(value.mimeType, `${label} mimeType`, 256);
  if (value.sizeBytes !== undefined) {
    assertReadableInteger(value.sizeBytes, `${label} sizeBytes`);
  }
  assertReadableString(value.reliability, `${label} reliability`, 2_048, true);
  for (const field of [
    "systems",
    "supportsClaimIds",
    "contradictsClaimIds",
    "timelineEventIds",
  ] as const) {
    assertReadableStringArray(value[field], `${label} ${field}`);
  }
  assertOptionalReadableString(value.vfsPath, `${label} vfsPath`, 4_096);
  assertOptionalReadableString(value.receiptPath, `${label} receiptPath`, 4_096);
  if (typeof value.immutableSnapshot !== "boolean") {
    storageError(`${label} immutableSnapshot is malformed.`);
  }
  assertReadableEnum(
    value.collectionStatus,
    `${label} collectionStatus`,
    new Set(["reference", "captured", "quarantined", "failed"]),
  );
}

function assertReadableTimeline(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const field of ["id", "timestamp", "originalTimestamp"] as const) {
    assertReadableString(value[field], `${label} ${field}`, 256);
  }
  assertReadableString(value.timezone, `${label} timezone`, 128, true);
  assertReadableEnum(
    value.type,
    `${label} type`,
    new Set([
      "incident",
      "detection",
      "escalation",
      "mitigation",
      "recovery",
      "investigation",
    ]),
  );
  assertReadableString(value.actor, `${label} actor`, 512, true);
  assertReadableString(
    value.description,
    `${label} description`,
    10_000,
    true,
    true,
  );
  assertReadableEnum(
    value.confidence,
    `${label} confidence`,
    new Set(["confirmed", "likely", "uncertain", "disputed"]),
  );
  assertReadableStringArray(value.evidenceIds, `${label} evidenceIds`);
  assertReadableEnum(
    value.reviewStatus,
    `${label} reviewStatus`,
    new Set(["proposed", "confirmed", "disputed"]),
  );
  assertOptionalReadableString(value.supersedesId, `${label} supersedesId`, 256);
}

function assertReadableWhy(value: Record<string, unknown>, label: string): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertOptionalReadableString(value.parentId, `${label} parentId`, 256);
  for (const field of ["question", "answer", "counterfactual"] as const) {
    assertReadableString(
      value[field],
      `${label} ${field}`,
      10_000,
      true,
      true,
    );
  }
  assertReadableEnum(
    value.confidence,
    `${label} confidence`,
    new Set(["unverified", "supported", "contradicted"]),
  );
  for (const field of [
    "supportingEvidenceIds",
    "contradictingEvidenceIds",
    "assumptions",
    "alternatives",
    "openQuestionIds",
    "reviewerIds",
  ] as const) {
    assertReadableStringArray(value[field], `${label} ${field}`, 10_000);
  }
  assertReadableString(value.authorId, `${label} authorId`, 256);
  assertReadableEnum(
    value.reviewStatus,
    `${label} reviewStatus`,
    new Set(["proposed", "accepted", "rejected"]),
  );
  assertReadableEnum(
    value.decision,
    `${label} decision`,
    new Set(["continue", "branch", "revise", "stop"]),
  );
  assertReadableEnum(
    value.factorType,
    `${label} factorType`,
    new Set([
      "trigger",
      "proximate cause",
      "contributing factor",
      "latent condition",
      "detection gap",
      "impact amplifier",
      "confirmed non-cause",
    ]),
  );
}

function assertReadableQuestion(
  value: Record<string, unknown>,
  label: string,
): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.text, `${label} text`, 10_000, false, true);
  assertOptionalReadableString(value.owner, `${label} owner`, 256);
  assertReadableEnum(
    value.status,
    `${label} status`,
    new Set(["open", "answered"]),
  );
  assertOptionalReadableString(
    value.answer,
    `${label} answer`,
    10_000,
    true,
    true,
  );
  assertReadableString(value.createdAt, `${label} createdAt`, 128);
}

function assertReadableDecision(
  value: Record<string, unknown>,
  label: string,
): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.text, `${label} text`, 10_000, false, true);
  assertReadableString(
    value.rationale,
    `${label} rationale`,
    10_000,
    true,
    true,
  );
  assertReadableString(value.decidedBy, `${label} decidedBy`, 256);
  assertReadableString(value.decidedAt, `${label} decidedAt`, 128);
}

function assertReadableAction(
  value: Record<string, unknown>,
  label: string,
): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.title, `${label} title`, 512);
  assertOptionalReadableString(value.factorId, `${label} factorId`, 256);
  assertReadableEnum(
    value.category,
    `${label} category`,
    new Set(["containment", "correction", "prevention", "detection", "resilience"]),
  );
  assertReadableEnum(
    value.priority,
    `${label} priority`,
    new Set(["low", "medium", "high", "critical"]),
  );
  assertReadableString(value.owner, `${label} owner`, 256, true);
  assertOptionalReadableString(value.dueDate, `${label} dueDate`, 128);
  for (const field of [
    "acceptanceCriteria",
    "verificationMethod",
    "requiredEvidence",
  ] as const) {
    assertReadableString(
      value[field],
      `${label} ${field}`,
      10_000,
      true,
      true,
    );
  }
  assertReadableStringArray(value.evidenceIds, `${label} evidenceIds`);
  assertReadableEnum(
    value.status,
    `${label} status`,
    new Set([
      "open",
      "in-progress",
      "awaiting-verification",
      "verified",
      "cancelled",
    ]),
  );
  if (value.effectiveness !== undefined) {
    assertReadableEnum(
      value.effectiveness,
      `${label} effectiveness`,
      new Set(["effective", "partly-effective", "ineffective"]),
    );
  }
  assertOptionalReadableString(
    value.completionReceipt,
    `${label} completionReceipt`,
    4_096,
  );
}

function assertReadableReport(
  value: Record<string, unknown>,
  label: string,
): void {
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableInteger(value.number, `${label} number`, 1);
  assertReadableString(value.createdAt, `${label} createdAt`, 128);
  assertReadableString(value.createdBy, `${label} createdBy`, 256);
  assertReadableEnum(
    value.visibility,
    `${label} visibility`,
    new Set(["internal", "public"]),
  );
  assertReadableEnum(
    value.template,
    `${label} template`,
    new Set(["engineering", "executive", "internal-review", "public-postmortem"]),
  );
  assertReadableEnum(
    value.status,
    `${label} status`,
    new Set(["draft", "approved", "published", "superseded"]),
  );
  assertReadableString(
    value.markdown,
    `${label} markdown`,
    MAX_STORED_BYTES,
    true,
    true,
  );
  assertReadableString(
    value.html,
    `${label} html`,
    MAX_STORED_BYTES,
    true,
    true,
  );
  assertReadableString(value.digest, `${label} digest`, 2_048, true);
  for (const field of [
    "approvedBy",
    "approvedAt",
    "publishedAt",
    "publicationUrl",
  ] as const) {
    assertOptionalReadableString(value[field], `${label} ${field}`, 4_096);
  }
}

function assertReadableAudit(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const field of [
    "id",
    "at",
    "actorId",
    "action",
    "entityType",
    "entityId",
  ] as const) {
    assertReadableString(value[field], `${label} ${field}`, 2_048);
  }
  assertReadableString(value.summary, `${label} summary`, 10_000, true, true);
}

function assertReferences(
  references: readonly string[],
  identifiers: ReadonlySet<string>,
  label: string,
): void {
  for (const reference of references) {
    if (!identifiers.has(reference)) {
      storageError(`${label} references missing id ${reference}.`);
    }
  }
}

function assertAcyclicReferences(
  links: ReadonlyMap<string, string | undefined>,
  label: string,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (identifier: string): void => {
    if (visited.has(identifier)) return;
    if (visiting.has(identifier)) {
      storageError(`${label} contains a cycle at id ${identifier}.`);
    }
    visiting.add(identifier);
    const next = links.get(identifier);
    if (next !== undefined) visit(next);
    visiting.delete(identifier);
    visited.add(identifier);
  };
  for (const identifier of links.keys()) visit(identifier);
}

function assertInvestigationReferences(investigation: Investigation): void {
  const memberIds = new Set(investigation.members.map((member) => member.id));
  const evidenceIds = new Set(
    investigation.evidence.map((evidence) => evidence.id),
  );
  const timelineIds = new Set(investigation.timeline.map((event) => event.id));
  const whyIds = new Set(investigation.whys.map((why) => why.id));
  const questionIds = new Set(
    investigation.questions.map((question) => question.id),
  );
  const evidenceById = new Map(
    investigation.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const timelineById = new Map(
    investigation.timeline.map((event) => [event.id, event]),
  );
  const whyById = new Map(
    investigation.whys.map((why) => [why.id, why]),
  );

  for (const evidence of investigation.evidence) {
    assertReferences(
      evidence.supportsClaimIds,
      whyIds,
      `evidence ${evidence.id} supportsClaimIds`,
    );
    assertReferences(
      evidence.contradictsClaimIds,
      whyIds,
      `evidence ${evidence.id} contradictsClaimIds`,
    );
    assertReferences(
      evidence.timelineEventIds,
      timelineIds,
      `evidence ${evidence.id} timelineEventIds`,
    );
    for (const whyId of evidence.supportsClaimIds) {
      if (!whyById.get(whyId)?.supportingEvidenceIds.includes(evidence.id)) {
        storageError(
          `evidence ${evidence.id} support link to ${whyId} is not reciprocal.`,
        );
      }
    }
    for (const whyId of evidence.contradictsClaimIds) {
      if (!whyById.get(whyId)?.contradictingEvidenceIds.includes(evidence.id)) {
        storageError(
          `evidence ${evidence.id} contradiction link to ${whyId} is not reciprocal.`,
        );
      }
    }
    for (const timelineId of evidence.timelineEventIds) {
      if (!timelineById.get(timelineId)?.evidenceIds.includes(evidence.id)) {
        storageError(
          `evidence ${evidence.id} timeline link to ${timelineId} is not reciprocal.`,
        );
      }
    }
  }
  for (const event of investigation.timeline) {
    assertReferences(
      event.evidenceIds,
      evidenceIds,
      `timeline ${event.id} evidenceIds`,
    );
    for (const evidenceId of event.evidenceIds) {
      if (!evidenceById.get(evidenceId)?.timelineEventIds.includes(event.id)) {
        storageError(
          `timeline ${event.id} evidence link to ${evidenceId} is not reciprocal.`,
        );
      }
    }
    if (event.supersedesId !== undefined) {
      if (event.supersedesId === event.id) {
        storageError(`timeline ${event.id} cannot supersede itself.`);
      }
      assertReferences(
        [event.supersedesId],
        timelineIds,
        `timeline ${event.id} supersedesId`,
      );
    }
  }
  for (const why of investigation.whys) {
    if (why.parentId !== undefined) {
      if (why.parentId === why.id) {
        storageError(`why ${why.id} cannot be its own parent.`);
      }
      assertReferences([why.parentId], whyIds, `why ${why.id} parentId`);
    }
    assertReferences(
      why.supportingEvidenceIds,
      evidenceIds,
      `why ${why.id} supportingEvidenceIds`,
    );
    for (const evidenceId of why.supportingEvidenceIds) {
      if (!evidenceById.get(evidenceId)?.supportsClaimIds.includes(why.id)) {
        storageError(
          `why ${why.id} support link to ${evidenceId} is not reciprocal.`,
        );
      }
    }
    assertReferences(
      why.contradictingEvidenceIds,
      evidenceIds,
      `why ${why.id} contradictingEvidenceIds`,
    );
    for (const evidenceId of why.contradictingEvidenceIds) {
      if (!evidenceById.get(evidenceId)?.contradictsClaimIds.includes(why.id)) {
        storageError(
          `why ${why.id} contradiction link to ${evidenceId} is not reciprocal.`,
        );
      }
    }
    assertReferences(
      why.openQuestionIds,
      questionIds,
      `why ${why.id} openQuestionIds`,
    );
    assertReferences(
      why.reviewerIds,
      memberIds,
      `why ${why.id} reviewerIds`,
    );
  }
  for (const action of investigation.actions) {
    if (action.factorId !== undefined) {
      assertReferences(
        [action.factorId],
        whyIds,
        `action ${action.id} factorId`,
      );
    }
    assertReferences(
      action.evidenceIds,
      evidenceIds,
      `action ${action.id} evidenceIds`,
    );
  }
  assertAcyclicReferences(
    new Map(
      investigation.timeline.map((event) => [event.id, event.supersedesId]),
    ),
    "timeline supersedes graph",
  );
  assertAcyclicReferences(
    new Map(investigation.whys.map((why) => [why.id, why.parentId])),
    "why parent graph",
  );
}

function assertReadableInvestigation(
  value: unknown,
  index: number,
): asserts value is Investigation {
  if (!isRecord(value)) storageError(`investigation ${index} is malformed.`);
  const label = `investigation ${index}`;
  if (value.schemaVersion !== 2) {
    storageError(`${label} schemaVersion is malformed.`);
  }
  assertReadableString(value.id, `${label} id`, 256);
  assertReadableString(value.title, `${label} title`, 512);
  assertReadableString(value.statement, `${label} statement`, 10_000, false, true);
  assertReadableEnum(value.severity, `${label} severity`, LEGACY_SEVERITIES);
  assertReadableEnum(value.status, `${label} status`, LEGACY_STATUSES);
  assertReadableString(value.impact, `${label} impact`, 10_000, true, true);
  assertReadableString(
    value.businessImpact,
    `${label} businessImpact`,
    10_000,
    true,
    true,
  );
  assertReadableStringArray(value.systems, `${label} systems`);
  assertReadableStringArray(value.regions, `${label} regions`);
  assertReadableTimes(value.times, `${label} times`);
  assertReadableStringArray(value.sourceLinks, `${label} sourceLinks`, 4_096);
  assertReadableEnum(value.phase, `${label} phase`, LEGACY_PHASES);
  assertReadableString(value.createdAt, `${label} createdAt`, 128);
  assertReadableString(value.updatedAt, `${label} updatedAt`, 128);
  assertReadableString(value.createdBy, `${label} createdBy`, 256);

  const nested = [
    ["members", assertReadableMember],
    ["evidence", assertReadableEvidence],
    ["timeline", assertReadableTimeline],
    ["whys", assertReadableWhy],
    ["actions", assertReadableAction],
    ["questions", assertReadableQuestion],
    ["decisions", assertReadableDecision],
    ["reports", assertReadableReport],
    ["audit", assertReadableAudit],
  ] as const;
  for (const [field, validator] of nested) {
    const records = readableRecords(value[field], `${label} ${field}`);
    records.forEach((record, itemIndex) =>
      validator(record, `${label} ${field} item ${itemIndex}`),
    );
  }
  assertReadableInteger(value.revision, `${label} revision`, 1);
  assertReadableBindings(value.bindings, `${label} bindings`);
  assertInvestigationReferences(value as unknown as Investigation);
}

function assertReadableState(value: unknown): asserts value is PyreState {
  if (!isPyreState(value)) storageError("stored state uses an unsupported schema.");
  assertSerializedStateBound(value, "stored state");
  assertArray(value.investigations, "investigations", MAX_INVESTIGATIONS);
  value.investigations.forEach(assertReadableInvestigation);
  const investigations = value.investigations as Investigation[];
  const identifiers = new Set<string>();
  for (const investigation of investigations) {
    if (identifiers.has(investigation.id)) {
      storageError(`investigations contains duplicate id ${investigation.id}.`);
    }
    identifiers.add(investigation.id);
  }
  if (value.activeId !== undefined) {
    assertReadableString(value.activeId, "activeId", 256);
    if (!identifiers.has(value.activeId)) {
      storageError("activeId does not reference an investigation.");
    }
  }
}

function parseCurrentState(value: MiniAppJsonValue): PyreState {
  const decoded = decodeStoredValue(value, "current state");
  assertReadableState(decoded);
  return decoded;
}

function parseLegacyState(value: MiniAppJsonValue): PyreState {
  const decoded = decodeStoredValue(value, "legacy state");
  assertLegacyState(decoded);
  let sequence = 0;
  const migrated = migrateState(
    decoded,
    (prefix) => `${prefix}_mcp_migration_${++sequence}`,
  );
  assertReadableState(migrated);
  return migrated;
}

function entryValue(entry: MiniAppStorageEntry, label: string): MiniAppJsonValue | null {
  if (!isRecord(entry) || !Object.hasOwn(entry, "value")) {
    storageError(`${label} entry is malformed.`);
  }
  return entry.value as MiniAppJsonValue | null;
}

export async function loadPyreMcpState(
  runtime: PyreMcpRuntime = defaultRuntime,
): Promise<PyreState> {
  const context = await runtime.getExecutionContext();
  assertExecutionContext(context);

  const current = entryValue(
    await runtime.readStorage(CURRENT_ADDRESS),
    "current state",
  );
  if (current !== null) return parseCurrentState(current);

  const legacy = entryValue(
    await runtime.readStorage(LEGACY_ADDRESS),
    "legacy state",
  );
  return legacy === null ? emptyState() : parseLegacyState(legacy);
}

function toJson(value: unknown): MiniAppJsonValue {
  return JSON.parse(JSON.stringify(value)) as MiniAppJsonValue;
}

function investigationIdFrom(arguments_: MiniAppJsonValue): string {
  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    throw new Error("get_investigation requires an object argument.");
  }
  const investigationId = arguments_.investigationId;
  if (
    typeof investigationId !== "string" ||
    !investigationId.trim() ||
    investigationId.length > 256 ||
    CONTROL_CHARACTER.test(investigationId)
  ) {
    throw new Error(
      "get_investigation requires a valid investigationId of at most 256 characters.",
    );
  }
  return investigationId;
}

function boundedInvestigation(investigation: Investigation) {
  return {
    schemaVersion: investigation.schemaVersion,
    id: investigation.id,
    title: investigation.title,
    statement: investigation.statement,
    severity: investigation.severity,
    status: investigation.status,
    impact: investigation.impact,
    businessImpact: investigation.businessImpact,
    systems: investigation.systems,
    regions: investigation.regions,
    times: {
      start: investigation.times.start,
      detected: investigation.times.detected,
      mitigated: investigation.times.mitigated,
      recovered: investigation.times.recovered,
      ended: investigation.times.ended,
    },
    sourceLinks: investigation.sourceLinks,
    phase: investigation.phase,
    createdAt: investigation.createdAt,
    updatedAt: investigation.updatedAt,
    createdBy: investigation.createdBy,
    members: investigation.members.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    evidence: investigation.evidence.map((evidence) => ({
      id: evidence.id,
      title: evidence.title,
      kind: evidence.kind,
      source: evidence.source,
      description: evidence.description,
      collectedAt: evidence.collectedAt,
      collectedBy: evidence.collectedBy,
      incidentFrom: evidence.incidentFrom,
      incidentTo: evidence.incidentTo,
      visibility: evidence.visibility,
      digest: evidence.digest,
      mimeType: evidence.mimeType,
      sizeBytes: evidence.sizeBytes,
      reliability: evidence.reliability,
      systems: evidence.systems,
      supportsClaimIds: evidence.supportsClaimIds,
      contradictsClaimIds: evidence.contradictsClaimIds,
      timelineEventIds: evidence.timelineEventIds,
      immutableSnapshot: evidence.immutableSnapshot,
      collectionStatus: evidence.collectionStatus,
    })),
    timeline: investigation.timeline.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      originalTimestamp: event.originalTimestamp,
      timezone: event.timezone,
      type: event.type,
      actor: event.actor,
      description: event.description,
      confidence: event.confidence,
      evidenceIds: event.evidenceIds,
      reviewStatus: event.reviewStatus,
      supersedesId: event.supersedesId,
    })),
    whys: investigation.whys.map((why) => ({
      id: why.id,
      parentId: why.parentId,
      question: why.question,
      answer: why.answer,
      confidence: why.confidence,
      supportingEvidenceIds: why.supportingEvidenceIds,
      contradictingEvidenceIds: why.contradictingEvidenceIds,
      assumptions: why.assumptions,
      alternatives: why.alternatives,
      openQuestionIds: why.openQuestionIds,
      authorId: why.authorId,
      reviewerIds: why.reviewerIds,
      reviewStatus: why.reviewStatus,
      decision: why.decision,
      factorType: why.factorType,
      counterfactual: why.counterfactual,
    })),
    actions: investigation.actions.map((action) => ({
      id: action.id,
      title: action.title,
      factorId: action.factorId,
      category: action.category,
      priority: action.priority,
      owner: action.owner,
      dueDate: action.dueDate,
      acceptanceCriteria: action.acceptanceCriteria,
      verificationMethod: action.verificationMethod,
      requiredEvidence: action.requiredEvidence,
      evidenceIds: action.evidenceIds,
      status: action.status,
      effectiveness: action.effectiveness,
      completionReceipt: action.completionReceipt,
    })),
    questions: investigation.questions.map((question) => ({
      id: question.id,
      text: question.text,
      owner: question.owner,
      status: question.status,
      answer: question.answer,
      createdAt: question.createdAt,
    })),
    decisions: investigation.decisions.map((decision) => ({
      id: decision.id,
      text: decision.text,
      rationale: decision.rationale,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
    })),
    reports: investigation.reports.map((report) => ({
      id: report.id,
      number: report.number,
      createdAt: report.createdAt,
      createdBy: report.createdBy,
      visibility: report.visibility,
      template: report.template,
      status: report.status,
      digest: report.digest,
      approvedBy: report.approvedBy,
      approvedAt: report.approvedAt,
      publishedAt: report.publishedAt,
      publicationUrl: report.publicationUrl,
      markdownLength: report.markdown.length,
      htmlLength: report.html.length,
    })),
    audit: investigation.audit.map((entry) => ({
      id: entry.id,
      at: entry.at,
      action: entry.action,
      entityType: entry.entityType,
    })),
    revision: investigation.revision,
  };
}

export function createPyreMcpServer(runtime: PyreMcpRuntime = defaultRuntime) {
  return defineMcpServer({
    tools: {
      list_investigations: {
        description:
          "List Pyre investigations in the active workspace with lifecycle and evidence counts.",
        inputSchema: { type: "object", additionalProperties: false },
        async execute() {
          const state = await loadPyreMcpState(runtime);
          return toJson({
            activeId: state.activeId ?? null,
            investigations: state.investigations.map((investigation) => ({
              id: investigation.id,
              title: investigation.title,
              statement: investigation.statement,
              severity: investigation.severity,
              status: investigation.status,
              phase: investigation.phase,
              revision: investigation.revision,
              evidenceCount: investigation.evidence.length,
              timelineEventCount: investigation.timeline.length,
              openQuestionCount: investigation.questions.filter(
                (question) => question.status === "open",
              ).length,
              openActionCount: investigation.actions.filter(
                (action) =>
                  action.status !== "verified" &&
                  action.status !== "cancelled",
              ).length,
              updatedAt: investigation.updatedAt,
            })),
          });
        },
      },
      get_investigation: {
        description:
          "Get reviewed structured Pyre investigation state without report body duplication or raw VFS artifact contents.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            investigationId: {
              type: "string",
              minLength: 1,
              maxLength: 256,
            },
          },
          required: ["investigationId"],
        },
        async execute(arguments_) {
          const investigationId = investigationIdFrom(arguments_);
          const state = await loadPyreMcpState(runtime);
          const investigation = state.investigations.find(
            (item) => item.id === investigationId,
          );
          return investigation
            ? toJson({
                found: true,
                investigation: boundedInvestigation(investigation),
              })
            : toJson({ found: false, investigationId });
        },
      },
    },
  });
}

export const pyreMcpStorageAddresses = Object.freeze({
  current: CURRENT_ADDRESS,
  legacy: LEGACY_ADDRESS,
});
