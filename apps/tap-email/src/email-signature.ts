export const EMAIL_SIGNATURE = 'Sent with TAP Email on The AI Platform';

/** Strip only the exact legacy UI-generated footer, never quoted signatures. */
export function withoutEmailSignature(body: string): string {
  return body.replace(/(?:\r?\n){2}-- \r?\nSent with The AI Platform(?:\r?\n)?$/u, '');
}
