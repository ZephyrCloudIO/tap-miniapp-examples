import { spawnSync } from "node:child_process";
import process from "node:process";

const gates = [
  {
    id: "repository",
    label: "Repository diff hygiene",
    command: "git",
    args: ["diff", "--check"],
  },
  {
    id: "contract-typecheck",
    label: "Roadie contract typecheck",
    command: "pnpm",
    args: ["--filter", "@tap-examples/roadie-contract", "typecheck"],
  },
  {
    id: "api-typecheck",
    label: "Roadie API typecheck",
    command: "pnpm",
    args: ["--filter", "@tap-examples/roadie-api", "typecheck"],
  },
  {
    id: "api-unit",
    label: "Roadie API authorization and tenant-isolation tests",
    command: "pnpm",
    args: ["--filter", "@tap-examples/roadie-api", "test:unit"],
  },
  {
    id: "api-build",
    label: "Roadie API Wrangler dry-run build",
    command: "pnpm",
    args: ["--filter", "@tap-examples/roadie-api", "build"],
  },
  {
    id: "miniapp-typecheck",
    label: "Roadie miniapp typecheck",
    command: "pnpm",
    args: ["--filter", "tap-roadie", "typecheck"],
  },
  {
    id: "miniapp-unit",
    label: "Roadie miniapp unit tests",
    command: "pnpm",
    args: ["--filter", "tap-roadie", "test"],
  },
  {
    id: "miniapp-build",
    label: "Roadie package build",
    command: "pnpm",
    args: ["--filter", "tap-roadie", "build"],
  },
  {
    id: "tap-static",
    label: "TAP manifest and generated-test verification",
    command: "pnpm",
    args: ["run", "test:tap:static"],
  },
];

function printable(command, args) {
  return [command, ...args].join(" ");
}

console.log(`Roadie verification loop: ${gates.length} automated gates\n`);

for (const [index, gate] of gates.entries()) {
  const position = `${index + 1}/${gates.length}`;
  console.log(`[${position}] ${gate.label}`);
  console.log(`  ${printable(gate.command, gate.args)}`);
  const result = spawnSync(gate.command, gate.args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`\nGate ${gate.id} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nGate ${gate.id} failed with exit code ${result.status ?? "unknown"}.`);
    console.error("Fix this gate, then rerun pnpm verify:roadie:loop from the repository root.");
    process.exit(result.status ?? 1);
  }
  console.log(`  PASS ${gate.id}\n`);
}

console.log("All automated Roadie gates passed.");
console.log("Manual gates remain: Directory reconciliation and the real two-workspace tracer bullet.");
