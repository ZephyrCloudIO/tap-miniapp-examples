import { describe, expect, it, rstest } from "@rstest/core";
import {
  SUNO_PLAYER_VIEW_ACTION,
  canViewSunoPlayer,
} from "./authorization";

describe("canViewSunoPlayer", () => {
  it("checks the exact descriptor-declared view action", async () => {
    const check = rstest.fn(async () => ({ allowed: true }));

    await expect(canViewSunoPlayer(check)).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith({
      actionId: SUNO_PLAYER_VIEW_ACTION,
      autonomy: "listen",
    });
  });

  it("fails closed for a denial or an unavailable authorization host", async () => {
    await expect(
      canViewSunoPlayer(async () => ({ allowed: false })),
    ).resolves.toBe(false);
    await expect(
      canViewSunoPlayer(async () => {
        throw new Error("host unavailable");
      }),
    ).resolves.toBe(false);
  });
});
