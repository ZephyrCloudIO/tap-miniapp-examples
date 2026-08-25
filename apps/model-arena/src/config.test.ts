import { describe, expect, it } from "@rstest/core";
import { getSessionStorageKey } from "./config";

describe("session storage scope", () => {
  it("isolates local ledgers by workspace and user", () => {
    const first = getSessionStorageKey("workspace-a", "user-a");
    expect(getSessionStorageKey("workspace-b", "user-a")).not.toBe(first);
    expect(getSessionStorageKey("workspace-a", "user-b")).not.toBe(first);
  });

  it("encodes scope delimiters without collisions", () => {
    expect(getSessionStorageKey("workspace:a", "user")).not.toBe(
      getSessionStorageKey("workspace", "a:user"),
    );
  });
});
