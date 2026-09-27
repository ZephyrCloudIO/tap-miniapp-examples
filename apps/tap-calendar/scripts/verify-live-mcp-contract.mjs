import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Admission requirements enforced by TAP's runtime descriptor validator. */
export async function verifyLiveMcpContract(packageRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.tap.json"), "utf8"));
  const descriptor = JSON.parse(await readFile(join(packageRoot, "tap-miniapp.build.json"), "utf8"));
  const server = descriptor.contributions.find(item => item.id === "calendar-live-tools");
  const oauth = server?.options?.oauth;
  const effects = server?.authorization?.effects?.filter(effect => effect.kind === "mcp.oauth");
  if (!oauth || oauth.resource !== server.options.implementation.url || !oauth.scopes.length ||
      oauth.scopes.some((scope, index) => index > 0 && oauth.scopes[index - 1] >= scope) ||
      effects?.length !== 1 || JSON.stringify(effects[0].resources) !== JSON.stringify([oauth.resource])) {
    throw new Error("Calendar live MCP requires sorted OAuth scopes and one exact mcp.oauth resource effect.");
  }
  const artifacts = new Set(manifest.artifacts.map(artifact => artifact.path));
  const tools = descriptor.contributions.filter(item => item.kind === "mcp.tool" && item.options.serverContributionId === server.id);
  if (tools.length !== 8) throw new Error("Calendar must declare all eight live MCP tools.");
  for (const tool of tools) {
    const schemaPath = tool.options.inputSchema;
    if (typeof schemaPath !== "string" || !/^targets\/desktop\/schemas\/mcp\/[a-z-]+\.input\.json$/u.test(schemaPath) || !artifacts.has(schemaPath)) {
      throw new Error(`${tool.id} must reference a signed input schema asset in the assembled package.`);
    }
    const schema = JSON.parse(await readFile(join(packageRoot, schemaPath), "utf8"));
    if (schema.type !== "object" || schema.additionalProperties !== false) throw new Error(`${tool.id} requires a closed object input schema.`);
  }
  console.log("Verified Calendar OAuth admission and all eight signed live-tool schemas.");
}
