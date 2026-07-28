import fs from "node:fs";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../manifest.tap.json", import.meta.url)),
);
const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      "../node_modules/@theaiplatform/miniapp-sdk/config-schema.json",
      import.meta.url,
    ),
  ),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("uint16", {
  type: "number",
  validate: (value) => Number.isInteger(value) && value >= 0 && value <= 65_535,
});
ajv.addFormat("uint64", {
  type: "number",
  validate: (value) => Number.isSafeInteger(value) && value >= 0,
});
ajv.addFormat("uri", {
  type: "string",
  validate: (value) => URL.canParse(value),
});

if (!ajv.validate(schema, manifest)) {
  console.error(ajv.errors);
  process.exit(1);
}

const contributions = new Map(
  manifest.contributions.map((contribution) => [contribution.id, contribution]),
);
const surface = contributions.get("brainrot-td");
assert.equal(
  surface?.kind,
  "ui.surface",
  "brainrot-td must remain a UI surface",
);
assert.deepEqual(
  surface.authorization.allOf,
  ["brainrot-td.play"],
  "only the supported gameplay action may gate channel-panel projection",
);
assert.equal(
  surface.authorization.onDemand,
  undefined,
  "the channel-panel surface must not request unsupported on-demand host actions",
);
assert.deepEqual(
  surface.authorization.effects.filter((effect) => effect.kind === "host-api"),
  [],
  "the channel-panel surface must not declare unsupported host API effects",
);
const permissions = contributions.get("brainrot-td-permissions");
assert.equal(
  permissions?.kind,
  "permission.catalog",
  "brainrot-td must retain its permission catalog",
);
assert.deepEqual(
  permissions.options.actions.map((action) => action.id),
  ["brainrot-td.play", "brainrot-td.read-state"],
  "the permission catalog must contain only actions supported by the surface and MCP tool",
);
for (const tool of manifest.contributions.filter(
  (contribution) => contribution.kind === "mcp.tool",
)) {
  const server = contributions.get(tool.options.serverContributionId);
  assert.equal(server?.kind, "mcp.server", `${tool.id} must reference an MCP server`);
  assert.deepEqual(
    Object.keys(server.targets ?? {}),
    ["quickjs"],
    `${server.id} must target only QuickJS`,
  );
  const serverExpose = server.targets.quickjs.expose;
  assert.equal(
    serverExpose,
    `./mcp/${server.id}`,
    `${server.id} must use its canonical MCP expose`,
  );
  assert.equal(
    server.targets.quickjs.runtime,
    "quickjs",
    `${server.id} must execute in QuickJS`,
  );
  assert.ok(
    manifest.targets.quickjs.exposes[serverExpose],
    `${server.id} expose must be packaged`,
  );
  assert.equal(
    tool.targets,
    undefined,
    `${tool.id} must inherit its package-runtime server target`,
  );
  assert.deepEqual(
    tool.options.storageReads,
    [
      {
        namespace: "brainrot-td",
        keyTemplate: "mcp/users/{userId}/channels/{channelId}/current",
      },
    ],
    `${tool.id} must preload only its trusted user/channel projection`,
  );
  for (const schemaProperty of ["inputSchema", "outputSchema"]) {
    const relativePath = tool.options[schemaProperty];
    if (relativePath) {
      const sourceName = relativePath.split("/").at(-1);
      const document = JSON.parse(
        fs.readFileSync(new URL(`../schemas/${sourceName}`, import.meta.url)),
      );
      ajv.compile(document);
    }
  }
}

console.log("manifest.tap.json and MCP tool schemas are valid");
