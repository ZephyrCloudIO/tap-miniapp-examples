export const MAX_BOOKING_NOTES_LENGTH = 2_000;
export const MAX_ADDITIONAL_GUESTS = 10;

export interface PublicBookingDetails {
  readonly notes?: string;
  readonly additionalGuests?: readonly string[];
}

/** Omit empty fields so requests made before these fields existed keep their hash. */
export function normalizePublicBookingDetails(
  input: { readonly notes?: unknown; readonly additionalGuests?: unknown },
  primaryEmail: string,
): PublicBookingDetails {
  if (input.notes !== undefined &&
    (typeof input.notes !== "string" || input.notes.length > MAX_BOOKING_NOTES_LENGTH)) {
    throw new Error(`Keep additional notes to ${MAX_BOOKING_NOTES_LENGTH.toLocaleString("en-US")} characters or fewer.`);
  }
  if (input.additionalGuests !== undefined &&
    (!Array.isArray(input.additionalGuests) || input.additionalGuests.length > MAX_ADDITIONAL_GUESTS)) {
    throw new Error(`You can invite up to ${MAX_ADDITIONAL_GUESTS} additional guests.`);
  }
  const emails: unknown[] = Array.isArray(input.additionalGuests) ? input.additionalGuests : [];
  const additionalGuests = new Set<string>();
  for (const value of emails) {
    if (typeof value !== "string") throw new Error("Enter a valid email address for each additional guest.");
    const email = value.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(email)) {
      throw new Error("Enter a valid email address for each additional guest.");
    }
    if (email !== primaryEmail.trim().toLowerCase()) additionalGuests.add(email);
  }
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  return {
    ...(notes ? { notes } : {}),
    ...(additionalGuests.size ? { additionalGuests: [...additionalGuests].sort() } : {}),
  };
}

/** Google Calendar descriptions accept HTML; guest text must remain literal text. */
export function publicBookingDescription(description: string, guestName: string, notes?: string): string {
  const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return [description, notes ? `Additional notes from ${escapeHtml(guestName)}:\n${escapeHtml(notes)}` : ""]
    .filter(Boolean).join("\n\n");
}
