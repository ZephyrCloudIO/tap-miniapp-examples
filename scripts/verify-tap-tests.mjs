#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseRstestListJson } from "./tap-test-discovery.mjs";
import {
  analyzeTapTestSource,
  assertTapDiscoveryMatchesSource,
} from "./tap-test-policy.mjs";
import {
  collectTapTestFiles,
  resolveInstalledTapCli,
} from "./tap-test-runtime.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appsRoot = path.join(repositoryRoot, "apps");
const expectedSdkVersion = "0.4.2";
const expectedRstestVersion = "0.11.3";
const expectedPlaywrightVersion = "^1.61.0";
const expectedTypecheckCommand =
  "tsc --project ./tsconfig.tap-test.json --noEmit";
const cliOverrideValue = process.env.TAP_MINIAPP_TEST_CLI?.trim();
const cliOverride = cliOverrideValue
  ? path.resolve(repositoryRoot, cliOverrideValue)
  : undefined;
const requestedApps = new Set(
  (process.env.TAP_MINIAPP_TEST_APPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const errors = [];

const check = (condition, message) => {
  if (!condition) errors.push(message);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const inside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const globToRegExp = (pattern) => {
  const confined = pattern.replace(/^\.\//u, "");
  let source = "^";
  for (let index = 0; index < confined.length; index += 1) {
    const character = confined[index];
    if (character === "*") {
      if (confined[index + 1] === "*") {
        index += 1;
        if (confined[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    if (character === "[") {
      const closing = confined.indexOf("]", index + 1);
      if (closing === -1) throw new Error(`Invalid testMatch glob: ${pattern}`);
      const body = confined.slice(index + 1, closing);
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
      index = closing;
      continue;
    }
    if (character === "{") {
      const closing = confined.indexOf("}", index + 1);
      if (closing === -1) throw new Error(`Invalid testMatch glob: ${pattern}`);
      const alternatives = confined.slice(index + 1, closing).split(",");
      source += `(?:${alternatives.join("|")})`;
      index = closing;
      continue;
    }
    source += /[\\^$+.()|{}]/u.test(character)
      ? `\\${character}`
      : character;
  }
  return new RegExp(`${source}$`, "u");
};

const runJsonCommand = (label, command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  let value;
  try {
    value = JSON.parse(result.stdout ?? "");
  } catch (error) {
    errors.push(
      `${label} did not emit one JSON document: ${
        error instanceof Error ? error.message : String(error)
      }\n${result.error?.message || result.stderr || result.stdout}`,
    );
    return undefined;
  }
  if (result.status !== 0 || value?.ok !== true) {
    errors.push(
      `${label} failed.\n${JSON.stringify(value, null, 2)}\n${
        result.error?.message || result.stderr || ""
      }`,
    );
    return undefined;
  }
  return value;
};

const runTapCli = (
  appDirectory,
  appName,
  installedCli,
  command,
  extraArgs = [],
) => {
  const args = [command, "--root", ".", ...extraArgs, "--json"];
  return runJsonCommand(
    `apps/${appName}: tap-miniapp-test ${command}`,
    process.execPath,
    [installedCli, ...args],
    { cwd: appDirectory },
  );
};

const rootPackageJson = readJson(path.join(repositoryRoot, "package.json"));
check(
  rootPackageJson.scripts?.["typecheck:tap"] ===
    "turbo run typecheck:tap --filter=./apps/*",
  "Root package.json must expose the canonical typecheck:tap command.",
);

const appDirectories = fs
  .readdirSync(appsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const manifestApps = appDirectories.filter((appName) =>
  fs.existsSync(path.join(appsRoot, appName, "manifest.tap.json")),
);
const descriptorApps = appDirectories.filter((appName) =>
  fs.existsSync(path.join(appsRoot, appName, "tap.test.json")),
);

check(manifestApps.length > 0, "No descriptor-backed apps were found.");
check(
  manifestApps.every((appName) => descriptorApps.includes(appName)),
  `Descriptor-backed apps missing tap.test.json: ${manifestApps
    .filter((appName) => !descriptorApps.includes(appName))
    .join(", ")}.`,
);
check(
  descriptorApps.every((appName) => manifestApps.includes(appName)),
  `Apps with tap.test.json but no manifest.tap.json: ${descriptorApps
    .filter((appName) => !manifestApps.includes(appName))
    .join(", ")}.`,
);
for (const requestedApp of requestedApps) {
  check(
    manifestApps.includes(requestedApp),
    `TAP_MINIAPP_TEST_APPS names unknown app ${requestedApp}.`,
  );
}
const selectedApps =
  requestedApps.size === 0
    ? manifestApps
    : manifestApps.filter((appName) => requestedApps.has(appName));

let totalCases = 0;
let totalCells = 0;
let totalRows = 0;

for (const appName of selectedApps.filter((candidate) =>
  descriptorApps.includes(candidate),
)) {
  const appDirectory = path.join(appsRoot, appName);
  const label = `apps/${appName}`;
  try {
    const descriptor = readJson(path.join(appDirectory, "tap.test.json"));
    const manifest = readJson(path.join(appDirectory, "manifest.tap.json"));
    const packageJson = readJson(path.join(appDirectory, "package.json"));
    const installedSdkPackagePath = path.join(
      appDirectory,
      "node_modules",
      "@theaiplatform",
      "miniapp-sdk",
      "package.json",
    );
    const tapTsconfigPath = path.join(appDirectory, "tsconfig.tap-test.json");
    const baseTsconfig = readJson(path.join(appDirectory, "tsconfig.json"));

    check(
      descriptor.schemaVersion === 2,
      `${label}: tap.test.json schemaVersion must be 2.`,
    );
    check(
      descriptor.packageId === manifest.package?.packageId,
      `${label}: descriptor packageId must match manifest.package.packageId.`,
    );

    const sdkVersions = [
      packageJson.dependencies?.["@theaiplatform/miniapp-sdk"],
      packageJson.devDependencies?.["@theaiplatform/miniapp-sdk"],
      packageJson.optionalDependencies?.["@theaiplatform/miniapp-sdk"],
      packageJson.peerDependencies?.["@theaiplatform/miniapp-sdk"],
    ].filter((value) => value !== undefined);
    check(
      sdkVersions.length === 1 && sdkVersions[0] === expectedSdkVersion,
      `${label}: @theaiplatform/miniapp-sdk must appear once and be exactly ${expectedSdkVersion}.`,
    );
    check(
      manifest.compatibility?.tapSdk === expectedSdkVersion,
      `${label}: manifest compatibility.tapSdk must be exactly ${expectedSdkVersion}.`,
    );
    check(
      fs.existsSync(installedSdkPackagePath),
      `${label}: installed SDK package metadata is missing.`,
    );
    if (fs.existsSync(installedSdkPackagePath)) {
      const installedSdkPackage = readJson(installedSdkPackagePath);
      check(
        installedSdkPackage.version === expectedSdkVersion,
        `${label}: installed SDK must be exactly ${expectedSdkVersion}.`,
      );
      check(
        installedSdkPackage.tapMiniappTestAdapterProtocol === 1,
        `${label}: installed SDK must declare Test Lab adapter protocol 1.`,
      );
    }
    check(
      packageJson.devDependencies?.["@rstest/core"] === expectedRstestVersion,
      `${label}: @rstest/core must be exactly ${expectedRstestVersion}.`,
    );
    check(
      packageJson.devDependencies?.["@rstest/playwright"] ===
        expectedRstestVersion,
      `${label}: @rstest/playwright must be exactly ${expectedRstestVersion}.`,
    );
    check(
      packageJson.devDependencies?.playwright === expectedPlaywrightVersion,
      `${label}: Playwright must use ${expectedPlaywrightVersion}.`,
    );

    const configPath =
      typeof descriptor.configPath === "string" ? descriptor.configPath : "";
    check(configPath.length > 0, `${label}: descriptor configPath is required.`);
    check(
      packageJson.scripts?.["test:tap"] ===
        `rstest run --config ./${configPath}`,
      `${label}: test:tap must run the descriptor configPath.`,
    );
    check(
      packageJson.scripts?.["test:tap:list"] ===
        `rstest list --config ./${configPath}`,
      `${label}: test:tap:list must expose credential-free discovery.`,
    );
    check(
      packageJson.scripts?.["typecheck:tap"] === expectedTypecheckCommand,
      `${label}: typecheck:tap must use tsconfig.tap-test.json.`,
    );
    check(
      fs.existsSync(tapTsconfigPath),
      `${label}: tsconfig.tap-test.json is missing.`,
    );
    if (fs.existsSync(tapTsconfigPath)) {
      const tapTsconfig = readJson(tapTsconfigPath);
      check(
        tapTsconfig.extends === "./tsconfig.json",
        `${label}: TAP tsconfig must extend tsconfig.json.`,
      );
      check(
        tapTsconfig.compilerOptions?.incremental === true &&
          tapTsconfig.compilerOptions?.noEmit === true,
        `${label}: TAP tsconfig must be incremental and noEmit.`,
      );
      check(
        tapTsconfig.compilerOptions?.tsBuildInfoFile ===
          ".turbo/typecheck.tap.tsbuildinfo",
        `${label}: TAP tsconfig must use the isolated TAP build-info path.`,
      );
    }
    const broadBaseTestInclude = (baseTsconfig.include ?? []).some(
      (entry) =>
        entry.startsWith("tests/**") ||
        entry.startsWith("./**") ||
        entry.startsWith("**"),
    );
    if (broadBaseTestInclude) {
      check(
        (baseTsconfig.exclude ?? []).some((entry) =>
          entry
            .replaceAll("\\", "/")
            .replace(/^\.\//u, "")
            .startsWith("tests/e2e"),
        ),
        `${label}: ordinary tsconfig must exclude tests/e2e.`,
      );
    }

    const installedCli = cliOverride ?? resolveInstalledTapCli(appDirectory);
    const doctor = runTapCli(
      appDirectory,
      appName,
      installedCli,
      "doctor",
    );
    const inventory = runTapCli(
      appDirectory,
      appName,
      installedCli,
      "list",
    );
    const matrix = runTapCli(
      appDirectory,
      appName,
      installedCli,
      "matrix",
    );
    runTapCli(appDirectory, appName, installedCli, "scaffold", ["--check"]);
    if (!doctor || !inventory || !matrix) continue;

    check(
      doctor.sdkVersion === expectedSdkVersion,
      `${label}: doctor used unexpected SDK ${doctor.sdkVersion}.`,
    );
    check(
      inventory.packageId === descriptor.packageId &&
        inventory.sdkVersion === expectedSdkVersion,
      `${label}: CLI inventory identity drifted from the descriptor.`,
    );
    const surfaces = Array.isArray(inventory.surfaces)
      ? inventory.surfaces
      : [];
    const rows = Array.isArray(matrix.rows) ? matrix.rows : [];
    const cells = surfaces.flatMap((surface) =>
      (Array.isArray(surface.targets) ? surface.targets : []).map((target) => ({
        surface,
        target,
      })),
    );
    totalCells += cells.length;
    totalRows += rows.length;
    check(cells.length > 0, `${label}: CLI inventory returned no cells.`);
    check(rows.length > 0, `${label}: CLI matrix returned no rows.`);

    const e2eRoot = path.join(appDirectory, "tests", "e2e");
    const appTestFiles = collectTapTestFiles(e2eRoot);
    check(
      appTestFiles.length > 0,
      `${label}: tests/e2e contains no TAP test files.`,
    );
    const rowMatchers = rows.flatMap((row) =>
      (Array.isArray(row.testMatch) ? row.testMatch : []).map((pattern) => ({
        pattern,
        matcher: globToRegExp(pattern),
      })),
    );
    const declaredTestFiles = new Set(
      appTestFiles.filter((file) => {
        const relative = path
          .relative(appDirectory, file)
          .split(path.sep)
          .join("/");
        return rowMatchers.some(({ matcher }) => matcher.test(relative));
      }),
    );
    check(
      declaredTestFiles.size === appTestFiles.length,
      `${label}: every tests/e2e test file must be selected by matrix.testMatch.`,
    );
    for (const { pattern, matcher } of rowMatchers) {
      check(
        appTestFiles.some((file) =>
          matcher.test(
            path.relative(appDirectory, file).split(path.sep).join("/"),
          ),
        ),
        `${label}: matrix testMatch ${pattern} selects no test file.`,
      );
    }

    const declaredCaseCounts = new Map();
    for (const testFile of declaredTestFiles) {
      const source = fs.readFileSync(testFile, "utf8");
      const analysis = analyzeTapTestSource(
        path.relative(repositoryRoot, testFile),
        source,
      );
      declaredCaseCounts.set(testFile, analysis.declaredCaseCount);
    }

    const discoveryEnvironment = { ...process.env };
    delete discoveryEnvironment.TAP_MINIAPP_TEST_SESSION_FILE;
    const discovery = spawnSync(
      path.join(appDirectory, "node_modules", ".bin", "rstest"),
      ["list", "--config", `./${configPath}`, "--json"],
      {
        cwd: appDirectory,
        encoding: "utf8",
        env: discoveryEnvironment,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    check(
      discovery.status === 0,
      `${label}: Rstest discovery failed without a Test Lab session.\n${
        discovery.error?.message || discovery.stderr || discovery.stdout
      }`,
    );
    let discoveredCases = [];
    if (discovery.status === 0) {
      try {
        discoveredCases = parseRstestListJson(discovery.stdout ?? "");
      } catch (error) {
        check(false, error instanceof Error ? error.message : String(error));
      }
    }

    if (discovery.status === 0) {
      const discoveredCaseCounts = new Map(
        [...declaredTestFiles].map((file) => [file, 0]),
      );
      for (const testCase of discoveredCases) {
        const discoveredFile = path.isAbsolute(testCase.file)
          ? path.resolve(testCase.file)
          : path.resolve(appDirectory, testCase.file);
        check(
          inside(appDirectory, discoveredFile),
          `${label}: Rstest discovered a file outside the app: ${testCase.file}.`,
        );
        check(
          declaredTestFiles.has(discoveredFile),
          `${label}: Rstest discovered a file outside matrix.testMatch: ${testCase.file}.`,
        );
        if (discoveredCaseCounts.has(discoveredFile)) {
          discoveredCaseCounts.set(
            discoveredFile,
            discoveredCaseCounts.get(discoveredFile) + 1,
          );
        }
      }
      for (const [testFile, discoveredCount] of discoveredCaseCounts) {
        check(
          discoveredCount > 0,
          `${path.relative(repositoryRoot, testFile)}: no cases were discovered.`,
        );
        assertTapDiscoveryMatchesSource(
          path.relative(repositoryRoot, testFile),
          declaredCaseCounts.get(testFile) ?? 0,
          discoveredCount,
        );
      }
      check(
        discoveredCases.length > 0,
        `${label}: Rstest discovery returned zero cases.`,
      );
      totalCases += discoveredCases.length;
      console.log(
        `tap static: ${appName} (${cells.length} cells, ${rows.length} rows, ${discoveredCases.length} cases)`,
      );
    }
  } catch (error) {
    errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`\nTAP static verification failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `\nTAP static verification passed: ${selectedApps.length} apps, ` +
      `${totalCells} cells, ${totalRows} rows, ${totalCases} cases.`,
  );
}
