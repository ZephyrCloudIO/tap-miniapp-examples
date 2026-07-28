export type PlayerStartupView =
  | "awaiting-authority"
  | "confirming-access"
  | "select-channel"
  | "loading"
  | "player";

export interface PlayerStartupState {
  readonly preview: boolean;
  readonly authority: boolean;
  readonly viewAllowed: boolean | null;
  readonly channelId: string;
  readonly loading: boolean;
  readonly hasChannelState: boolean;
}

export function initialPlayerChannelId(
  preview: boolean,
  ambientChannelId?: string,
): string {
  return preview ? "browser-preview-channel" : ambientChannelId?.trim() ?? "";
}

export function hasReadableChannelAccess(access: {
  readonly isParticipant: boolean;
  readonly capabilities: readonly string[];
}): boolean {
  return (
    access.isParticipant &&
    access.capabilities.some((capability) =>
      /read|view|timeline|message:create/iu.test(capability),
    )
  );
}

export function resolvePlayerStartupView(
  state: PlayerStartupState,
): PlayerStartupView {
  if (!state.preview && !state.authority) return "awaiting-authority";
  if (!state.preview && state.viewAllowed === null) {
    return "confirming-access";
  }
  if (!state.channelId) return "select-channel";
  if (state.loading && !state.hasChannelState) return "loading";
  return "player";
}
