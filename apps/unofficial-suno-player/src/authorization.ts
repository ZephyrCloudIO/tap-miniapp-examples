import { sdk } from "@theaiplatform/miniapp-sdk/sdk";

export const SUNO_PLAYER_VIEW_ACTION = "suno-player.view";

type AuthorizationCheck = (options: {
  readonly actionId: string;
  readonly autonomy: "listen";
}) => Promise<{ readonly allowed: boolean }>;

export async function canViewSunoPlayer(
  check: AuthorizationCheck = (options) => sdk.authorization.check(options),
): Promise<boolean> {
  try {
    return (
      await check({
        actionId: SUNO_PLAYER_VIEW_ACTION,
        autonomy: "listen",
      })
    ).allowed;
  } catch {
    return false;
  }
}
