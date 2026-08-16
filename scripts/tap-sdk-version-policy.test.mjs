import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedRstestVersionForSdk,
  isExactSdkVersion,
} from "./tap-sdk-version-policy.mjs";

test("accepts exact stable and prerelease SDK versions", () => {
  assert.equal(isExactSdkVersion("0.7.0"), true);
  assert.equal(isExactSdkVersion("0.0.0-fix-roadie-dev-origin.1"), true);
  assert.equal(
    expectedRstestVersionForSdk("0.0.0-fix-roadie-dev-origin.1"),
    "0.11.5",
  );
});

test("rejects ranges, tags, and local SDK paths", () => {
  for (const version of ["^0.7.0", "latest", "file:../miniapp-sdk", "0.7"])
    assert.equal(isExactSdkVersion(version), false);
});
