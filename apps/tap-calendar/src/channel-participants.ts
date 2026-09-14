import { createSdk07ChannelParticipantsCapability } from "./channel-participants-sdk07-compat";

export interface TapChannelParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly kind: "human";
}

export interface TapChannelParticipantsResult {
  readonly participants: readonly TapChannelParticipant[];
}

export interface TapChannelParticipantsCapability {
  getParticipants(input: {
    readonly channelId: string;
  }): TapChannelParticipantsResult | Promise<TapChannelParticipantsResult>;
}

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

const isTapChannelParticipant = (
  value: unknown,
): value is TapChannelParticipant => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    typeof Reflect.get(value, "id") === "string" &&
    Reflect.get(value, "id").trim().length > 0 &&
    typeof Reflect.get(value, "displayName") === "string" &&
    Reflect.get(value, "displayName").trim().length > 0 &&
    isNullableString(Reflect.get(value, "email")) &&
    isNullableString(Reflect.get(value, "avatarUrl")) &&
    Reflect.get(value, "kind") === "human"
  );
};

export function channelParticipantsCapability(
  channels: unknown,
  mountedHostOrigin?: string,
): TapChannelParticipantsCapability | null {
  if (typeof channels === "object" && channels !== null) {
    const getParticipants = Reflect.get(channels, "getParticipants");
    if (typeof getParticipants === "function") {
      return {
        getParticipants: input => getParticipants.call(channels, input) as
          | TapChannelParticipantsResult
          | Promise<TapChannelParticipantsResult>,
      };
    }
  }
  if (!mountedHostOrigin) return null;
  return createSdk07ChannelParticipantsCapability(mountedHostOrigin) as
    TapChannelParticipantsCapability | null;
}

export async function loadChannelParticipants(
  capability: TapChannelParticipantsCapability,
  channelId: string,
): Promise<readonly TapChannelParticipant[]> {
  const result: unknown = await capability.getParticipants({ channelId });
  const participants = typeof result === "object" && result !== null
    ? Reflect.get(result, "participants")
    : undefined;
  if (!Array.isArray(participants) || !participants.every(isTapChannelParticipant)) {
    throw new Error("TAP returned an invalid channel participant roster.");
  }

  const unique = new Map<string, TapChannelParticipant>();
  for (const participant of participants) {
    if (unique.has(participant.id)) continue;
    unique.set(participant.id, {
      ...participant,
      id: participant.id.trim(),
      displayName: participant.displayName.trim(),
      email: participant.email?.trim().toLowerCase() || null,
      avatarUrl: participant.avatarUrl?.trim() || null,
    });
  }
  return [...unique.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  );
}

export function channelInviteCandidates(
  participants: readonly TapChannelParticipant[],
  organizerId: string | undefined,
): readonly TapChannelParticipant[] {
  return organizerId
    ? participants.filter(participant => participant.id !== organizerId)
    : participants;
}
