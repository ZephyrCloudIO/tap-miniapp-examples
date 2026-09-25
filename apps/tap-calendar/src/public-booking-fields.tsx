import * as React from "react";
import { Button, Field, FieldDescription, FieldLabel, Input, Textarea } from "@theaiplatform/miniapp-sdk/ui";
import { UserPlus, X } from "lucide-react";
import { MAX_ADDITIONAL_GUESTS, MAX_BOOKING_NOTES_LENGTH } from "./public-booking-details";
import "./public-booking-fields.css";

export interface AdditionalGuestField {
  readonly id: string;
  readonly email: string;
}

export function PublicBookingExtraFields({ notes, additionalGuests, disabled, onNotesChange, onGuestsChange }: {
  readonly notes: string;
  readonly additionalGuests: readonly AdditionalGuestField[];
  readonly disabled: boolean;
  readonly onNotesChange: (notes: string) => void;
  readonly onGuestsChange: (guests: AdditionalGuestField[]) => void;
}) {
  return <>
    <div className="public-booking-guests">
      {additionalGuests.length > 0 ? (
        <div id="public-booking-guest-list" className="public-booking-guest-list">
          <p className="public-booking-guest-help">Invite up to {MAX_ADDITIONAL_GUESTS} guests. They’ll receive a calendar invitation when the meeting is confirmed.</p>
          {additionalGuests.map((guest, index) => (
            <Field key={guest.id}>
              <FieldLabel htmlFor={`public-booking-guest-${guest.id}`}>Guest {index + 1} email</FieldLabel>
              <div className="public-booking-guest-row">
                <Input id={`public-booking-guest-${guest.id}`} type="email" autoComplete="off" spellCheck={false} maxLength={320} value={guest.email} placeholder="guest@example.com" autoFocus disabled={disabled} onChange={event => {
                  const value = event.currentTarget.value;
                  onGuestsChange(additionalGuests.map(item => item.id === guest.id ? { ...item, email: value } : item));
                }} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove guest ${index + 1}`} disabled={disabled} onClick={() => onGuestsChange(additionalGuests.filter(item => item.id !== guest.id))}><X aria-hidden="true" /></Button>
              </div>
            </Field>
          ))}
        </div>
      ) : null}
      {additionalGuests.length < MAX_ADDITIONAL_GUESTS ? <Button type="button" variant="ghost" className="public-booking-add-guests" disabled={disabled} onClick={() => onGuestsChange([...additionalGuests, { id: crypto.randomUUID(), email: "" }])}><UserPlus aria-hidden="true" />{additionalGuests.length ? "Add another guest" : "Add guests"}</Button> : null}
    </div>
    <Field>
      <FieldLabel htmlFor="public-booking-notes">Additional notes <span className="public-booking-optional">(optional)</span></FieldLabel>
      <Textarea id="public-booking-notes" name="notes" rows={3} maxLength={MAX_BOOKING_NOTES_LENGTH} value={notes} placeholder="Share anything that will help prepare for our meeting." disabled={disabled} aria-describedby="public-booking-notes-help" onChange={event => onNotesChange(event.currentTarget.value)} />
      <FieldDescription id="public-booking-notes-help">Notes are included in the calendar invitation and visible to attendees.</FieldDescription>
    </Field>
  </>;
}

export function PublicBookingPrivacyNotice() {
  return <p className="public-booking-privacy-notice">To learn how your booking information is handled, read The AI Platform’s <a href="https://theaiplatform.app/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>;
}
