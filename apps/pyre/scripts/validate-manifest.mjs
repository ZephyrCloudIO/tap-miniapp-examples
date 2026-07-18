import fs from "node:fs";
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

console.log("manifest.tap.json is valid against SDK 0.0.1 schema");
