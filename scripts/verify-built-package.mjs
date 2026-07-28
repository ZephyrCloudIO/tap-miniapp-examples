import {
  assertBuiltTapPackage,
  assertPackageRuntimeMcpAbi,
} from "./tap-package-policy.mjs";

const packageRoot = process.argv[2];
if (!packageRoot) {
  throw new Error(
    "Usage: node scripts/verify-built-package.mjs <assembled-package-root>",
  );
}

const result = await assertBuiltTapPackage(packageRoot);
const mcpResult = await assertPackageRuntimeMcpAbi(packageRoot);
console.log(
  `verified ${result.targetCount} TAP target(s), ${result.assetCount} exposed federation asset(s), and ${mcpResult.serverCount} package-runtime MCP server ABI(s) in ${result.packageRoot}`,
);
