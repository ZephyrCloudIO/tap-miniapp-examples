/** Matches the comma-separated address format emitted by recipient completion. */
export function recipientError(fields: { readonly to: string; readonly cc: string; readonly bcc: string }): string | null {
  if (!fields.to.trim()) return 'Add a To recipient.';
  for (const field of ['to', 'cc', 'bcc'] as const) {
    const value = fields[field].trim();
    if (!value) continue;
    if (value.length > 2_000 || /[\r\n]/u.test(value) || !value.split(',').every(item => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(item.trim()))) {
      return `Check ${field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'}: use email addresses separated by commas.`;
    }
  }
  return null;
}
