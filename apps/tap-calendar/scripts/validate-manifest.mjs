import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = require.resolve(
  "@theaiplatform/miniapp-sdk/config-schema.json",
);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const sdkPackage = JSON.parse(
  fs.readFileSync(path.join(path.dirname(schemaPath), "package.json"), "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "manifest.tap.json"), "utf8"),
);
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
if (!validate(manifest)) {
  console.error(validate.errors);
  process.exit(1);
}

assert.equal(manifest.compatibility.tapSdk, "0.8.0");
assert.equal(manifest.compatibility.tapHost, ">=2.3.4");
assert.equal(sdkPackage.version, "0.8.0");
assert.deepEqual(Object.keys(manifest.targets).sort(), [
  "desktop",
  "quickjs",
  "workflow-host",
]);
assert.equal(
  manifest.targets.quickjs.exposes["./mcp/calendar-tools"].runtime,
  "quickjs",
);
assert.equal(
  manifest.targets.quickjs.exposes["./mcp/calendar-daily-summary"].runtime,
  "quickjs",
);
assert.equal(
  manifest.targets["workflow-host"].exposes["./workflow-host/catalog"].runtime,
  "workflow-host",
);

const contribution = (kind, id) =>
  manifest.contributions.find(
    (candidate) => candidate.kind === kind && candidate.id === id,
  );

const surface = contribution("ui.surface", "tap-calendar");
assert.ok(surface, "TAP Calendar must declare its desktop surface.");
const calendarChangedSubscription =
  "tap-pkg.examples-tap-calendar.calendar.changed";
assert.deepEqual(surface.subscribes, [calendarChangedSubscription]);
assert.deepEqual(surface.authorization.allOf, ["calendar.view"]);
assert.deepEqual(surface.authorization.onDemand, [
  "calendar.manage",
  "calendar.approve",
  "calendar.publish",
  "credentials.use",
  "network.request",
  "notifications.show",
  "channels.create",
  "channels.list",
  "channels.read",
  "channels.send-message",
  "task.read",
  "workflows.list",
  "workflows.invoke",
  "navigation.open-external",
]);
assert.deepEqual(surface.authorization.effects, [
  { kind: "storage", resources: ["tap-calendar"] },
  {
    kind: "external-network",
    resources: [
      "http://127.0.0.1:8787",
      "https://calendar-api.theaiplatform.app",
    ],
  },
  {
    kind: "external-navigation",
    resources: [
      "https://accounts.google.com",
      "https://login.microsoftonline.com",
    ],
  },
  { kind: "credentials", resources: ["http"] },
  { kind: "user-notification", resources: ["os"] },
  {
    kind: "host-api",
    resources: [
      "tap.channels:create",
      "tap.channels:list",
      "tap.channels:read",
      "tap.channels:send-message",
      "tap.workflows:list",
      "tap.workflows:invoke",
    ],
  },
]);

const channelSchedulerSurface = contribution(
  "ui.surface",
  "tap-calendar-channel-scheduler",
);
assert.ok(
  channelSchedulerSurface,
  "TAP Calendar must declare its channel scheduler surface.",
);
assert.equal(
  channelSchedulerSurface.targets.desktop.expose,
  "./ui/desktop",
);
assert.deepEqual(channelSchedulerSurface.publishes, [
  "calendar.surface.mounted",
  "calendar.surface.unmounted",
  "calendar.changed",
]);
assert.deepEqual(channelSchedulerSurface.subscribes, [
  calendarChangedSubscription,
]);
assert.deepEqual(channelSchedulerSurface.authorization, {
  allOf: ["calendar.view"],
  onDemand: [
    "calendar.manage",
    "credentials.use",
    "network.request",
    "channels.read",
  ],
  effects: [
    { kind: "storage", resources: ["tap-calendar"] },
    {
      kind: "external-network",
      resources: [
        "http://127.0.0.1:8787",
        "https://calendar-api.theaiplatform.app",
      ],
    },
    { kind: "credentials", resources: ["http"] },
    { kind: "host-api", resources: ["tap.channels:read"] },
  ],
});
assert.deepEqual(channelSchedulerSurface.options, {
  displayName: "Schedule",
  description: "Schedule a meeting with selected members of this TAP channel.",
  placement: "channel-apps",
  scope: "channel",
  instancePolicy: "per-channel",
  persistence: "retained",
  iconAssets: ["assets/calendar.svg"],
});

const scheduleCommand = contribution("action.command", "schedule");
assert.ok(scheduleCommand, "TAP Calendar must declare /schedule.");
assert.equal(scheduleCommand.lifecycleScope, "installation");
assert.deepEqual(scheduleCommand.options, {
  label: "Schedule a meeting",
  placements: [
    "channel-composer",
    "launch:ui.surface:tap-calendar-channel-scheduler",
  ],
});

const composition = contribution("miniapp", "tap-calendar-app");
assert.ok(composition, "TAP Calendar must declare its miniapp composition.");
assert.ok(
  composition.options.contributionIds.includes("tap-calendar-channel-scheduler"),
);
assert.ok(composition.options.contributionIds.includes("schedule"));
assert.ok(
  composition.options.contributionIds.includes("calendar-daily-summary"),
);

const permissionCatalog = contribution(
  "permission.catalog",
  "tap-calendar-permissions",
);
assert.ok(permissionCatalog, "TAP Calendar must declare its permission catalog.");
assert.deepEqual(
  permissionCatalog.options.actions.find(
    (action) => action.id === "navigation.open-external",
  ),
  {
    id: "navigation.open-external",
    resource: "external-navigation",
    scopes: ["workspace"],
    directActors: ["human"],
    delegatedActors: [],
    autonomyCeiling: "do",
    consent: "reusable",
    risk: "consequential",
  },
);
assert.ok(
  permissionCatalog.options.levels
    .find((level) => level.id === "calendar-member")
    ?.actions.includes("navigation.open-external"),
  "The calendar-member level must grant the declared browser-navigation action.",
);
const permissionScopes = new Map(
  permissionCatalog.options.actions.map((action) => [action.id, action.scopes]),
);
for (const actionId of [
  "calendar.view",
  "calendar.manage",
  "credentials.use",
  "network.request",
  "channels.read",
]) {
  assert.deepEqual(
    permissionScopes.get(actionId),
    ["workspace", "channel"],
    `${actionId} must authorize the channel scheduler scope.`,
  );
}

const server = contribution("mcp.server", "calendar-tools");
assert.ok(server, "TAP Calendar must declare calendar-tools.");
assert.equal(server.targets.quickjs.expose, "./mcp/calendar-tools");
assert.deepEqual(server.options.consumerPolicy.externalConsumers, [
  "selected-specialists",
]);
const dailySummaryServer = contribution("mcp.server", "calendar-daily-summary");
assert.ok(dailySummaryServer, "TAP Calendar must declare calendar-daily-summary.");
assert.equal(
  dailySummaryServer.targets.quickjs.expose,
  "./mcp/calendar-daily-summary",
);
assert.deepEqual(dailySummaryServer.options.consumerPolicy.externalConsumers, [
  "selected-specialists",
]);

const expectedTools = new Map([
  ["calendar-list-events", ["calendar-tools", "list_events"]],
  ["calendar-summarize-day", ["calendar-daily-summary", "summarize_day"]],
  ["calendar-find-available-slots", ["calendar-tools", "find_available_slots"]],
  ["calendar-draft-meeting", ["calendar-tools", "draft_meeting"]],
]);
const tools = manifest.contributions.filter(
  (candidate) => candidate.kind === "mcp.tool",
);
assert.equal(tools.length, expectedTools.size);
for (const tool of tools) {
  const expected = expectedTools.get(tool.id);
  assert.ok(expected, `Unexpected MCP tool contribution ${tool.id}.`);
  assert.equal(tool.options.serverContributionId, expected[0]);
  assert.equal(tool.options.toolName, expected[1]);
  assert.deepEqual(tool.options.storageReads, [
    {
      namespace: "tap-calendar",
      keyTemplate: "users/{userId}/calendar-state/v2",
    },
    {
      namespace: "tap-calendar",
      keyTemplate: "users/{userId}/provider-event-cache/v1",
    },
  ]);
}

const expectedNodes = new Map([
  [
    "normalize-booking-created",
    ["examples-tap-calendar.normalize-booking-created", "normalizebookingcreated"],
  ],
  [
    "normalize-booking-cancelled",
    ["examples-tap-calendar.normalize-booking-cancelled", "normalizebookingcancelled"],
  ],
  ["draft-work-block", ["examples-tap-calendar.draft-work-block", "draftworkblock"]],
  [
    "prepare-channel-summary",
    ["examples-tap-calendar.prepare-channel-summary", "preparechannelsummary"],
  ],
]);
const nodes = manifest.contributions.filter(
  (candidate) => candidate.kind === "workflow.node",
);
assert.equal(nodes.length, expectedNodes.size);
for (const node of nodes) {
  const expected = expectedNodes.get(node.id);
  assert.ok(expected, `Unexpected workflow node ${node.id}.`);
  assert.equal(node.options.nodeKind, expected[0]);
  assert.equal(node.options.exportName, expected[1]);
  assert.equal(node.options.effect, "pure");
  assert.deepEqual(node.options.requires, []);
  assert.equal(node.options.execution.maxAttempts, 1);
  assert.equal(node.options.execution.idempotency, "idempotent");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function schemaReferences(node) {
  return [
    node.options.config,
    ...node.options.inputs.map((port) => port.schema),
    ...node.options.outputs.map((port) => port.schema),
  ];
}

for (const reference of nodes.flatMap(schemaReferences)) {
  const relativePath = reference.id.replace(
    "targets/workflow-host/schemas/",
    "workflow-schemas/",
  );
  const contents = JSON.parse(
    fs.readFileSync(path.join(packageRoot, relativePath), "utf8"),
  );
  const integrity = `sha256-${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(contents)))
    .digest("base64")}`;
  assert.equal(reference.integrity, integrity, `${reference.id} integrity drifted.`);
}

const durableEvents = (manifest.events?.publishes ?? []).filter(
  (event) => event.delivery === "durable",
);
assert.deepEqual(
  durableEvents,
  [],
  "This package must not claim native durable booking triggers.",
);
assert.deepEqual(manifest.events?.subscribes, [
  { event: calendarChangedSubscription, versions: [1] },
]);
const declaredSubscriptions = new Set(
  (manifest.events?.subscribes ?? []).map((event) => event.event),
);
for (const candidate of manifest.contributions) {
  for (const event of candidate.subscribes ?? []) {
    assert.ok(
      declaredSubscriptions.has(event),
      `${candidate.id} subscribes to undeclared event ${event}`,
    );
  }
}

console.log(
  `manifest.tap.json is valid against SDK ${sdkPackage.version}; MCP storage selectors and four pure workflow-node schema integrities are exact`,
);
