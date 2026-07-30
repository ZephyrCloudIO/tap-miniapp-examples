import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u;
const NAMESPACE_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/u;
const PATH_ROUTE_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const TAP_TARGETS = new Set([
  "desktop",
  "mobile",
  "node",
  "quickjs",
  "worker",
  "workflow-host",
]);
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
});

const nonEmptyString = (value, label) => {
  assert.equal(typeof value, "string", `${label} must be a string.`);
  assert.ok(value.length > 0, `${label} cannot be empty.`);
  return value;
};

const plainObject = (value, label) => {
  assert.ok(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object.`,
  );
  return value;
};

const canonicalArtifactId = (value, label) => {
  nonEmptyString(value, label);
  assert.match(value, ARTIFACT_ID_PATTERN, `${label} must be a canonical artifact path.`);
  assert.ok(
    value
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== ".."),
    `${label} cannot contain empty or traversal segments.`,
  );
  assert.equal(path.posix.normalize(value), value, `${label} must already be normalized.`);
  return value;
};

const assetBuffer = (asset, label) => {
  if (Buffer.isBuffer(asset.buffer)) return asset.buffer;
  if (typeof asset.buffer === "string") return Buffer.from(asset.buffer, "utf8");
  throw new TypeError(`${label} must contain a Buffer or string.`);
};

const sha256Integrity = (value) =>
  `sha256-${createHash("sha256").update(value).digest("base64")}`;

const canonicalizeJsonValue = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "TAP graph locks require finite JSON numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJsonValue).join(",")}]`;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("TAP graph locks require JSON values.");
};

export const mediaTypeForArtifact = (artifactId) =>
  CONTENT_TYPES[path.posix.extname(artifactId).toLowerCase()] ??
  "application/octet-stream";

const organizationNamespace = (deployment, descriptor) => {
  const organization = nonEmptyString(
    deployment.organization,
    "deployment organization",
  ).toLowerCase();
  const declared = nonEmptyString(
    descriptor?.package?.namespace,
    "descriptor package namespace",
  ).toLowerCase();
  const namespace =
    declared === organization || declared.startsWith(`${organization}.`)
      ? declared
      : `${organization}.${declared}`;
  assert.match(namespace, NAMESPACE_PATTERN, "TAP namespace must be DNS-style text.");
  return namespace;
};

const parseCredentialFreeHttpsUrl = (value, label) => {
  const url = new URL(nonEmptyString(value, label));
  assert.equal(url.protocol, "https:", `${label} must use HTTPS.`);
  assert.equal(url.username, "", `${label} cannot contain credentials.`);
  assert.equal(url.password, "", `${label} cannot contain credentials.`);
  assert.equal(url.search, "", `${label} cannot contain query state.`);
  assert.equal(url.hash, "", `${label} cannot contain fragment state.`);
  return url;
};

const stableVersionArtifactBase = (edge) => {
  const stableEdgeUrl = parseCredentialFreeHttpsUrl(
    edge?.url,
    "Zephyr stable edge origin",
  );
  assert.equal(stableEdgeUrl.pathname, "/", "Zephyr stable edge URL must be an origin.");
  const immutableVersionUrl = parseCredentialFreeHttpsUrl(
    edge?.versionUrl,
    "Zephyr immutable version route",
  );
  const [, marker, routeVersion, routeType, existingRouteKey] =
    immutableVersionUrl.pathname.split("/");
  if (marker === "__zephyr" && routeVersion === "v1" && routeType === "v") {
    assert.match(existingRouteKey, PATH_ROUTE_KEY_PATTERN, "Invalid version route key.");
    return new URL(
      `/__zephyr/v1/v/${encodeURIComponent(existingRouteKey)}/`,
      stableEdgeUrl.origin,
    );
  }
  const delimiter = typeof edge?.delimiter === "string" ? edge.delimiter : "-";
  const suffix = `${delimiter}${stableEdgeUrl.hostname.toLowerCase()}`;
  const versionHostname = immutableVersionUrl.hostname.toLowerCase();
  assert.ok(
    versionHostname.endsWith(suffix),
    "Immutable version hostname must match the stable Zephyr origin.",
  );
  const routeKey = versionHostname.slice(0, -suffix.length);
  assert.match(routeKey, PATH_ROUTE_KEY_PATTERN, "Invalid immutable version route key.");
  return new URL(
    `/__zephyr/v1/v/${encodeURIComponent(routeKey)}/`,
    stableEdgeUrl.origin,
  );
};

const sourceUrlFor = (base, artifactId) =>
  new URL(
    artifactId.split("/").map(encodeURIComponent).join("/"),
    base,
  ).toString();

const collectArtifactLocks = (assetsMap, descriptorBytes) => {
  const assetsByPath = new Map();
  for (const asset of Object.values(plainObject(assetsMap, "Zephyr assets map"))) {
    const id = canonicalArtifactId(asset?.path, "Zephyr asset path");
    assert.equal(assetsByPath.has(id), false, `Duplicate Zephyr asset ${id}.`);
    const buffer = assetBuffer(asset, `Zephyr asset ${id}`);
    assert.equal(asset.size, buffer.byteLength, `Zephyr asset ${id} size drifted.`);
    assert.ok(buffer.byteLength > 0, `Zephyr asset ${id} cannot be empty.`);
    assert.ok(
      buffer.byteLength <= MAX_ARTIFACT_BYTES,
      `Zephyr asset ${id} exceeds the TAP size limit.`,
    );
    assetsByPath.set(id, {
      buffer,
      lock: {
        id,
        integrity: sha256Integrity(buffer),
        byteLength: buffer.byteLength,
        contentType: mediaTypeForArtifact(id),
      },
    });
  }
  const emittedDescriptor = assetsByPath.get("manifest.tap.json");
  assert.ok(emittedDescriptor, "Zephyr assets must contain manifest.tap.json.");
  assert.ok(
    emittedDescriptor.buffer.equals(descriptorBytes),
    "Descriptor bytes drifted before publication.",
  );
  assetsByPath.delete("manifest.tap.json");
  assert.ok(assetsByPath.size > 0, "TAP release must contain artifacts.");
  return assetsByPath;
};

const targetClosure = ({ assetsByPath, target, targetName }) => {
  const assetLockId = canonicalArtifactId(target.assetLock, `${targetName} asset lock`);
  const lockAsset = assetsByPath.get(assetLockId);
  assert.ok(lockAsset, `${targetName} asset lock was not uploaded.`);
  const assetLock = JSON.parse(lockAsset.buffer.toString("utf8"));
  assert.equal(assetLock.target, targetName, `${targetName} asset lock target drifted.`);
  const lockedAssets = plainObject(assetLock.assets, `${targetName} locked assets`);
  const closure = new Set([assetLockId]);
  for (const [rawId, rawLock] of Object.entries(lockedAssets)) {
    const id = canonicalArtifactId(rawId, `${targetName} locked asset`);
    const artifact = assetsByPath.get(id);
    assert.ok(artifact, `${targetName} locked asset ${id} was not uploaded.`);
    assert.equal(rawLock.bytes, artifact.lock.byteLength, `${id} size drifted.`);
    assert.equal(rawLock.integrity, artifact.lock.integrity, `${id} integrity drifted.`);
    closure.add(id);
  }
  for (const id of assetsByPath.keys()) {
    if (id.startsWith(`targets/${targetName}/`)) closure.add(id);
  }
  return [...closure].sort();
};

const collectTargetMetadata = (descriptor, assetsByPath) => {
  const targets = Object.entries(
    plainObject(descriptor.targets, "TAP descriptor targets"),
  ).sort(([left], [right]) => left.localeCompare(right));
  assert.ok(targets.length > 0, "TAP release must declare a target.");
  return targets.map(([targetName, target]) => {
    assert.ok(TAP_TARGETS.has(targetName), `Unsupported TAP target ${targetName}.`);
    const remoteEntryArtifactId = canonicalArtifactId(
      target.remoteEntry,
      `${targetName} remote entry`,
    );
    const remoteEntry = assetsByPath.get(remoteEntryArtifactId);
    assert.ok(remoteEntry, `${targetName} remote entry was not uploaded.`);
    assert.equal(
      target.remoteEntryIntegrity,
      remoteEntry.lock.integrity,
      `${targetName} remote integrity drifted.`,
    );
    const exposes = Object.keys(
      plainObject(target.exposes, `${targetName} exposes`),
    ).sort();
    assert.ok(exposes.length > 0, `${targetName} must expose a module.`);
    return {
      target: targetName,
      remoteEntryArtifactId,
      remoteEntryIntegrity: remoteEntry.lock.integrity,
      exposes,
      artifactIds: targetClosure({ assetsByPath, target, targetName }),
      readiness: "ready",
    };
  });
};

export const createTapAppReleaseEnvelope = ({
  assetsMap,
  buildStats,
  deployment,
  descriptor,
  descriptorBytes,
  expectedApplicationUid,
}) => {
  assert.ok(Buffer.isBuffer(descriptorBytes), "Finalized descriptor bytes are required.");
  assert.ok(
    descriptorBytes.byteLength >= 2 &&
      descriptorBytes.byteLength <= MAX_DESCRIPTOR_BYTES,
    "Descriptor exceeds the TAP size limit.",
  );
  assert.ok(
    isDeepStrictEqual(JSON.parse(descriptorBytes.toString("utf8")), descriptor),
    "Parsed descriptor and descriptor bytes disagree.",
  );
  assert.equal(buildStats?.build_target, "tap-app", "TAP release target drifted.");
  assert.equal(buildStats?.id, expectedApplicationUid, "Application UID drifted.");
  assert.deepEqual(
    {
      application: buildStats?.app?.name,
      organization: buildStats?.app?.org,
      project: buildStats?.app?.project,
    },
    deployment,
    "TAP release coordinates drifted.",
  );
  const snapshotId = nonEmptyString(buildStats?.version, "TAP snapshot ID");
  const assetsByPath = collectArtifactLocks(assetsMap, descriptorBytes);
  const targetVariants = collectTargetMetadata(descriptor, assetsByPath);
  const artifactLocks = [...assetsByPath.values()]
    .map(({ lock }) => lock)
    .sort(({ id: left }, { id: right }) => left.localeCompare(right));
  const graphLock = {
    schemaVersion: 1,
    release: { applicationUid: expectedApplicationUid, snapshotId },
    artifacts: artifactLocks.map(({ id, integrity }) => ({ id, integrity })),
    targets: targetVariants.map((variant) => ({
      target: variant.target,
      remoteEntryArtifactId: variant.remoteEntryArtifactId,
      remoteEntryIntegrity: variant.remoteEntryIntegrity,
    })),
    dependencies: [],
  };
  const fixedEnvelope = {
    namespace: organizationNamespace(deployment, descriptor),
    descriptor: {
      content: descriptorBytes.toString("utf8"),
      integrity: sha256Integrity(descriptorBytes),
    },
    graphLock,
    graphIntegrity: sha256Integrity(canonicalizeJsonValue(graphLock)),
    targetVariants,
    children: [],
  };
  const carrier = Object.create(null);
  Object.defineProperty(carrier, "toJSON", {
    configurable: false,
    enumerable: false,
    writable: false,
    value() {
      const base = stableVersionArtifactBase(buildStats.edge);
      return {
        ...fixedEnvelope,
        artifacts: artifactLocks.map((artifact) => ({
          id: artifact.id,
          sourceUrl: sourceUrlFor(base, artifact.id),
          integrity: artifact.integrity,
          byteLength: artifact.byteLength,
          contentType: artifact.contentType,
        })),
      };
    },
  });
  return Object.freeze(carrier);
};
