import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";

const require = createRequire(import.meta.url);
const schema = JSON.parse(fs.readFileSync(require.resolve("@theaiplatform/miniapp-sdk/config-schema.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.tap.json", import.meta.url), "utf8"));
const validate = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: { uint16: true, uint64: true, uri: true },
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

console.log(`manifest.tap.json and ${eventSchemas.length} event schemas are valid against SDK 0.0.1 contracts`);
