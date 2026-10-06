#!/usr/bin/env node

// Carries each miniapp's package.json version (which Release Please bumps in
// lockstep) into the TAP release metadata that repeats it: the manifest
// release (or versionLabel), versioned specialist files, versioned skill
// directories, and the sources that import them by path.
//
//   node scripts/sync-release-versions.mjs           rewrite stale metadata
//   node scripts/sync-release-versions.mjs --check   fail if any is stale

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(import.meta.dirname, "..");

const readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const skippedSourceDirectories = new Set([
  ".tap-build",
  ".tap-diagnostics",
  ".tap-package",
  ".turbo",
  "dist",
  "node_modules",
  "pkg",
  "skills",
  "specialists",
  "target",
]);
const sourceExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".mts", ".ts", ".tsx"]);

/** Every `apps/<id>` built by `tap-miniapp`, sorted by id. */
export const discoverMiniapps = (root = repositoryRoot) =>
  fs
    .readdirSync(path.join(root, "apps"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, "apps", entry.name))
    .filter((appRoot) => fs.existsSync(path.join(appRoot, "tap-miniapp.config.mjs")))
    .sort();

/** Replaces the only match of `pattern` in `source`, failing on zero or several. */
const replaceOnce = (source, pattern, replacement, label) => {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  assert.equal(matches.length, 1, `${label}: expected exactly one match, found ${matches.length}.`);
  const [match] = matches;
  return source.slice(0, match.index) + replacement(match) + source.slice(match.index + match[0].length);
};

const jsonString = (key, value) =>
  new RegExp(`("${escapeRegExp(key)}"\\s*:\\s*)"${escapeRegExp(value)}"`, "u");

const filesUnder = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return skippedSourceDirectories.has(entry.name) ? [] : filesUnder(filename);
    return entry.isFile() && sourceExtensions.has(path.extname(entry.name)) ? [filename] : [];
  });

/**
 * Returns the writes (and renames, via `from`) that bring one app's release
 * metadata up to its package.json version. Empty when already in sync.
 */
export const releaseUpdates = (appRoot) => {
  const app = path.basename(appRoot);
  const next = readJson(path.join(appRoot, "package.json")).version;
  const manifestPath = path.join(appRoot, "manifest.tap.json");
  const manifestSource = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestSource);
  const current = manifest.release?.version ?? manifest.versionLabel;
  assert.equal(typeof current, "string", `${app} manifest declares no release version.`);
  if (current === next) return [];

  const updates = [];
  const pathRenames = [];
  let manifestText = manifestSource;

  if (manifest.release) {
    const packageId = manifest.package?.packageId;
    manifestText = replaceOnce(
      manifestText,
      jsonString("releaseId", `${packageId}@${current}`),
      (match) => `${match[1]}"${packageId}@${next}"`,
      `${app} release.releaseId`,
    );
    manifestText = replaceOnce(
      manifestText,
      jsonString("version", current),
      (match) => `${match[1]}"${next}"`,
      `${app} release.version`,
    );
  } else {
    manifestText = replaceOnce(
      manifestText,
      jsonString("versionLabel", current),
      (match) => `${match[1]}"${next}"`,
      `${app} versionLabel`,
    );
  }

  for (const contribution of manifest.contributions ?? []) {
    if (contribution.kind === "specialist") {
      const from = `specialists/${contribution.id}/${current}.json`;
      const to = `specialists/${contribution.id}/${next}.json`;
      assert.equal(contribution.options?.manifest, from, `${app} ${contribution.id} must point at ${from}.`);
      let specialist = fs.readFileSync(path.join(appRoot, from), "utf8");
      specialist = replaceOnce(specialist, jsonString("version", current), (match) => `${match[1]}"${next}"`, `${app} ${from} version`);
      specialist = replaceOnce(
        specialist,
        jsonString("name", `${contribution.id}@${current}`),
        (match) => `${match[1]}"${contribution.id}@${next}"`,
        `${app} ${from} name`,
      );
      updates.push({ from: path.join(appRoot, from), filename: path.join(appRoot, to), contents: specialist });
      pathRenames.push([from, to]);
    }
    if (contribution.kind === "agent.skill") {
      const from = `skills/${contribution.id}/${current}`;
      const to = `skills/${contribution.id}/${next}`;
      const skillPath = path.join(appRoot, from, "SKILL.md");
      assert.ok(fs.existsSync(skillPath), `${app} skill ${contribution.id} is missing ${from}/SKILL.md.`);
      const skill = replaceOnce(
        fs.readFileSync(skillPath, "utf8"),
        new RegExp(`^(version:\\s*)${escapeRegExp(current)}$`, "mu"),
        (match) => `${match[1]}${next}`,
        `${app} ${from}/SKILL.md version`,
      );
      updates.push({ from: path.join(appRoot, from), filename: path.join(appRoot, to), contents: skill, file: "SKILL.md" });
      pathRenames.push([`${from}/`, `${to}/`]);
    }
  }

  for (const [from, to] of pathRenames) manifestText = manifestText.split(`"${from}`).join(`"${to}`);
  updates.push({ filename: manifestPath, contents: manifestText });

  // Sources that import a specialist or skill by its versioned path.
  for (const filename of filesUnder(appRoot)) {
    if (filename === manifestPath || path.basename(filename) === "package.json") continue;
    const source = fs.readFileSync(filename, "utf8");
    let contents = source;
    for (const [from, to] of pathRenames) contents = contents.split(from).join(to);
    if (contents !== source) updates.push({ filename, contents });
  }
  return updates;
};

const applyUpdate = ({ from, filename, contents, file }) => {
  if (from) {
    assert.equal(fs.existsSync(filename), false, `${filename} already exists.`);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.renameSync(from, filename);
  }
  fs.writeFileSync(file ? path.join(filename, file) : filename, contents);
};

export const synchronizeReleaseVersions = ({ check = false, apps = discoverMiniapps() } = {}) => {
  const updates = apps.flatMap(releaseUpdates);
  if (check) {
    assert.deepEqual(
      updates.map(({ filename }) => path.relative(repositoryRoot, filename)),
      [],
      "Release metadata is stale. Run `pnpm release:sync` after changing package versions.",
    );
  } else {
    updates.forEach(applyUpdate);
  }
  return updates;
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--check"), "Usage: sync-release-versions.mjs [--check]");
  const check = args[0] === "--check";
  const updates = synchronizeReleaseVersions({ check });
  console.log(
    check
      ? "release versions: package, TAP manifest, specialist, and skill metadata agree."
      : `release versions: synchronized ${updates.length} file(s).`,
  );
}
