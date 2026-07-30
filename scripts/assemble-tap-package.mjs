#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const appRoot = path.resolve(process.argv[2] ?? ".");
const descriptorPath = path.join(appRoot, "manifest.tap.json");
const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
const targets = Object.fromEntries(
  Object.keys(descriptor.targets ?? {}).map((target) => [
    target,
    path.join(appRoot, ".tap-build", target),
  ]),
);
assert.ok(Object.keys(targets).length > 0, "TAP package must declare at least one target.");

const requireFromApp = createRequire(path.join(appRoot, "package.json"));
const sdkPackagePath = requireFromApp.resolve(
  "@theaiplatform/miniapp-sdk/config-schema.json",
);
const sdkPackage = JSON.parse(
  fs.readFileSync(path.join(path.dirname(sdkPackagePath), "package.json"), "utf8"),
);
const rspackEntrypoint =
  typeof sdkPackage.exports?.["./rspack"] === "string"
    ? sdkPackage.exports["./rspack"]
    : sdkPackage.exports?.["./rspack"]?.import;
assert.equal(typeof rspackEntrypoint, "string", "TAP SDK must expose ./rspack.");
const { assembleTapPackage } = await import(
  pathToFileURL(path.resolve(path.dirname(sdkPackagePath), rspackEntrypoint)).href
);
assert.equal(
  typeof assembleTapPackage,
  "function",
  "TAP SDK must export assembleTapPackage.",
);

await assembleTapPackage({
  manifest: descriptorPath,
  output: path.join(appRoot, "dist"),
  targets,
});

console.log(`assembled TAP package with ${Object.keys(targets).length} target(s)`);
