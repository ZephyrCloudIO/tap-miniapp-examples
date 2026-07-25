import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TAP_RSTEST_ADAPTER =
  "@theaiplatform/miniapp-sdk/testing/rstest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireFromRoot = createRequire(path.join(repositoryRoot, "package.json"));
const ts = requireFromRoot("typescript");
const runnerApiNames = new Set(["describe", "it", "test"]);

const diagnosticMessage = (diagnostic) =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");

const importName = (specifier) =>
  (specifier.propertyName ?? specifier.name).text;

const isImportBindingIdentifier = (node) =>
  ts.isImportSpecifier(node.parent) &&
  (node.parent.name === node || node.parent.propertyName === node);

const isPropertyNameIdentifier = (node) => {
  const { parent } = node;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node)
  );
};

const propertyChainRoot = (expression) => {
  let candidate = expression;
  while (
    ts.isPropertyAccessExpression(candidate) ||
    ts.isElementAccessExpression(candidate) ||
    ts.isCallExpression(candidate) ||
    ts.isParenthesizedExpression(candidate) ||
    ts.isAsExpression(candidate) ||
    ts.isTypeAssertionExpression(candidate) ||
    ts.isNonNullExpression(candidate)
  ) {
    candidate = candidate.expression;
  }
  return candidate;
};

/**
 * Enforce a deliberately narrow Test Lab declaration grammar.
 *
 * Cases must use direct `test(...)` calls imported once from the SDK adapter.
 * Aliases and runner member APIs are rejected so focused, skipped,
 * conditional, concurrent, and expected-failure cases cannot hide from the
 * repository's static inventory.
 */
export const analyzeTapTestSource = (filePath, source) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const errors = sourceFile.parseDiagnostics.map(
    (diagnostic) => `TypeScript parse error: ${diagnosticMessage(diagnostic)}`,
  );
  const canonicalImports = [];
  const canonicalRunnerBindings = new Set();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    const importClause = statement.importClause;
    if (moduleName === TAP_RSTEST_ADAPTER) {
      canonicalImports.push(statement);
      if (
        !importClause ||
        importClause.isTypeOnly ||
        importClause.name ||
        !importClause.namedBindings ||
        !ts.isNamedImports(importClause.namedBindings)
      ) {
        errors.push(
          `Import ${TAP_RSTEST_ADAPTER} through unaliased named value imports.`,
        );
        continue;
      }

      for (const specifier of importClause.namedBindings.elements) {
        if (specifier.isTypeOnly) continue;
        const imported = importName(specifier);
        const local = specifier.name.text;
        if (specifier.propertyName || imported !== local) {
          errors.push(
            `Aliasing ${imported} from ${TAP_RSTEST_ADAPTER} is forbidden.`,
          );
        }
        if (runnerApiNames.has(imported)) canonicalRunnerBindings.add(local);
      }
      continue;
    }

    if (moduleName.startsWith("@rstest/")) {
      errors.push(
        `Import Test Lab APIs from ${TAP_RSTEST_ADAPTER}, not ${moduleName}.`,
      );
      continue;
    }

    if (
      importClause?.namedBindings &&
      ts.isNamedImports(importClause.namedBindings)
    ) {
      for (const specifier of importClause.namedBindings.elements) {
        if (runnerApiNames.has(importName(specifier))) {
          errors.push(
            `Import ${importName(specifier)} from ${TAP_RSTEST_ADAPTER}.`,
          );
        }
      }
    }
  }

  if (canonicalImports.length !== 1) {
    errors.push(
      `Expected exactly one ${TAP_RSTEST_ADAPTER} import; received ${canonicalImports.length}.`,
    );
  }
  if (!canonicalRunnerBindings.has("test")) {
    errors.push(
      `Import the canonical test binding from ${TAP_RSTEST_ADAPTER} without an alias.`,
    );
  }

  let declaredCaseCount = 0;
  const visit = (node) => {
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      propertyChainRoot(node).kind === ts.SyntaxKind.Identifier
    ) {
      const root = propertyChainRoot(node);
      if (ts.isIdentifier(root) && runnerApiNames.has(root.text)) {
        errors.push(
          `${root.text} member APIs are forbidden; declare cases with direct test(...) calls.`,
        );
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (runnerApiNames.has(name) && !canonicalRunnerBindings.has(name)) {
        errors.push(
          `Call ${name}(...) only through an unaliased ${TAP_RSTEST_ADAPTER} import.`,
        );
      }
      if (name === "test") declaredCaseCount += 1;
      if (name === "it") {
        errors.push("Use the canonical test(...) binding instead of it(...).");
      }
    }

    if (
      ts.isIdentifier(node) &&
      runnerApiNames.has(node.text) &&
      !isImportBindingIdentifier(node) &&
      !isPropertyNameIdentifier(node)
    ) {
      const directCall =
        ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!directCall) {
        errors.push(
          `Aliasing or passing the ${node.text} API is forbidden; call it directly.`,
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (declaredCaseCount === 0) {
    errors.push("Declare at least one direct test(...) case.");
  }
  if (errors.length > 0) {
    throw new TypeError(
      `${filePath} violates the TAP Rstest source policy:\n- ${[
        ...new Set(errors),
      ].join("\n- ")}`,
    );
  }

  return Object.freeze({ declaredCaseCount });
};

export const assertTapDiscoveryMatchesSource = (
  filePath,
  declaredCaseCount,
  discoveredCaseCount,
) => {
  if (declaredCaseCount !== discoveredCaseCount) {
    throw new TypeError(
      `${filePath} declares ${declaredCaseCount} direct test(...) case(s), ` +
        `but Rstest discovered ${discoveredCaseCount}. Aliased, generated, ` +
        `conditional, or otherwise hidden cases are forbidden.`,
    );
  }
};
