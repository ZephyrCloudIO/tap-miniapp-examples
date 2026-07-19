import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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

const schemaDirectory = new URL("../schemas", import.meta.url).pathname;
const eventSchemas = fs.readdirSync(schemaDirectory)
  .filter((name) => name.endsWith(".schema.json"))
  .map((name) => JSON.parse(fs.readFileSync(path.join(schemaDirectory, name), "utf8")));
const declaredSchemas = new Set(manifest.events.publishes.map((event) => event.schema));
const ajv = new Ajv2020({ strict: true });
for (const eventSchema of eventSchemas) {
  ajv.compile(eventSchema);
  if (!declaredSchemas.has(eventSchema.$id)) throw new Error(`Event schema ${eventSchema.$id} is not declared by the manifest.`);
}
for (const schemaId of declaredSchemas) {
  if (!eventSchemas.some((eventSchema) => eventSchema.$id === schemaId)) throw new Error(`Manifest event schema ${schemaId} has no checked source schema.`);
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const workflowSchemaDirectory = new URL("../workflow-schemas", import.meta.url).pathname;
const workflowReferences = manifest.contributions.flatMap((contribution) => {
  if (contribution.kind === "workflow") return [contribution.options.manifest, ...contribution.options.inputs.map((port) => port.schema), ...contribution.options.outputs.map((port) => port.schema)];
  if (contribution.kind === "workflow.node") return [contribution.options.config, ...contribution.options.inputs.map((port) => port.schema), ...contribution.options.outputs.map((port) => port.schema)];
  return [];
});
for (const reference of workflowReferences) {
  const schemaPath = path.join(workflowSchemaDirectory, path.basename(reference.id));
  const document = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  new Ajv2020({ strict: false }).compile(document);
  const integrity = `sha256-${createHash("sha256").update(canonicalJson(document)).digest("base64")}`;
  if (integrity !== reference.integrity) throw new Error(`Workflow schema ${reference.id} does not match its canonical integrity.`);
}

console.log(`manifest.tap.json, ${eventSchemas.length} event schemas, and ${workflowReferences.length} workflow schema references are valid against SDK 0.2.0-pr.6821.02b36a6 contracts`);
