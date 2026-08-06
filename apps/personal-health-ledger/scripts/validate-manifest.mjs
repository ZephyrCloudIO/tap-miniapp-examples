import fs from "node:fs";
import assert from "node:assert/strict";
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
const specialist = manifest.contributions.find(
  contribution =>
    contribution.kind === "specialist" &&
    contribution.id === "personal-health-researcher",
);
assert.ok(specialist, "Personal Health Ledger must declare its package specialist.");
assert.deepEqual(specialist.targets, {
  desktop: { runtime: "host-declarative" },
});
assert.equal(specialist.lifecycleScope, "installation");
assert.equal(
  specialist.options?.manifest,
  "specialists/personal-health-researcher/0.1.0.json",
);
const specialistAsset = JSON.parse(
  fs.readFileSync(
    new URL(
      "../specialists/personal-health-researcher/0.1.0.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(specialistAsset.name, `${specialist.id}@${specialistAsset.version}`);
assert.equal(specialistAsset.slug, specialist.id);
assert.equal(specialistAsset.version, "0.1.0");
console.log(`manifest.tap.json is valid against SDK ${sdkPackage.version} schema`);
