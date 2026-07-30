#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import {
  createTapAppReleaseEnvelope,
  mediaTypeForArtifact,
} from "./tap-app-release-envelope.mjs";

const appRoot = path.resolve(process.argv[2] ?? ".");
const outputRoot = path.join(appRoot, "dist");
const descriptorPath = path.join(outputRoot, "manifest.tap.json");
const deployment = {
  application: "tap-roadie",
  organization: "zephyrcloudio",
  project: "tap-miniapp-examples",
};
const expectedApplicationUid = [
  deployment.application,
  deployment.project,
  deployment.organization,
].join(".");
const accessToken = process.env.ZE_ACCESS_TOKEN;
assert.ok(
  accessToken,
  "ZE_ACCESS_TOKEN is required to submit the authenticated TAP publish-success receipt.",
);
const normalizePath = (value) => value.split(path.sep).join(path.posix.sep);

const requireFromApp = createRequire(path.join(appRoot, "package.json"));
const { z } = requireFromApp("zod");
const agent = requireFromApp("zephyr-agent");
for (const name of [
  "ZephyrEngine",
  "assertZephyrBuildTarget",
  "buildAssetsMap",
  "getZephyrConfig",
  "readDirRecursiveWithContents",
  "zeBuildDashData",
]) {
  assert.equal(
    typeof agent[name],
    "function",
    `Installed zephyr-agent is missing ${name}.`,
  );
}
agent.assertZephyrBuildTarget("tap-app", "assembled TAP package publisher");

const descriptorBytes = await fs.readFile(descriptorPath);
const descriptor = JSON.parse(descriptorBytes.toString("utf8"));
assert.equal(descriptor?.descriptorVersion, 1, "dist must contain a TAP descriptor.");
assert.equal(
  JSON.stringify(descriptor).includes('"pending"'),
  false,
  "Assemble the TAP package before publishing.",
);
const targets = Object.entries(descriptor.targets ?? {});
assert.ok(targets.length > 0, "Assembled TAP package must contain a target.");
for (const [targetName, target] of targets) {
  for (const artifact of [target.remoteEntry, target.assetLock, target.manifest]) {
    assert.ok(
      artifact.startsWith(`targets/${targetName}/`),
      `${targetName} artifact must be target-scoped.`,
    );
    assert.ok((await fs.stat(path.join(outputRoot, artifact))).isFile());
  }
}

const files = await agent.readDirRecursiveWithContents(outputRoot);
const assets = {};
for (const file of files) {
  const relativePath = normalizePath(file.relativePath);
  assert.ok(
    relativePath.length > 0 &&
      !relativePath.startsWith("../") &&
      !path.posix.isAbsolute(relativePath),
    `Output asset ${relativePath} escapes dist.`,
  );
  assert.equal(relativePath.endsWith(".map"), false, "Source maps cannot be published.");
  assets[relativePath] = {
    content: file.content,
    type: mediaTypeForArtifact(relativePath),
  };
}
const assetsMap = agent.buildAssetsMap(
  assets,
  (asset) => asset.content,
  (asset) => asset.type,
);
const federation = targets.map(([, target]) => ({
  name: target.remoteName,
  remote: target.remoteEntry,
  mf_manifest: target.manifest,
  library_type: target.libraryType,
  exposes: target.exposes,
}));
const mfConfigs = targets.map(([, target]) => ({
  name: target.remoteName,
  filename: target.remoteEntry,
  library: { type: target.libraryType },
  manifest: {
    filePath: path.posix.dirname(target.manifest),
    fileName: path.posix.basename(target.manifest),
  },
  exposes: target.exposes,
}));

const zephyrConfig = agent.getZephyrConfig(appRoot);
assert.deepEqual(
  {
    application: zephyrConfig.appName,
    organization: zephyrConfig.org,
    project: zephyrConfig.project,
  },
  deployment,
  "Zephyr configuration does not match Roadie's canonical deployment.",
);
const engine = await agent.ZephyrEngine.create({
  builder: "unknown",
  context: appRoot,
  target: "tap-app",
});
assert.equal(engine.application_uid, expectedApplicationUid, "Zephyr identity drifted.");
assert.equal(engine.env?.target, "tap-app", "Zephyr discarded the TAP build target.");
engine.buildProperties = { output: outputRoot };

await engine.start_new_build();
try {
  const buildStats = {
    ...(await agent.zeBuildDashData(engine)),
    build_target: "tap-app",
    federation,
    remote: undefined,
    mf_manifest: undefined,
    library_type: undefined,
  };
  buildStats.tapAppRelease = createTapAppReleaseEnvelope({
    assetsMap,
    buildStats,
    deployment,
    descriptor,
    descriptorBytes,
    expectedApplicationUid,
  });
  let deploymentInfo;
  await engine.upload_assets({
    assetsMap,
    buildStats,
    mfConfigs,
    hooks: {
      onDeployComplete(info) {
        deploymentInfo = info;
      },
    },
  });
  assert.ok(deploymentInfo, "Zephyr did not return deployment information.");
  const serializedBuildStats = JSON.stringify(buildStats);
  const idempotencyKey = createHash("sha256")
    .update(`${buildStats.id}\0${buildStats.app.buildId}`)
    .digest("hex");
  const buildStatsResponse = await fetch(
    new URL(
      "/v2/builder-packages-api/upload-from-dashboard-plugin",
      process.env.ZE_API ?? "https://api.zephyr-cloud.io",
    ),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: serializedBuildStats,
    },
  );
  assert.ok(
    buildStatsResponse.ok,
    `Zephyr rejected the idempotent build-stats receipt lookup with HTTP ${buildStatsResponse.status}.`,
  );
  const buildStatsResult = z
    .object({
      tapAppPublishReceipt: z
        .object({ releaseDigest: z.string().min(1) })
        .optional(),
      value: z
        .object({
          tapAppPublishReceipt: z.object({ releaseDigest: z.string().min(1) }),
        })
        .optional(),
    })
    .passthrough()
    .parse(await buildStatsResponse.json());
  const releaseDigest =
    buildStatsResult.tapAppPublishReceipt?.releaseDigest ??
    buildStatsResult.value?.tapAppPublishReceipt.releaseDigest;
  assert.ok(
    releaseDigest,
    "Zephyr build-stats response omitted the server-derived TAP release digest.",
  );
  const receiptResponse = await fetch(
    "https://api.zephyr-cloud.io/v2/builder-packages-api/tap-app-publish-success",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        applicationUid: expectedApplicationUid,
        snapshotId: deploymentInfo.snapshotId,
        releaseDigest,
      }),
    },
  );
  if (!receiptResponse.ok) {
    const receiptError = (await receiptResponse.text()).slice(0, 500);
    throw new Error(
      `Zephyr rejected the TAP publish-success receipt with HTTP ${receiptResponse.status}: ${receiptError}`,
    );
  }
  await engine.build_finished();
} catch (error) {
  if (engine.hasActiveBuild) engine.build_failed();
  throw error;
}

console.log(`published ${expectedApplicationUid} as an assembled TAP app`);
