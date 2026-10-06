import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverMiniapps, repositoryRoot, synchronizeReleaseVersions } from "./sync-release-versions.mjs";

const write = (root, file, contents) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`);
};
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

const fixtureApp = ({ release }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-release-versions-"));
  write(root, "package.json", { name: "fixture", version: "1.1.0" });
  write(root, "manifest.tap.json", {
    ...(release
      ? { package: { packageId: "tap_pkg_fixture" }, release: { releaseId: "tap_pkg_fixture@1.0.0", version: "1.0.0" } }
      : { versionLabel: "1.0.0" }),
    contributions: [
      { kind: "specialist", id: "helper", options: { manifest: "specialists/helper/1.0.0.json" } },
      { kind: "agent.skill", id: "triage", options: { files: ["SKILL.md"] } },
    ],
  });
  write(root, "specialists/helper/1.0.0.json", { name: "helper@1.0.0", version: "1.0.0" });
  write(root, "skills/triage/1.0.0/SKILL.md", "---\nname: triage\nversion: 1.0.0\n---\n");
  write(root, "src/helper.test.ts", 'import helper from "../specialists/helper/1.0.0.json";\n');
  return root;
};

for (const release of [true, false]) {
  test(`a bumped package version moves ${release ? "release" : "versionLabel"} metadata with it`, () => {
    const root = fixtureApp({ release });
    synchronizeReleaseVersions({ apps: [root] });

    const manifest = JSON.parse(read(root, "manifest.tap.json"));
    if (release) {
      assert.deepEqual(manifest.release, { releaseId: "tap_pkg_fixture@1.1.0", version: "1.1.0" });
    } else {
      assert.equal(manifest.versionLabel, "1.1.0");
    }
    assert.equal(manifest.contributions[0].options.manifest, "specialists/helper/1.1.0.json");
    assert.deepEqual(JSON.parse(read(root, "specialists/helper/1.1.0.json")), { name: "helper@1.1.0", version: "1.1.0" });
    assert.equal(fs.existsSync(path.join(root, "specialists/helper/1.0.0.json")), false);
    assert.match(read(root, "skills/triage/1.1.0/SKILL.md"), /^version: 1\.1\.0$/mu);
    assert.equal(fs.existsSync(path.join(root, "skills/triage/1.0.0")), false);
    assert.equal(read(root, "src/helper.test.ts"), 'import helper from "../specialists/helper/1.1.0.json";\n');

    assert.deepEqual(synchronizeReleaseVersions({ apps: [root], check: true }), []);
  });
}

test("check mode reports stale metadata without writing", () => {
  const root = fixtureApp({ release: true });
  assert.throws(() => synchronizeReleaseVersions({ apps: [root], check: true }), /Release metadata is stale/u);
  assert.equal(JSON.parse(read(root, "manifest.tap.json")).release.version, "1.0.0");
});

test("every miniapp's release metadata matches its package version", () => {
  assert.deepEqual(synchronizeReleaseVersions({ check: true }), []);
});

test("Release Please bumps every miniapp in lockstep with the root package", () => {
  const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "release-please-config.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, ".release-please-manifest.json"), "utf8"));
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(manifest["."], rootPackage.version);
  assert.deepEqual(
    config.packages["."]["extra-files"],
    discoverMiniapps().map((appRoot) => ({
      type: "json",
      path: `${path.relative(repositoryRoot, appRoot)}/package.json`,
      jsonpath: "$.version",
    })),
  );
});
