import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const schema = JSON.parse(
  fs.readFileSync(
    require.resolve("@theaiplatform/miniapp-sdk/config-schema.json"),
    "utf8",
  ),
);
const manifest = JSON.parse(
  fs.readFileSync(new URL("../manifest.tap.json", import.meta.url), "utf8"),
);
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
const specialist = contribution("specialist", "engineering-change-specialist");
const mcpServer = contribution("mcp.server", "engineering-change-mcp");
if (!specialist || !mcpServer) {
  throw new Error(
    "Engineering Change must declare its canonical specialist and package-runtime MCP server.",
  );
}
assert.deepEqual(specialist.targets, {
  desktop: { runtime: "host-declarative" },
});
assert.equal(specialist.lifecycleScope, "installation");
assert.equal(
  specialist.options?.manifest,
  "specialists/engineering-change-specialist/0.1.0.json",
);
const specialistAsset = JSON.parse(
  fs.readFileSync(
    new URL(
      "../specialists/engineering-change-specialist/0.1.0.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(specialistAsset.name, specialist.id);
assert.equal(specialistAsset.version, "0.1.0");
const consumerPolicy = mcpServer.options?.consumerPolicy;
if (
  JSON.stringify(consumerPolicy?.contributionIds) !==
    JSON.stringify(["engineering-change-specialist"]) ||
  JSON.stringify(consumerPolicy?.externalConsumers) !==
    JSON.stringify(["selected-specialists"])
) {
  throw new Error(
    "Engineering Change MCP policy must preserve same-package provenance and permit a human-reviewed grant for the canonical specialist slug.",
  );
}
const expectedStorageReads = [
  { namespace: "engineering-change", keyTemplate: "changes/v1" },
];
for (const toolId of [
  "engineering-change-get-change",
  "engineering-change-list-changes",
  "engineering-change-get-impact-hypothesis",
  "engineering-change-get-review-synthesis",
]) {
  assert.deepEqual(
    contribution("mcp.tool", toolId)?.options?.storageReads,
    expectedStorageReads,
    `${toolId} must preload only the current change-ledger key`,
  );
}

const expectedSkills = [
  ["security-impact-hypothesis", "changes.propose"],
  ["security-implementation-review", "changes.review"],
  ["architecture-review", "changes.review"],
  ["review-coordinator", "changes.review"],
];
for (const [skillId, gate] of expectedSkills) {
  const skill = contribution("agent.skill", skillId);
  if (!skill) {
    throw new Error(
      `Engineering Change must declare the ${skillId} review skill.`,
    );
  }
  assert.equal(skill.lifecycleScope, "installation");
  assert.deepEqual(skill.targets, { desktop: { runtime: "host-declarative" } });
  assert.deepEqual(skill.options?.files, ["SKILL.md"]);
  assert.deepEqual(skill.authorization?.allOf, [gate]);
  const skillAsset = fs.readFileSync(
    new URL(`../skills/${skillId}/0.1.0/SKILL.md`, import.meta.url),
    "utf8",
  );
  const frontmatter = skillAsset.match(/^---\n([\s\S]*?)\n---/u);
  if (!frontmatter?.[1]?.includes(`name: ${skillId}`)) {
    throw new Error(`${skillId} SKILL.md frontmatter must name itself.`);
  }
}

console.log(
  `manifest.tap.json is valid against SDK ${manifest.compatibility.tapSdk} schema`,
);
