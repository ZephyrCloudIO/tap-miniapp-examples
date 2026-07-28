import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FREE_REACT_GLOBAL = /\bReact\.(?:createElement|Fragment)\b/u;
const AUTOMATIC_PUBLIC_PATH_FAILURE =
  "Automatic publicPath is not supported in this browser";
const QUICKJS_FORBIDDEN_RUNTIME =
  /\b(?:window|document|navigator|localStorage|sessionStorage|HTMLElement|WebAssembly|process|Buffer|setTimeout|setInterval|setImmediate|queueMicrotask|fetch|XMLHttpRequest|WebSocket|EventSource|Deno|Bun)\b|(?:from\s*|import\s*\()\s*["']node:|\.wasm\b/u;
const WORKFLOW_LOCAL_IDENTIFIER = /^[a-z][a-z0-9-]{0,127}$/u;
const PACKAGE_MCP_STORAGE_TEMPLATE_TOKEN = /\{(?:channelId|userId)\}/gu;
const MAX_PACKAGE_MCP_STORAGE_READS = 16;
const MAX_PACKAGE_MCP_SERVERS = 64;
const MAX_PACKAGE_MCP_TOOLS = 64;
const MAX_PACKAGE_MCP_DESCRIPTION_CHARS = 16 * 1024;
const MAX_PACKAGE_MCP_SCHEMA_BYTES = 256 * 1024;
const MAX_PACKAGE_MCP_CATALOG_BYTES = 1024 * 1024;

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function resolveArtifact(packageRoot, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }

  const resolved = path.resolve(packageRoot, relativePath);
  const relative = path.relative(packageRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the assembled package: ${relativePath}`);
  }
  return resolved;
}

async function readRequiredFile(packageRoot, relativePath, label) {
  const resolved = resolveArtifact(packageRoot, relativePath, label);
  try {
    return await fs.readFile(resolved, "utf8");
  } catch (error) {
    throw new Error(
      `${label} is missing or unreadable: ${relativePath}`,
      { cause: error },
    );
  }
}

function assertQualifiedWorkflowIdentifier(value, namespace, label) {
  const prefix = `${namespace}.`;
  const localIdentifier =
    typeof value === "string" && value.startsWith(prefix)
      ? value.slice(prefix.length)
      : "";
  if (!WORKFLOW_LOCAL_IDENTIFIER.test(localIdentifier)) {
    throw new Error(
      `${label} must be exactly ${namespace}.<local-identifier>; received ${JSON.stringify(value)}.`,
    );
  }
}

function storageEffectResources(effects) {
  return new Set(
    (effects ?? [])
      .filter((effect) => effect?.kind === "storage")
      .flatMap((effect) => effect.resources ?? []),
  );
}

function assertPackageRuntimeStorageReads(contribution, server) {
  const serverNamespaces = storageEffectResources(
    server.authorization?.effects,
  );
  const toolAuthorizationNamespaces = storageEffectResources(
    contribution.authorization?.effects,
  );
  const toolExecutionNamespaces = storageEffectResources(
    contribution.options?.effects,
  );
  const authorizedNamespaces = new Set(
    [...serverNamespaces].filter(
      (namespace) =>
        toolAuthorizationNamespaces.has(namespace) &&
        toolExecutionNamespaces.has(namespace),
    ),
  );
  const reads = contribution.options?.storageReads;
  if (authorizedNamespaces.size > 0 && (!Array.isArray(reads) || reads.length === 0)) {
    throw new Error(
      `Package-runtime MCP tool ${contribution.id} with storage effects must declare exact storageReads.`,
    );
  }
  if (reads === undefined) return;
  if (
    !Array.isArray(reads) ||
    reads.length === 0 ||
    reads.length > MAX_PACKAGE_MCP_STORAGE_READS
  ) {
    throw new Error(
      `Package-runtime MCP tool ${contribution.id} storageReads must contain 1-${MAX_PACKAGE_MCP_STORAGE_READS} selectors.`,
    );
  }

  const seen = new Set();
  for (const [index, rawRead] of reads.entries()) {
    const read = assertRecord(
      rawRead,
      `Package-runtime MCP tool ${contribution.id} storageReads[${index}]`,
    );
    if (
      Object.keys(read).sort().join("\0") !== "keyTemplate\0namespace" ||
      typeof read.namespace !== "string" ||
      read.namespace.length === 0 ||
      read.namespace.length > 128 ||
      read.namespace.trim() !== read.namespace ||
      /[\u0000-\u001f\u007f]/u.test(read.namespace) ||
      !authorizedNamespaces.has(read.namespace)
    ) {
      throw new Error(
        `Package-runtime MCP tool ${contribution.id} storageReads[${index}] must use an exactly authorized storage namespace.`,
      );
    }
    if (
      typeof read.keyTemplate !== "string" ||
      read.keyTemplate.length === 0 ||
      read.keyTemplate.length > 512 ||
      read.keyTemplate.trim() !== read.keyTemplate ||
      /[\u0000-\u001f\u007f]/u.test(read.keyTemplate) ||
      read.keyTemplate
        .replace(PACKAGE_MCP_STORAGE_TEMPLATE_TOKEN, "")
        .match(/[{}]/u)
    ) {
      throw new Error(
        `Package-runtime MCP tool ${contribution.id} storageReads[${index}] has an invalid keyTemplate.`,
      );
    }
    const identity = `${read.namespace}\0${read.keyTemplate}`;
    if (seen.has(identity)) {
      throw new Error(
        `Package-runtime MCP tool ${contribution.id} storageReads contains a duplicate selector.`,
      );
    }
    seen.add(identity);
  }
}

export function assertTapManifestRuntimePolicy(manifest) {
  assertRecord(manifest, "TAP package manifest");
  const packageDescriptor = assertRecord(manifest.package, "manifest.package");
  const namespace = packageDescriptor.namespace;
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new Error("manifest.package.namespace must be a non-empty string.");
  }

  const serialized = JSON.stringify(manifest);
  if (serialized.includes('"pending"')) {
    throw new Error(
      "Assembled package still contains pending integrity values.",
    );
  }

  const targets = assertRecord(manifest.targets, "manifest.targets");
  if (Object.keys(targets).length === 0) {
    throw new Error("Assembled package must declare at least one target.");
  }

  const contributions = manifest.contributions ?? [];
  const contributionsById = new Map(
    contributions.map((contribution) => [contribution.id, contribution]),
  );

  for (const contribution of contributions) {
    if (contribution.kind === "workflow") {
      assertQualifiedWorkflowIdentifier(
        contribution.options?.workflowId,
        namespace,
        `workflow contribution ${contribution.id} workflowId`,
      );
    } else if (contribution.kind === "workflow.node") {
      assertQualifiedWorkflowIdentifier(
        contribution.options?.nodeKind,
        namespace,
        `workflow.node contribution ${contribution.id} nodeKind`,
      );
    }

    if (
      contribution.kind === "mcp.server" &&
      contribution.options?.implementation?.type === "package-runtime"
    ) {
      const bindings = Object.entries(contribution.targets ?? {});
      const expectedExpose = `./mcp/${contribution.id}`;
      if (
        bindings.length !== 1 ||
        bindings[0][0] !== "quickjs" ||
        bindings[0][1]?.runtime !== "quickjs" ||
        bindings[0][1]?.expose !== expectedExpose
      ) {
        throw new Error(
          `Package-runtime MCP server ${contribution.id} must target exactly quickjs:${expectedExpose} with runtime quickjs.`,
        );
      }
    }

    if (contribution.kind === "mcp.tool") {
      const server = contributionsById.get(
        contribution.options?.serverContributionId,
      );
      if (
        server?.kind === "mcp.server" &&
        server.options?.implementation?.type === "package-runtime"
      ) {
        if (Object.keys(contribution.targets ?? {}).length > 0) {
          throw new Error(
            `Package-runtime MCP tool ${contribution.id} must not declare child targets.`,
          );
        }
        assertPackageRuntimeStorageReads(contribution, server);
      }
    }

    for (const [targetName, binding] of Object.entries(
      contribution.targets ?? {},
    )) {
      const target = targets[targetName];
      if (!target) {
        throw new Error(
          `Contribution ${contribution.id} binds undeclared target ${targetName}.`,
        );
      }
      if (binding?.expose === undefined) continue;

      const exposed = target.exposes?.[binding.expose];
      if (!exposed) {
        throw new Error(
          `Contribution ${contribution.id} binds missing expose ${binding.expose} on target ${targetName}.`,
        );
      }
      if (binding.runtime !== exposed.runtime) {
        throw new Error(
          `Contribution ${contribution.id} runtime ${binding.runtime} does not match ${targetName}:${binding.expose} runtime ${exposed.runtime}.`,
        );
      }
    }
  }

  return targets;
}

function collectFederationAssets(federationManifest) {
  const assets = new Set();
  for (const exposed of federationManifest.exposes ?? []) {
    for (const kind of ["js", "css"]) {
      for (const mode of ["sync", "async"]) {
        for (const asset of exposed.assets?.[kind]?.[mode] ?? []) {
          assets.add(asset);
        }
      }
    }
  }
  return assets;
}

export async function assertBuiltTapPackage(packageRootInput) {
  const packageRoot = path.resolve(packageRootInput);
  const manifestSource = await readRequiredFile(
    packageRoot,
    "manifest.tap.json",
    "TAP package manifest",
  );
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    throw new Error("TAP package manifest is not valid JSON.", { cause: error });
  }

  const targets = assertTapManifestRuntimePolicy(manifest);
  let assetCount = 0;

  for (const [targetName, targetValue] of Object.entries(targets)) {
    const target = assertRecord(targetValue, `target ${targetName}`);
    const remoteEntrySource = await readRequiredFile(
      packageRoot,
      target.remoteEntry,
      `${targetName} remote entry`,
    );
    const federationManifestSource = await readRequiredFile(
      packageRoot,
      target.manifest,
      `${targetName} federation manifest`,
    );
    await readRequiredFile(
      packageRoot,
      target.assetLock,
      `${targetName} asset lock`,
    );

    let federationManifest;
    try {
      federationManifest = JSON.parse(federationManifestSource);
    } catch (error) {
      throw new Error(
        `${targetName} federation manifest is not valid JSON.`,
        { cause: error },
      );
    }

    const runtimes = new Set(
      Object.values(target.exposes ?? {}).map((exposed) => exposed.runtime),
    );
    const isBrowserRuntime =
      runtimes.size > 0 && [...runtimes].every((runtime) => runtime === "webview");
    const isQuickJsRuntime =
      runtimes.size > 0 && [...runtimes].every((runtime) => runtime === "quickjs");
    if (
      !isBrowserRuntime &&
      federationManifest.metaData?.publicPath === "auto"
    ) {
      throw new Error(
        `${targetName} uses automatic publicPath outside a webview runtime.`,
      );
    }

    const federationExposes = new Set(
      (federationManifest.exposes ?? []).map((exposed) => exposed.path),
    );
    for (const expose of Object.keys(target.exposes ?? {})) {
      if (!federationExposes.has(expose)) {
        throw new Error(
          `${targetName} descriptor expose ${expose} is absent from its federation manifest.`,
        );
      }
    }

    const assets = collectFederationAssets(federationManifest);
    if (
      isQuickJsRuntime &&
      [...assets].some((asset) => /\.css(?:$|\?)/u.test(asset))
    ) {
      throw new Error(
        `${targetName} QuickJS federation closure contains a CSS asset.`,
      );
    }
    const javaScriptSources = [
      [target.remoteEntry, remoteEntrySource],
    ];
    for (const asset of assets) {
      const source = await readRequiredFile(
        packageRoot,
        asset,
        `${targetName} federation asset`,
      );
      assetCount += 1;
      if (/\.(?:m?js)$/u.test(asset)) {
        javaScriptSources.push([asset, source]);
      }
    }

    for (const [asset, source] of javaScriptSources) {
      if (FREE_REACT_GLOBAL.test(source)) {
        throw new Error(
          `${targetName} JavaScript asset ${asset} contains a free React JSX runtime global.`,
        );
      }
      if (!isBrowserRuntime && source.includes(AUTOMATIC_PUBLIC_PATH_FAILURE)) {
        throw new Error(
          `${targetName} JavaScript asset ${asset} contains browser-only automatic publicPath discovery.`,
        );
      }
      if (isQuickJsRuntime && QUICKJS_FORBIDDEN_RUNTIME.test(source)) {
        throw new Error(
          `${targetName} JavaScript asset ${asset} imports a browser, Node, network, timer, or WASM runtime into QuickJS.`,
        );
      }
    }
  }

  return Object.freeze({
    packageRoot,
    targetCount: Object.keys(targets).length,
    assetCount,
  });
}

export async function assertPackageRuntimeMcpAbi(packageRootInput) {
  const packageRoot = path.resolve(packageRootInput);
  const manifestSource = await readRequiredFile(
    packageRoot,
    "manifest.tap.json",
    "TAP package manifest",
  );
  const manifest = JSON.parse(manifestSource);
  const packageRuntimeServers = (manifest.contributions ?? []).filter(
    (contribution) =>
      contribution.kind === "mcp.server" &&
      contribution.options?.implementation?.type === "package-runtime",
  );
  if (packageRuntimeServers.length === 0) {
    return Object.freeze({ packageRoot, serverCount: 0 });
  }
  if (packageRuntimeServers.length > MAX_PACKAGE_MCP_SERVERS) {
    throw new Error(
      `TAP package exceeds the ${MAX_PACKAGE_MCP_SERVERS}-server MCP limit.`,
    );
  }

  const quickJsTarget = assertRecord(
    manifest.targets?.quickjs,
    "manifest.targets.quickjs",
  );
  const remoteEntryPath = resolveArtifact(
    packageRoot,
    quickJsTarget.remoteEntry,
    "QuickJS remote entry",
  );
  const container = await import(
    `${pathToFileURL(remoteEntryPath).href}?tap-package-abi=1`
  );
  const containerExports = Object.keys(container).sort();
  if (containerExports.join("\0") !== "get\0init") {
    throw new Error(
      `QuickJS container must export exactly get and init; received ${containerExports.join(", ") || "nothing"}.`,
    );
  }
  await container.init(Object.create(null));

  let packageToolCount = 0;
  const packageCatalog = Object.create(null);
  for (const server of packageRuntimeServers) {
    const expose = server.targets?.quickjs?.expose;
    let factory;
    try {
      factory = await container.get(expose);
    } catch (error) {
      throw new Error(
        `Package-runtime MCP server ${server.id} could not load ${String(expose)}.`,
        { cause: error },
      );
    }
    const moduleNamespace = await factory();
    const moduleExports = Object.keys(moduleNamespace).sort();
    if (moduleExports.join("\0") !== "mcpServer") {
      throw new Error(
        `Package-runtime MCP expose ${expose} must export exactly mcpServer; received ${moduleExports.join(", ") || "nothing"}.`,
      );
    }
    const mcpServer = assertRecord(
      moduleNamespace.mcpServer,
      `Package-runtime MCP server ${server.id}`,
    );
    if (
      Object.keys(mcpServer).join("\0") !== "tools" ||
      !Object.hasOwn(mcpServer, "tools")
    ) {
      throw new Error(
        `Package-runtime MCP server ${server.id} must contain exactly one tools object.`,
      );
    }
    const tools = assertRecord(
      mcpServer.tools,
      `Package-runtime MCP server ${server.id} tools`,
    );
    const toolEntries = Object.entries(tools);
    if (toolEntries.length > MAX_PACKAGE_MCP_TOOLS) {
      throw new Error(
        `Package-runtime MCP server ${server.id} exceeds the ${MAX_PACKAGE_MCP_TOOLS}-tool limit.`,
      );
    }
    for (const [toolName, rawTool] of toolEntries) {
      if (toolName.length === 0 || toolName.trim() !== toolName) {
        throw new Error(
          `Package-runtime MCP server ${server.id} contains an invalid tool name.`,
        );
      }
      const tool = assertRecord(
        rawTool,
        `Package-runtime MCP tool ${server.id}/${toolName}`,
      );
      if (
        Object.keys(tool).sort().join("\0") !==
          "description\0execute\0inputSchema" ||
        !Object.hasOwn(tool, "description") ||
        !Object.hasOwn(tool, "inputSchema") ||
        !Object.hasOwn(tool, "execute")
      ) {
        throw new Error(
          `Package-runtime MCP tool ${server.id}/${toolName} must contain exactly description, inputSchema, and execute.`,
        );
      }
      if (
        typeof tool.description !== "string" ||
        tool.description.length === 0 ||
        tool.description.length > MAX_PACKAGE_MCP_DESCRIPTION_CHARS
      ) {
        throw new Error(
          `Package-runtime MCP tool ${server.id}/${toolName} has an invalid description.`,
        );
      }
      assertRecord(
        tool.inputSchema,
        `Package-runtime MCP tool ${server.id}/${toolName} inputSchema`,
      );
      let rawSchema;
      try {
        rawSchema = JSON.stringify(tool.inputSchema);
      } catch (error) {
        throw new Error(
          `Package-runtime MCP tool ${server.id}/${toolName} inputSchema must be JSON serializable.`,
          { cause: error },
        );
      }
      if (
        rawSchema === undefined ||
        rawSchema.length > MAX_PACKAGE_MCP_SCHEMA_BYTES
      ) {
        throw new Error(
          `Package-runtime MCP tool ${server.id}/${toolName} inputSchema exceeds the metadata limit.`,
        );
      }
      if (typeof tool.execute !== "function") {
        throw new Error(
          `Package-runtime MCP tool ${server.id}/${toolName} must define execute.`,
        );
      }
    }
    packageToolCount += toolEntries.length;
    if (packageToolCount > MAX_PACKAGE_MCP_TOOLS) {
      throw new Error(
        `TAP package exceeds the ${MAX_PACKAGE_MCP_TOOLS}-tool MCP limit.`,
      );
    }
    packageCatalog[server.id] = toolEntries.map(([toolName, tool]) => ({
      name: toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    const declaredTools = (manifest.contributions ?? [])
      .filter(
        (contribution) =>
          contribution.kind === "mcp.tool" &&
          contribution.options?.serverContributionId === server.id,
      )
      .map((contribution) => contribution.options?.toolName)
      .sort();
    const implementedTools = toolEntries.map(([toolName]) => toolName).sort();
    if (implementedTools.join("\0") !== declaredTools.join("\0")) {
      throw new Error(
        `Package-runtime MCP server ${server.id} tools must exactly match its descriptor. Declared: ${declaredTools.join(", ")}; implemented: ${implementedTools.join(", ")}.`,
      );
    }
  }
  if (JSON.stringify(packageCatalog).length > MAX_PACKAGE_MCP_CATALOG_BYTES) {
    throw new Error("TAP package MCP catalog exceeds the metadata limit.");
  }

  return Object.freeze({
    packageRoot,
    serverCount: packageRuntimeServers.length,
  });
}
