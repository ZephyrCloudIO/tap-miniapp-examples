import { describe, expect, it } from "@rstest/core";
import {
  hasEngineeringChangeAuthority,
  requireEngineeringChangeAuthority,
} from "./authority";

describe("authority", () => {
  it("grants everything in preview", async () => {
    await expect(
      hasEngineeringChangeAuthority(undefined, true, "changes.propose"),
    ).resolves.toBe(true);
    await expect(
      requireEngineeringChangeAuthority(undefined, true, "policies.manage"),
    ).resolves.toBeUndefined();
  });

  it("fails closed without a mount context outside preview", async () => {
    await expect(
      hasEngineeringChangeAuthority(undefined, false, "changes.propose"),
    ).resolves.toBe(false);
    await expect(
      requireEngineeringChangeAuthority(undefined, false, "findings.disposition"),
    ).rejects.toThrow(/does not allow this miniapp to disposition review findings/u);
  });

  it("names the operation for every action", async () => {
    await expect(
      requireEngineeringChangeAuthority(undefined, false, "changes.review"),
    ).rejects.toThrow(/coordinate change reviews/u);
    await expect(
      requireEngineeringChangeAuthority(undefined, false, "policies.manage"),
    ).rejects.toThrow(/manage assurance policies/u);
    await expect(
      requireEngineeringChangeAuthority(undefined, false, "evidence.capture"),
    ).rejects.toThrow(/capture change evidence/u);
  });
});
