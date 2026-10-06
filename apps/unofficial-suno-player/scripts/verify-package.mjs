import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `tap-miniapp build` already verifies targets, integrity, and portability.
// This only checks the workflow schemas the workflow-host target must ship.
const packageRoot = fileURLToPath(new URL("../dist", import.meta.url));
const manifestPath = path.join(packageRoot, "manifest.tap.json");

if (!fs.existsSync(manifestPath)) throw new Error("TAP package manifest is missing; run build:miniapp first.");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const targets = new Set((manifest.targets ?? []).map(({ target }) => target));
for (const target of ["desktop", "workflow-host"]) {
  if (!targets.has(target)) throw new Error(`Assembled package is missing its ${target} target.`);
}

const schemas = [
  "targets/workflow-host/schemas/manual-brief-workflow.schema.json",
  "targets/workflow-host/schemas/manual-brief-node-config.schema.json",
];
for (const schema of schemas) {
  if (!fs.existsSync(path.join(packageRoot, schema))) throw new Error(`Required workflow schema is missing: ${schema}`);
}

console.log(`verified desktop and workflow-host targets and ${schemas.length} workflow schemas`);
