import fs from "node:fs";
import path from "node:path";

const tapTestFilePattern = /\.(?:tap|test|spec)\.tsx?$/u;

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export const collectTapTestFiles = (directory) => {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTapTestFiles(file);
      return entry.isFile() && tapTestFilePattern.test(entry.name) ? [file] : [];
    })
    .sort();
};

export const resolveInstalledTapCli = (appDirectory) => {
  const sdkPackageJsonPath = path.join(
    appDirectory,
    "node_modules",
    "@theaiplatform",
    "miniapp-sdk",
    "package.json",
  );

  let realPackageJsonPath;
  try {
    realPackageJsonPath = fs.realpathSync(sdkPackageJsonPath);
  } catch (error) {
    throw new Error(
      `Installed SDK package metadata is unavailable at ${sdkPackageJsonPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const sdkPackageRoot = path.dirname(realPackageJsonPath);
  const sdkPackage = JSON.parse(fs.readFileSync(realPackageJsonPath, "utf8"));
  const bin =
    sdkPackage.bin &&
    typeof sdkPackage.bin === "object" &&
    !Array.isArray(sdkPackage.bin)
      ? sdkPackage.bin["tap-miniapp-test"]
      : undefined;

  if (typeof bin !== "string" || bin.trim().length === 0) {
    throw new Error(
      "Installed SDK package.json must declare bin['tap-miniapp-test'].",
    );
  }
  if (path.isAbsolute(bin)) {
    throw new Error(
      "Installed SDK bin['tap-miniapp-test'] must be package-relative.",
    );
  }

  const cliPath = path.resolve(sdkPackageRoot, bin);
  if (!isInside(sdkPackageRoot, cliPath)) {
    throw new Error(
      "Installed SDK bin['tap-miniapp-test'] must stay inside the SDK package.",
    );
  }
  if (path.extname(cliPath) !== ".js") {
    throw new Error(
      "Installed SDK bin['tap-miniapp-test'] must resolve to a .js file.",
    );
  }

  let realCliPath;
  try {
    realCliPath = fs.realpathSync(cliPath);
  } catch (error) {
    throw new Error(
      `Installed SDK tap-miniapp-test CLI is unavailable at ${cliPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isInside(sdkPackageRoot, realCliPath)) {
    throw new Error(
      "Installed SDK bin['tap-miniapp-test'] resolves outside the SDK package.",
    );
  }
  if (!fs.statSync(realCliPath).isFile() || path.extname(realCliPath) !== ".js") {
    throw new Error(
      "Installed SDK bin['tap-miniapp-test'] must resolve to a regular .js file.",
    );
  }

  return realCliPath;
};
