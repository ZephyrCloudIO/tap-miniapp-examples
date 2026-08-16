import assert from "node:assert/strict";
import test from "node:test";

import { stableVersionArtifactBase } from "./tap-app-release-envelope.mjs";

const stableEdge = {
  url: "https://roadie.example.test/",
  versionUrl: "https://roadie.example.test/__zephyr/v1/v/release-key",
};

test("accepts an exact path-addressed immutable version route", () => {
  assert.equal(
    stableVersionArtifactBase(stableEdge).toString(),
    "https://roadie.example.test/__zephyr/v1/v/release-key/",
  );
});

test("rejects extra immutable version route segments", () => {
  assert.throws(
    () =>
      stableVersionArtifactBase({
        ...stableEdge,
        versionUrl: `${stableEdge.versionUrl}/unexpected`,
      }),
    /must not contain extra segments/u,
  );
});
