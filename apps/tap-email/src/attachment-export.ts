import {
  isMiniAppHostActionError,
  type MiniAppFileHandle,
  type MiniAppFilesApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import type { EmailAttachment } from './domain';

export const maximumAttachmentExportBytes = 8 * 1_024 * 1_024;

export type AttachmentExportPhase = 'choosing' | 'loading' | 'saving';
export type AttachmentExportResult = 'saved' | 'cancelled';

export type AttachmentFilesApi = Pick<
  MiniAppFilesApi,
  'pickSave' | 'metadata' | 'write' | 'revoke'
>;

export class AttachmentExportError extends Error {
  constructor(
    readonly code: 'unsupported' | 'too_large' | 'content_mismatch' | 'offline',
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentExportError';
  }
}

export interface AttachmentExportOptions {
  readonly attachment: EmailAttachment;
  readonly files?: AttachmentFilesApi | null;
  readonly idempotencyKey: string;
  readonly loadAttachment: () => Promise<Uint8Array>;
  readonly onPhase?: (phase: AttachmentExportPhase) => void;
}

function isCancelled(error: unknown): boolean {
  return isMiniAppHostActionError(error) && error.code === 'file_cancelled';
}

export function attachmentSuggestedName(fileName: string): string {
  const normalized = Array.from(fileName.normalize('NFC'), sourceCharacter => {
    const codePoint = sourceCharacter.codePointAt(0)!;
    if (
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return '';
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return '\ufffd';
    return /[\\/\u0000-\u001f\u007f-\u009f]/u.test(sourceCharacter) ? '_' : sourceCharacter;
  }).join('').trim();
  if (!normalized || normalized === '.' || normalized === '..') return 'attachment';
  const cleaned = normalized
    .replace(/\.{2,}/gu, '_')
    .replace(/[.\s]+$/gu, '');
  if (!cleaned) return 'attachment';

  let bounded = '';
  let bytes = 0;
  for (const character of cleaned) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (bytes + characterBytes > 180) break;
    bounded += character;
    bytes += characterBytes;
  }
  return bounded || 'attachment';
}

export function attachmentPickerMimeType(mimeType: string): string {
  const normalized = mimeType.split(';', 1)[0]!.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(normalized)
    ? normalized
    : 'application/octet-stream';
}

/**
 * Exports only after the trusted host has returned a user-selected save handle.
 * Downloading is deliberately lazy so viewing a message never fetches bytes.
 */
export async function exportAttachment({
  attachment,
  files,
  idempotencyKey,
  loadAttachment,
  onPhase,
}: AttachmentExportOptions): Promise<AttachmentExportResult> {
  if (!files) {
    throw new AttachmentExportError(
      'unsupported',
      'Saving attachments is not supported by this TAP host.',
    );
  }
  if (attachment.sizeBytes > maximumAttachmentExportBytes) {
    throw new AttachmentExportError(
      'too_large',
      'This attachment is larger than the 8 MB download limit.',
    );
  }
  const fileApi: AttachmentFilesApi = files;

  let revokeHandle: MiniAppFileHandle | null = null;
  try {
    onPhase?.('choosing');
    const selected = await fileApi.pickSave({
      suggestedName: attachmentSuggestedName(attachment.fileName),
      mimeType: attachmentPickerMimeType(attachment.mimeType),
      recoverable: false,
    });
    revokeHandle = selected;

    const metadata = await fileApi.metadata(selected);
    revokeHandle = metadata.handle;

    onPhase?.('loading');
    const bytes = await loadAttachment();
    if (
      bytes.byteLength !== attachment.sizeBytes ||
      bytes.byteLength > maximumAttachmentExportBytes
    ) {
      throw new AttachmentExportError(
        'content_mismatch',
        'The downloaded attachment did not match its metadata.',
      );
    }

    onPhase?.('saving');
    const receipt = await fileApi.write(metadata.handle, bytes, {
      expectedRevision: metadata.revision,
      idempotencyKey,
    });
    revokeHandle = receipt.handle;
    return 'saved';
  } catch (error) {
    if (isCancelled(error)) return 'cancelled';
    throw error;
  } finally {
    if (revokeHandle) {
      try {
        await fileApi.revoke(revokeHandle);
      } catch {
        // The selected handle is already unusable if revocation itself fails.
      }
    }
  }
}

export function attachmentExportErrorMessage(error: unknown): string {
  if (error instanceof AttachmentExportError) return error.message;
  if (isMiniAppHostActionError(error)) {
    if (error.code === 'file_unsupported') {
      return 'Saving attachments is not supported by this TAP host.';
    }
    if (error.code === 'file_too_large') {
      return 'This attachment is larger than the host file limit.';
    }
    if (error.code === 'file_denied') {
      return 'TAP Email does not have permission to save this attachment.';
    }
    if (error.code === 'user-gesture-required') {
      return 'Select Retry to open the Save dialog.';
    }
    if (error.code === 'file_stale') {
      return 'The selected file changed before it could be saved. Choose it again.';
    }
    if (error.code === 'file_quota_exceeded') {
      return 'The selected location does not have enough space for this attachment.';
    }
    if (error.code === 'file_unavailable' || error.code === 'file_revoked') {
      return 'The selected save location is no longer available.';
    }
    if (error.code === 'file_malformed' || error.code === 'file_encrypted') {
      return 'The selected destination cannot be overwritten.';
    }
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === 'attachment_too_large') {
      return 'This attachment is larger than the 8 MB download limit.';
    }
    if (code === 'attachment_not_found') {
      return 'This attachment is no longer available from the mail provider.';
    }
  }
  return 'Could not save this attachment. Try again.';
}
