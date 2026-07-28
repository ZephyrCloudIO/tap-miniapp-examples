import assert from "node:assert/strict";
import test from "node:test";

import { asSurfaceMountError } from "./surface-error.mjs";

test("preserves native JavaScript errors", () => {
  const original = new Error("profile permission is not granted");
  assert.equal(asSurfaceMountError(original), original);
});

test("turns a wasm string rejection into a visible bounded error", () => {
  const result = asSurfaceMountError(
    `\nCannot authenticate TAP user:\u0000 ${"x".repeat(600)}\n`,
  );
  assert.ok(result instanceof Error);
  assert.match(result.message, /^Cannot authenticate TAP user: x+$/u);
  assert.equal(result.message.length, 512);
});

test("uses a stable fallback for opaque wasm rejections", () => {
  assert.equal(
    asSurfaceMountError({}).message,
    "Brainrot Tower Defense failed to mount.",
  );
});
