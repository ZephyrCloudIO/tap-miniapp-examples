import type {
  MiniAppChannelMessage,
  MiniAppSpecialistConversationPart,
} from "@theaiplatform/miniapp-sdk/sdk";

export interface TimelineCandidate {
  id: string;
  sequence: number | null;
  author: string;
  text: string;
  timestamp: string | null;
}

export interface SummaryDraftFields {
  safeSummary: string;
  themes: string;
  emotionalArc: string;
  privateDetailsRemoved: string;
  candidateConcepts: string;
  exclusions: string;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

const firstText = (value: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const found = text(value[key]);
    if (found) return found;
  }
  return null;
};

const nestedText = (value: unknown, depth = 0): string | null => {
  if (depth > 3) return null;
  const direct = text(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const pieces = value.flatMap((item) => {
      const found = nestedText(item, depth + 1);
      return found ? [found] : [];
    });
    return pieces.length > 0 ? pieces.join("\n") : null;
  }
  if (!record(value)) return null;
  const preferred = firstText(value, ["body", "content", "text", "message", "markdown"]);
  if (preferred) return preferred;
  for (const key of ["messageContent", "parts", "blocks", "payload"] as const) {
    const found = nestedText(value[key], depth + 1);
    if (found) return found;
  }
  return null;
};

const nestedAuthor = (value: Record<string, unknown>): string => {
  const direct = firstText(value, ["authorName", "displayName", "name", "senderName"]);
  if (direct) return direct;
  for (const key of ["author", "sender", "user"] as const) {
    const nested = value[key];
    if (record(nested)) {
      const found = firstText(nested, ["displayName", "name", "preferredUsername"]);
      if (found) return found;
    }
  }
  return "Channel participant";
};

export const extractTimelineCandidates = (messages: MiniAppChannelMessage[]): TimelineCandidate[] => {
  const seen = new Set<string>();
  return messages.flatMap((message, index) => {
    if (!record(message)) return [];
    const content = nestedText(message);
    if (!content) return [];
    const normalized = content.replace(/\s+/gu, " ").trim().slice(0, 4_000);
    if (normalized.length === 0) return [];
    const sequence = number(message.sequence) ?? number(message.sequenceNumber) ?? number(message.index);
    const rawId = firstText(message, ["id", "messageId", "clientMessageId", "eventId"]);
    const id = rawId ?? `sequence-${sequence ?? index}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const rawTimestamp = firstText(message, ["createdAt", "timestamp", "sentAt", "updatedAt"]);
    return [{
      id,
      sequence,
      author: nestedAuthor(message),
      text: normalized,
      timestamp: rawTimestamp,
    }];
  });
};

export const buildSpecialistSummaryPrompt = (
  channelLabel: string,
  sourceWindow: string,
  candidates: readonly TimelineCandidate[],
): string => {
  const excerpts = candidates.map((candidate, index) => ({
    excerpt: index + 1,
    authorLabel: candidate.author,
    text: candidate.text,
  }));
  return [
    "You are preparing a privacy-reviewed draft summary inside TAP for a human-mediated song-brief workflow.",
    "Use only the excerpts below. Do not infer identities, add facts, quote language verbatim, imitate an artist, or produce lyrics.",
    "Treat conflict, grief, personnel matters, credentials, customer data, secrets, harassment, and private project details as ineligible entertainment and describe their removal generically.",
    "Return one JSON object and no prose with exactly these string keys: safeSummary, themes, emotionalArc, privateDetailsRemoved, candidateConcepts, exclusions.",
    `Channel label: ${channelLabel}`,
    `Source window: ${sourceWindow}`,
    `Selected excerpts: ${JSON.stringify(excerpts)}`,
  ].join("\n\n");
};

const emptyDraft = (): SummaryDraftFields => ({
  safeSummary: "",
  themes: "",
  emotionalArc: "",
  privateDetailsRemoved: "",
  candidateConcepts: "",
  exclusions: "Personal data, secrets, credentials, customer names, project codenames, sensitive conflict, and unapproved direct quotations",
});

const stripFence = (value: string): string => value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");

export const parseSpecialistSummary = (value: string): SummaryDraftFields => {
  const fallback = emptyDraft();
  try {
    const parsed = JSON.parse(stripFence(value)) as unknown;
    if (!record(parsed)) return { ...fallback, safeSummary: value.trim() };
    return {
      safeSummary: text(parsed.safeSummary) ?? "",
      themes: text(parsed.themes) ?? "",
      emotionalArc: text(parsed.emotionalArc) ?? "",
      privateDetailsRemoved: text(parsed.privateDetailsRemoved) ?? "",
      candidateConcepts: text(parsed.candidateConcepts) ?? "",
      exclusions: text(parsed.exclusions) ?? fallback.exclusions,
    };
  } catch {
    return { ...fallback, safeSummary: value.trim() };
  }
};

export const specialistResponseText = (parts: readonly MiniAppSpecialistConversationPart[]): string =>
  parts.flatMap((part) => part.type === "text" ? [part.content] : []).join("\n").trim();
