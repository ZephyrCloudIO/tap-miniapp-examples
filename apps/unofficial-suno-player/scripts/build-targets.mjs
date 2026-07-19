import { spawnSync } from "node:child_process";

for (const target of ["desktop", "workflow-host"]) {
  const result = spawnSync("pnpm", ["exec", "rslib", "build"], {
    stdio: "inherit",
    env: { ...process.env, TAP_PACKAGE_TARGET: target },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
