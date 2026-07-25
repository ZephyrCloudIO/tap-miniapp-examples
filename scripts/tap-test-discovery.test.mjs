import assert from "node:assert/strict";
import test from "node:test";

import { parseRstestListJson } from "./tap-test-discovery.mjs";

test("parses the pinned Rstest case inventory", () => {
  assert.deepEqual(
    parseRstestListJson(
      JSON.stringify([
        {
          file: "/workspace/tests/e2e/surface.test.ts",
          name: "mounts the surface",
          type: "case",
        },
      ]),
    ),
    [
      {
        file: "/workspace/tests/e2e/surface.test.ts",
        name: "mounts the surface",
        type: "case",
      },
    ],
  );
});

test("fails closed on shape drift, non-cases, and duplicate identities", () => {
  for (const value of [
    {},
    [{ file: "surface.test.ts", name: "mounts", type: "suite" }],
    [{ file: "surface.test.ts", name: "mounts", type: "case", extra: true }],
    [
      { file: "surface.test.ts", name: "mounts", type: "case" },
      { file: "surface.test.ts", name: "mounts", type: "case" },
    ],
  ]) {
    assert.throws(
      () => parseRstestListJson(JSON.stringify(value)),
      /array|exactly|duplicate|type/u,
    );
  }
});

test("rejects malformed JSON rather than reporting an empty suite", () => {
  assert.throws(
    () => parseRstestListJson("{"),
    /did not emit valid JSON/u,
  );
});
