import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appsDirectory = resolve(scriptDirectory, "..", "..");
const roots = [
  join(appsDirectory, "agent-browser-prototype", "src"),
  join(appsDirectory, "agent-browser-gateway", "src"),
];
const runtimeExtensions = new Set([".css", ".ts", ".tsx"]);
const bundleExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const forbidden = [
  {
    pattern: /\b(?:fake|mock|stub|synthetic)\b/iu,
    reason: "simulation terminology or a simulation branch",
  },
  {
    pattern: /data:image\/svg\+xml/iu,
    reason: "an inline generated screenshot",
  },
  {
    pattern: /\bURL\.(?:create|revoke)ObjectURL\s*\(/u,
    reason: "a blob-backed image URL blocked by the signed surface CSP",
  },
  {
    pattern: /setSession\s*\(\s*\{/u,
    reason: "a locally manufactured browser session",
  },
  {
    pattern: /\bAgentBrowserGatewayDependencies\b|\bbrowserApiFetch\s*\??\s*:/u,
    reason: "a runtime-swappable Browser Run transport",
  },
  {
    pattern: /(?:status\s*:\s*200|\?\?\s*200)[\s\S]{0,400}(?:screenshot|evidence)/iu,
    reason: "a manufactured successful evidence result",
  },
  {
    pattern: /(?:screenshot|evidence)[\s\S]{0,400}(?:status\s*:\s*200|\?\?\s*200)/iu,
    reason: "a manufactured successful evidence result",
  },
];
const bundleForbidden = [
  /\b(?:fake|mock|stub|synthetic)\b/iu,
  /data:image\/svg\+xml/iu,
  /\bURL\.(?:create|revoke)ObjectURL\s*\(/u,
  /["']blob:[^"'\s]+/u,
  /deterministic local (?:browser|evidence|session)/iu,
  /use deterministic [a-z ]*\(zero browser time\)/iu,
  /(?:mock session|mock live session|mock control|mock mode)/iu,
  /kind\s*:\s*["']mock["']/iu,
];

async function runtimeFiles(directory, extensions = runtimeExtensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await runtimeFiles(path, extensions));
    } else if (
      extensions.has(extname(entry.name)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const root of roots) {
  for (const file of await runtimeFiles(root)) {
    const source = await readFile(file, "utf8");
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) {
        violations.push(`${relative(appsDirectory, file)}: ${rule.reason}`);
      }
    }
  }
}

const bundleRoots = [];
if (process.argv.includes("--bundle")) {
  bundleRoots.push(
    join(appsDirectory, "agent-browser-prototype", ".tap-build", "desktop"),
  );
}
if (process.argv.includes("--gateway-bundle")) {
  bundleRoots.push(join(appsDirectory, "agent-browser-gateway", "dist"));
}
for (const bundleRoot of bundleRoots) {
  const bundleFiles = await runtimeFiles(bundleRoot, bundleExtensions);
  for (const file of bundleFiles) {
    const source = await readFile(file, "utf8");
    for (const pattern of bundleForbidden) {
      if (pattern.test(source)) {
        violations.push(
          `${relative(appsDirectory, file)}: packaged simulation code or copy`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Remote Browser runtime must be real-only:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
}

console.log(
  bundleRoots.length > 0
    ? "Remote Browser source and built package are real-only."
    : "Remote Browser runtime is real-only.",
);
