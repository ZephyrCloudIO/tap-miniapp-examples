export interface MailboxChangesCheckpoint {
  readonly revision: number;
  readonly bootstrap?: string;
}

/** Another mounted surface committed this change page first. */
export class MailboxChangesSupersededError extends Error {
  constructor() { super('The mailbox change checkpoint has advanced.'); }
}
