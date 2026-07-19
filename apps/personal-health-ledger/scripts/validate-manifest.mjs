import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
const require = createRequire(import.meta.url);
const schemaPath = require.resolve("@theaiplatform/miniapp-sdk/config-schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const sdkPackage = JSON.parse(fs.readFileSync(path.join(path.dirname(schemaPath), "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.tap.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
if (!validate(manifest)) { console.error(validate.errors); process.exit(1); }
console.log(`manifest.tap.json is valid against SDK ${sdkPackage.version} schema`);
