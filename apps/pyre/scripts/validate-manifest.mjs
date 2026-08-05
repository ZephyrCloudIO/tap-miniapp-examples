import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const schema = JSON.parse(fs.readFileSync(require.resolve("@theaiplatform/miniapp-sdk/config-schema.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.tap.json", import.meta.url), "utf8"));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { uint8: true, uint16: true, uint64: true, uri: true },
}).compile(schema);

if (!validate(manifest)) {
  console.error(validate.errors);
  process.exit(1);
}

const contribution = (kind, id) =>
  manifest.contributions.find(
    (candidate) => candidate.kind === kind && candidate.id === id,
  );
const specialist = contribution("specialist", "pyre-investigation-specialist");
const mcpServer = contribution("mcp.server", "pyre-mcp");
if (!specialist || !mcpServer) {
  throw new Error(
    "Pyre must declare its canonical specialist and package-runtime MCP server.",
  );
}
assert.deepEqual(specialist.targets, {
  desktop: { runtime: "host-declarative" },
});
assert.equal(specialist.lifecycleScope, "installation");
assert.equal(
  specialist.options?.manifest,
  "specialists/pyre-investigation-specialist/0.1.0.json",
);
const specialistAsset = JSON.parse(
  fs.readFileSync(
    new URL(
      "../specialists/pyre-investigation-specialist/0.1.0.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(specialistAsset.name, `${specialist.id}@${specialistAsset.version}`);
assert.equal(specialistAsset.slug, specialist.id);
assert.equal(specialistAsset.version, "0.1.0");
const consumerPolicy = mcpServer.options?.consumerPolicy;
if (
  JSON.stringify(consumerPolicy?.contributionIds) !==
    JSON.stringify(["pyre-investigation-specialist"]) ||
  JSON.stringify(consumerPolicy?.externalConsumers) !==
    JSON.stringify(["selected-specialists"])
) {
  throw new Error(
    "Pyre MCP policy must preserve same-package provenance and permit a human-reviewed grant for the canonical specialist slug.",
  );
}
const expectedStorageReads = [
  { namespace: "pyre", keyTemplate: "investigations/v2" },
  { namespace: "pyre", keyTemplate: "investigations/v1" },
];
for (const toolId of [
  "pyre-list-investigations",
  "pyre-get-investigation",
]) {
  assert.deepEqual(
    contribution("mcp.tool", toolId)?.options?.storageReads,
    expectedStorageReads,
    `${toolId} must preload only the current and migration investigation keys`,
  );
}

console.log(`manifest.tap.json is valid against SDK ${manifest.compatibility.tapSdk} schema`);
