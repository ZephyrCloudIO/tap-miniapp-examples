import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CURRENT_HOST_INCOMPATIBLE_CONSENTS = new Set([
  "fresh-decision",
  "once",
]);
const AUTHORIZATION_ACTION_LISTS = ["allOf", "anyOf", "onDemand"];
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function findSourceManifests() {
  const appsRoot = path.join(repositoryRoot, "apps");
  return fs
    .readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsRoot, entry.name, "manifest.tap.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

function findIncompatibleAuthorizationReferences(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const actions = new Map(
    manifest.contributions
      .filter((contribution) => contribution.kind === "permission.catalog")
      .flatMap((contribution) => contribution.options.actions)
      .map((action) => [action.id, action]),
  );
  const failures = [];

  for (const contribution of manifest.contributions) {
    const authorization = contribution.authorization;
    if (!authorization) {
      continue;
    }

    for (const listName of AUTHORIZATION_ACTION_LISTS) {
      for (const actionId of authorization[listName] ?? []) {
        const action = actions.get(actionId);
        if (
          action &&
          CURRENT_HOST_INCOMPATIBLE_CONSENTS.has(action.consent)
        ) {
          failures.push(
            `${contribution.kind}:${contribution.id} references ` +
              `${actionId} (${action.consent}) via ${listName}`,
          );
        }
      }
    }
  }

  return failures;
}

test("source manifests use reusable consent for active governed actions", () => {
  const manifestPaths = findSourceManifests();
  assert.ok(manifestPaths.length > 0, "expected source TAP manifests");

  const failures = manifestPaths.flatMap((manifestPath) =>
    findIncompatibleAuthorizationReferences(manifestPath).map(
      (failure) =>
        `${path.relative(repositoryRoot, manifestPath)}: ${failure}`,
    ),
  );

  assert.deepEqual(
    failures,
    [],
    "The current host cannot honor once or fresh-decision grants for " +
      `contribution authorization:\n${failures.join("\n")}`,
  );
});
