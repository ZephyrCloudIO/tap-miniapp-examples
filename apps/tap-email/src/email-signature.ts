export const EMAIL_SIGNATURE = 'Sent with The AI Platform';
const signatureSuffix = `\n\n-- \n${EMAIL_SIGNATURE}`;
const signatureEnding = /(?:\r?\n){2}-- \r?\nSent with The AI Platform(?:\r?\n)?$/u;

/** Keep our generated signature out of the editable body when reopening it. */
export function withoutEmailSignature(bodyText: string): string {
  return bodyText.replace(signatureEnding, '');
}

/** Applied at the UI's draft/send boundary, never on each editor change. */
export function withEmailSignature(bodyText: string): string {
  if (!bodyText.trim() || signatureEnding.test(bodyText)) return bodyText;
  return `${bodyText}${signatureSuffix}`;
}
