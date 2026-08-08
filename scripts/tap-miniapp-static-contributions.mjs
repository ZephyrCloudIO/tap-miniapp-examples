import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const STATIC_CONTRIBUTION_DIRECTORIES = ["schemas", "skills", "specialists"];

async function collectFiles(projectRoot, relativeDirectory, files) {
  const directory = path.join(projectRoot, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(projectRoot, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Static TAP package input ${relativePath} must not be a symlink.`);
    }
    if (metadata.isDirectory()) {
      await collectFiles(projectRoot, relativePath, files);
    } else if (metadata.isFile()) {
      files.push({ path: relativePath, contents: await readFile(absolutePath), kind: "asset" });
    }
  }
}

/**
 * Bridges the repository's checked-in descriptor contributions into the SDK
 * 0.7 authoring compiler while their logical source migration remains
 * intentionally reviewable in each example.
 */
export function staticContributionProvider(manifest) {
  return {
    id: "tap.examples-static-contributions",
    async provide(release) {
      const files = [];
      for (const directory of STATIC_CONTRIBUTION_DIRECTORIES) {
        await collectFiles(release.projectRoot, directory, files);
      }
      return { contributions: manifest.contributions, files };
    },
  };
}
