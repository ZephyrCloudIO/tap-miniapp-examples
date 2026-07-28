import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertBuiltTapPackage,
  assertPackageRuntimeMcpAbi,
} from "./tap-package-policy.mjs";

function writeFile(root, relativePath, source) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
}

function createPackageFixture(t, {
  runtime = "quickjs",
  publicPath = "",
  javaScriptSource = "export const mount = () => undefined;",
  workflowId = "examples-policy.valid-workflow",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tap-package-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const targetName = runtime;
  const targetRoot = `targets/${targetName}`;
  const expose = "./runtime";
  const manifest = {
    schemaVersion: 1,
    package: {
      packageId: "tap_pkg_examples_policy_0001",
      namespace: "examples-policy",
    },
    targets: {
      [targetName]: {
        remoteEntry: `${targetRoot}/remoteEntry.mjs`,
        manifest: `${targetRoot}/mf-manifest.json`,
        assetLock: `${targetRoot}/tap.package.lock.json`,
        exposes: {
          [expose]: {
            integrity: "sha256-valid",
            runtime,
          },
        },
      },
    },
    contributions: [
      {
        kind: "workflow",
        id: "valid-workflow",
        targets: {
          [targetName]: { expose, runtime },
        },
        options: { workflowId },
      },
    ],
  };
  const federationManifest = {
    metaData: { publicPath },
    exposes: [
      {
        path: expose,
        assets: {
          js: { sync: [`${targetRoot}/expose.js`], async: [] },
          css: { sync: [], async: [] },
        },
      },
    ],
  };

  writeFile(root, "manifest.tap.json", JSON.stringify(manifest));
  writeFile(root, `${targetRoot}/remoteEntry.mjs`, "export {};");
  writeFile(
    root,
    `${targetRoot}/mf-manifest.json`,
    JSON.stringify(federationManifest),
  );
  writeFile(root, `${targetRoot}/tap.package.lock.json`, "{}");
  writeFile(root, `${targetRoot}/expose.js`, javaScriptSource);
  return { root, manifest, federationManifest, targetRoot };
}

function addPackageRuntimeMcp(
  fixture,
  {
    childTargets = false,
    extraModuleExport = false,
    extraServerKey = false,
    storageNamespace,
    storageReads,
    toolShape = "valid",
  } = {},
) {
  const { root, manifest, federationManifest, targetRoot } = fixture;
  const expose = "./mcp/state";
  manifest.targets.quickjs.exposes[expose] = {
    integrity: "sha256-valid",
    runtime: "quickjs",
  };
  manifest.contributions.push(
    {
      kind: "mcp.server",
      id: "state",
      targets: {
        quickjs: { expose, runtime: "quickjs" },
      },
      ...(storageNamespace
        ? {
            authorization: {
              effects: [{ kind: "storage", resources: [storageNamespace] }],
            },
          }
        : {}),
      options: { implementation: { type: "package-runtime" } },
    },
    {
      kind: "mcp.tool",
      id: "read-state",
      ...(childTargets
        ? { targets: { quickjs: { runtime: "host-declarative" } } }
        : {}),
      ...(storageNamespace
        ? {
            authorization: {
              effects: [{ kind: "storage", resources: [storageNamespace] }],
            },
          }
        : {}),
      options: {
        serverContributionId: "state",
        toolName: "read_state",
        ...(storageNamespace
          ? {
              effects: [{ kind: "storage", resources: [storageNamespace] }],
              ...(storageReads === undefined ? {} : { storageReads }),
            }
          : {}),
      },
    },
  );
  federationManifest.exposes.push({
    path: expose,
    assets: {
      js: { sync: [`${targetRoot}/expose.js`], async: [] },
      css: { sync: [], async: [] },
    },
  });
  writeFile(root, "manifest.tap.json", JSON.stringify(manifest));
  writeFile(
    root,
    `${targetRoot}/mf-manifest.json`,
    JSON.stringify(federationManifest),
  );
  writeFile(
    root,
    `${targetRoot}/remoteEntry.mjs`,
    [
      "export const init = async () => undefined;",
      "export const get = async (expose) => {",
      "  if (expose !== './mcp/state') throw new Error('missing expose');",
      `  return () => ({ mcpServer: { tools: { read_state: ${
        toolShape === "missing"
          ? "{}"
          : `{
        description: "Read fixture state.",
        inputSchema: { type: "object", additionalProperties: false },
        execute: ${toolShape === "non-function" ? "null" : "() => ({ ok: true })"}${
          toolShape === "extra" ? ", unexpected: true" : ""
        }
      }`
      } }${extraServerKey ? ", unexpected: true" : ""} }${extraModuleExport ? ", default: {}" : ""} });`,
      "};",
    ].join("\n"),
  );
  return fixture;
}

function addPackageRuntimeMcpMatrix(
  fixture,
  {
    serverCount,
    toolsPerServer,
    description = "Read fixture state.",
  },
) {
  const { root, manifest, federationManifest, targetRoot } = fixture;
  const modules = [];
  for (let serverIndex = 0; serverIndex < serverCount; serverIndex += 1) {
    const serverId = `state-${serverIndex}`;
    const expose = `./mcp/${serverId}`;
    manifest.targets.quickjs.exposes[expose] = {
      integrity: "sha256-valid",
      runtime: "quickjs",
    };
    manifest.contributions.push({
      kind: "mcp.server",
      id: serverId,
      targets: {
        quickjs: { expose, runtime: "quickjs" },
      },
      options: { implementation: { type: "package-runtime" } },
    });
    const toolSources = [];
    for (let toolIndex = 0; toolIndex < toolsPerServer; toolIndex += 1) {
      const toolName = `read_state_${serverIndex}_${toolIndex}`;
      manifest.contributions.push({
        kind: "mcp.tool",
        id: toolName,
        options: {
          serverContributionId: serverId,
          toolName,
        },
      });
      toolSources.push(`${JSON.stringify(toolName)}: {
        description: ${JSON.stringify(description)},
        inputSchema: { type: "object", additionalProperties: false },
        execute: () => ({ ok: true })
      }`);
    }
    modules.push(
      `${JSON.stringify(expose)}: { mcpServer: { tools: { ${toolSources.join(",")} } } }`,
    );
    federationManifest.exposes.push({
      path: expose,
      assets: {
        js: { sync: [`${targetRoot}/expose.js`], async: [] },
        css: { sync: [], async: [] },
      },
    });
  }
  writeFile(root, "manifest.tap.json", JSON.stringify(manifest));
  writeFile(
    root,
    `${targetRoot}/mf-manifest.json`,
    JSON.stringify(federationManifest),
  );
  writeFile(
    root,
    `${targetRoot}/remoteEntry.mjs`,
    [
      `const modules = { ${modules.join(",")} };`,
      "export const init = async () => undefined;",
      "export const get = async (expose) => {",
      "  if (!Object.hasOwn(modules, expose)) throw new Error('missing expose');",
      "  return () => modules[expose];",
      "};",
    ].join("\n"),
  );
  return fixture;
}

test("accepts a resolved non-browser TAP package", async (t) => {
  const { root } = createPackageFixture(t);
  const result = await assertBuiltTapPackage(root);
  assert.equal(result.targetCount, 1);
  assert.equal(result.assetCount, 1);
});

test("rejects a free React JSX runtime global in an exposed asset", async (t) => {
  const { root } = createPackageFixture(t, {
    javaScriptSource: "export default React.createElement('main');",
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /free React JSX runtime global/u,
  );
});

test("rejects browser-only public-path discovery in QuickJS", async (t) => {
  const { root } = createPackageFixture(t, {
    publicPath: "auto",
    javaScriptSource:
      "throw new Error('Automatic publicPath is not supported in this browser');",
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /automatic publicPath outside a webview runtime/u,
  );
});

test("rejects a DOM or WASM runtime in the QuickJS JavaScript closure", async (t) => {
  const { root } = createPackageFixture(t, {
    javaScriptSource: "export const runtime = globalThis.document;",
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /browser, Node, network, timer, or WASM runtime into QuickJS/u,
  );
});

test("rejects Node, network, or timer capabilities in the QuickJS closure", async (t) => {
  for (const javaScriptSource of [
    "export const runtime = process.version;",
    "export const runtime = fetch('https://example.com');",
    "export const runtime = setTimeout(() => {}, 1);",
    "export { readFile } from 'node:fs';",
  ]) {
    const { root } = createPackageFixture(t, { javaScriptSource });
    await assert.rejects(
      assertBuiltTapPackage(root),
      /browser, Node, network, timer, or WASM runtime into QuickJS/u,
    );
  }
});

test("allows automatic public-path discovery for a webview target", async (t) => {
  const { root } = createPackageFixture(t, {
    runtime: "webview",
    publicPath: "auto",
  });
  await assert.doesNotReject(assertBuiltTapPackage(root));
});

test("rejects a workflow identifier outside the package namespace", async (t) => {
  const { root } = createPackageFixture(t, {
    workflowId: "examples-policy-not-qualified",
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /examples-policy\.<local-identifier>/u,
  );
});

test("rejects descriptor-to-federation expose drift", async (t) => {
  const { root, federationManifest, targetRoot } = createPackageFixture(t);
  federationManifest.exposes = [];
  writeFile(
    root,
    `${targetRoot}/mf-manifest.json`,
    JSON.stringify(federationManifest),
  );
  await assert.rejects(
    assertBuiltTapPackage(root),
    /descriptor expose .* absent/u,
  );
});

test("accepts an exact package-runtime MCP QuickJS target", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t));
  await assert.doesNotReject(assertBuiltTapPackage(root));
});

test("rejects a non-canonical package-runtime MCP expose", async (t) => {
  const fixture = createPackageFixture(t);
  fixture.manifest.contributions.push({
    kind: "mcp.server",
    id: "state",
    targets: {
      quickjs: { expose: "./runtime", runtime: "quickjs" },
    },
    options: { implementation: { type: "package-runtime" } },
  });
  writeFile(
    fixture.root,
    "manifest.tap.json",
    JSON.stringify(fixture.manifest),
  );
  await assert.rejects(
    assertBuiltTapPackage(fixture.root),
    /must target exactly quickjs:.\/mcp\/state/u,
  );
});

test("rejects targets on package-runtime MCP child tools", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    childTargets: true,
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /must not declare child targets/u,
  );
});

test("accepts exact bounded storage reads for a package-runtime MCP tool", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    storageNamespace: "dataset",
    storageReads: [
      {
        namespace: "dataset",
        keyTemplate: "channels/{channelId}/current",
      },
    ],
  });
  await assert.doesNotReject(assertBuiltTapPackage(root));
});

test("accepts user-and-channel-scoped package-runtime storage reads", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    storageNamespace: "dataset",
    storageReads: [
      {
        namespace: "dataset",
        keyTemplate: "mcp/users/{userId}/channels/{channelId}/current",
      },
    ],
  });
  await assert.doesNotReject(assertBuiltTapPackage(root));
});

test("rejects namespace-wide package-runtime MCP storage snapshots", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    storageNamespace: "dataset",
  });
  await assert.rejects(
    assertBuiltTapPackage(root),
    /must declare exact storageReads/u,
  );
});

test("rejects unauthorized or untrusted package-runtime storage read templates", async (t) => {
  const unauthorized = addPackageRuntimeMcp(createPackageFixture(t), {
    storageNamespace: "dataset",
    storageReads: [{ namespace: "private", keyTemplate: "current" }],
  });
  await assert.rejects(
    assertBuiltTapPackage(unauthorized.root),
    /exactly authorized storage namespace/u,
  );

  const untrusted = addPackageRuntimeMcp(createPackageFixture(t), {
    storageNamespace: "dataset",
    storageReads: [
      { namespace: "dataset", keyTemplate: "channels/{arguments.id}/current" },
    ],
  });
  await assert.rejects(
    assertBuiltTapPackage(untrusted.root),
    /invalid keyTemplate/u,
  );
});

test("accepts the exact built package-runtime MCP host ABI", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t));
  const result = await assertPackageRuntimeMcpAbi(root);
  assert.equal(result.serverCount, 1);
});

test("rejects a package-runtime MCP tool with missing or extra ABI keys", async (t) => {
  const missing = addPackageRuntimeMcp(createPackageFixture(t), {
    toolShape: "missing",
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(missing.root),
    /must contain exactly description, inputSchema, and execute/u,
  );

  const extra = addPackageRuntimeMcp(createPackageFixture(t), {
    toolShape: "extra",
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(extra.root),
    /must contain exactly description, inputSchema, and execute/u,
  );
});

test("rejects a package-runtime MCP tool with a non-function executor", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    toolShape: "non-function",
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /must define execute/u,
  );
});

test("rejects extra package-runtime MCP server keys", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    extraServerKey: true,
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /exactly one tools object/u,
  );
});

test("rejects more than 64 package-runtime MCP servers", async (t) => {
  const { root } = addPackageRuntimeMcpMatrix(createPackageFixture(t), {
    serverCount: 65,
    toolsPerServer: 0,
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /64-server MCP limit/u,
  );
});

test("rejects more than 64 package-runtime MCP tools in aggregate", async (t) => {
  const { root } = addPackageRuntimeMcpMatrix(createPackageFixture(t), {
    serverCount: 2,
    toolsPerServer: 33,
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /64-tool MCP limit/u,
  );
});

test("rejects an aggregate package-runtime MCP catalog over 1 MiB", async (t) => {
  const { root } = addPackageRuntimeMcpMatrix(createPackageFixture(t), {
    serverCount: 1,
    toolsPerServer: 64,
    description: "x".repeat(16 * 1024),
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /catalog exceeds the metadata limit/u,
  );
});

test("rejects extra exports from a built package-runtime MCP module", async (t) => {
  const { root } = addPackageRuntimeMcp(createPackageFixture(t), {
    extraModuleExport: true,
  });
  await assert.rejects(
    assertPackageRuntimeMcpAbi(root),
    /must export exactly mcpServer/u,
  );
});
