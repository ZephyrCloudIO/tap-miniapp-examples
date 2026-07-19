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
const desktopExposes = manifest.targets.desktop.exposes;
for (const tool of manifest.contributions.filter(
  (contribution) => contribution.kind === "mcp.tool",
)) {
  const server = contributions.get(tool.options.serverContributionId);
  assert.equal(server?.kind, "mcp.server", `${tool.id} must reference an MCP server`);
  const serverExpose = server.targets?.desktop?.expose;
  assert.ok(serverExpose, `${server.id} must declare its desktop expose`);
  assert.ok(desktopExposes[serverExpose], `${server.id} expose must be packaged`);
  for (const schemaProperty of ["inputSchema", "outputSchema"]) {
    const relativePath = tool.options[schemaProperty];
    if (relativePath) {
      const document = JSON.parse(
        fs.readFileSync(new URL(`../${relativePath}`, import.meta.url)),
      );
      ajv.compile(document);
    }
  }
}

console.log("manifest.tap.json and MCP tool schemas are valid");
