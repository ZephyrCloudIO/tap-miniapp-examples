const expectedEntryKeys = ["file", "name", "type"];

const describeEntry = (index) => `Rstest JSON entry ${index}`;

const assertNonEmptyString = (value, field, index) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `${describeEntry(index)}.${field} must be a non-empty string.`,
    );
  }
};

/**
 * Parse the pinned Rstest 0.11.3 `list --json` contract.
 *
 * Discovery is part of the repository's test inventory, so unexpected runner
 * output must fail closed instead of silently changing the reported case count.
 */
export const parseRstestListJson = (stdout) => {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new TypeError(
      `Rstest discovery did not emit valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (!Array.isArray(value)) {
    throw new TypeError("Rstest discovery JSON must be an array.");
  }

  const identities = new Set();
  const entries = value.map((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`${describeEntry(index)} must be an object.`);
    }

    const actualKeys = Object.keys(entry).sort();
    if (
      actualKeys.length !== expectedEntryKeys.length ||
      actualKeys.some((key, keyIndex) => key !== expectedEntryKeys[keyIndex])
    ) {
      throw new TypeError(
        `${describeEntry(index)} must contain exactly: ${expectedEntryKeys.join(
          ", ",
        )}. Received: ${actualKeys.join(", ") || "(none)"}.`,
      );
    }

    assertNonEmptyString(entry.file, "file", index);
    assertNonEmptyString(entry.name, "name", index);
    if (entry.type !== "case") {
      throw new TypeError(
        `${describeEntry(index)}.type must be exactly "case".`,
      );
    }

    const identity = `${entry.file}\0${entry.name}`;
    if (identities.has(identity)) {
      throw new TypeError(
        `${describeEntry(index)} duplicates test case ${JSON.stringify(
          entry.name,
        )} in ${JSON.stringify(entry.file)}.`,
      );
    }
    identities.add(identity);

    return Object.freeze({
      file: entry.file,
      name: entry.name,
      type: entry.type,
    });
  });

  return Object.freeze(entries);
};
