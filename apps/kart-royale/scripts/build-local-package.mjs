import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveLocalPackageManifest,
  LOCAL_SERVER_ORIGIN,
} from "./local-package-profile.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedRoot = path.join(packageRoot, ".tap-build", "local-package-source");
const generatedManifest = path.join(generatedRoot, "manifest.tap.json");
const canonicalManifest = path.join(packageRoot, "manifest.tap.json");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(script, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(packageManager, ["run", script], {
      cwd: packageRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${script} terminated by ${signal}`
            : `${script} exited with code ${code}`,
        ),
      );
    });
  });
}

async function prepareLocalManifest() {
  const canonical = JSON.parse(await fs.readFile(canonicalManifest, "utf8"));
  const local = deriveLocalPackageManifest(canonical);

  await fs.rm(generatedRoot, { recursive: true, force: true });
  await fs.mkdir(generatedRoot, { recursive: true });
  await Promise.all([
    fs.cp(path.join(packageRoot, "assets"), path.join(generatedRoot, "assets"), {
      recursive: true,
    }),
    fs.cp(path.join(packageRoot, "schemas"), path.join(generatedRoot, "schemas"), {
      recursive: true,
    }),
  ]);
  await fs.writeFile(generatedManifest, `${JSON.stringify(local, null, 2)}\n`);
}

await prepareLocalManifest();
try {
  const environment = {
    ...process.env,
    KART_ROYALE_SERVER_URL: LOCAL_SERVER_ORIGIN,
    TAP_PACKAGE_MANIFEST: generatedManifest,
  };
  for (const script of [
    "build:miniapp:desktop",
    "build:miniapp:quickjs",
    "build:miniapp:assemble",
    "verify:package",
  ]) {
    await run(script, environment);
  }
  console.log(
    `Built local Kart Royale TAP package at ${path.join(packageRoot, "dist")} for ${LOCAL_SERVER_ORIGIN}`,
  );
} finally {
  await fs.rm(generatedRoot, { recursive: true, force: true });
}
