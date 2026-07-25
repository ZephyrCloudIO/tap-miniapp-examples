import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeTapTestSource,
  assertTapDiscoveryMatchesSource,
  TAP_RSTEST_ADAPTER,
} from "./tap-test-policy.mjs";

const validSource = `
import { expect, test } from "${TAP_RSTEST_ADAPTER}";

test("mounts the surface", async ({ surface }) => {
  await expect(surface.locator("body")).toBeVisible();
});
`;

test("accepts direct cases from the canonical Test Lab adapter", () => {
  assert.deepEqual(analyzeTapTestSource("surface.test.ts", validSource), {
    declaredCaseCount: 1,
  });
  assert.doesNotThrow(() =>
    assertTapDiscoveryMatchesSource("surface.test.ts", 1, 1),
  );
  assert.deepEqual(
    analyzeTapTestSource(
      "grouped.test.ts",
      `import { describe, test } from "${TAP_RSTEST_ADAPTER}";\n` +
        `describe("surface", () => { test("mounts", () => {}); });`,
    ),
    { declaredCaseCount: 1 },
  );
});

test("requires exactly one canonical unaliased test import", () => {
  for (const source of [
    `import { test } from "@rstest/core"; test("raw", () => {});`,
    `import { test as tapTest } from "${TAP_RSTEST_ADAPTER}"; tapTest("alias", () => {});`,
    `import * as tap from "${TAP_RSTEST_ADAPTER}"; tap.test("namespace", () => {});`,
    `${validSource}\nimport { expect as adapterExpect } from "${TAP_RSTEST_ADAPTER}";`,
  ]) {
    assert.throws(
      () => analyzeTapTestSource("invalid-import.test.ts", source),
      /canonical|exactly one|unaliased|Aliasing|Import Test Lab APIs/u,
    );
  }
});

test("rejects focused, skipped, conditional, and aliased cases", () => {
  for (const member of [
    "concurrent",
    "fails",
    "fixme",
    "only",
    "runIf",
    "skip",
    "skipIf",
    "todo",
  ]) {
    const argument = member === "runIf" || member === "skipIf" ? "(false)" : "";
    assert.throws(
      () =>
        analyzeTapTestSource(
          `${member}.test.ts`,
          `import { test } from "${TAP_RSTEST_ADAPTER}";\n` +
            `test.${member}${argument}("hidden", () => {});`,
        ),
      /member APIs are forbidden/u,
    );
  }

  for (const expression of [
    `const tapTest = test; tapTest("alias", () => {});`,
    `const { only: focused } = test; focused("alias", () => {});`,
    `test["skip"]("computed", () => {});`,
    `test?.only("optional", () => {});`,
  ]) {
    assert.throws(
      () =>
        analyzeTapTestSource(
          "aliased.test.ts",
          `import { test } from "${TAP_RSTEST_ADAPTER}";\n${expression}`,
        ),
      /Aliasing|member APIs are forbidden/u,
    );
  }
});

test("rejects direct runner calls without canonical bindings", () => {
  assert.throws(
    () =>
      analyzeTapTestSource(
        "global-describe.test.ts",
        `import { test } from "${TAP_RSTEST_ADAPTER}";\n` +
          `describe("global", () => { test("visible", () => {}); });`,
      ),
    /Call describe.*only through an unaliased/u,
  );
});

test("rejects discovery drift in either direction", () => {
  assert.throws(
    () => assertTapDiscoveryMatchesSource("surface.test.ts", 1, 2),
    /Rstest discovered 2/u,
  );
  assert.throws(
    () => assertTapDiscoveryMatchesSource("surface.test.ts", 2, 1),
    /declares 2/u,
  );
});
