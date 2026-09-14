import type { EmailAttachment } from './domain';
import { maximumAttachmentExportBytes } from './attachment-export';

const previewableImageMimeTypes = new Map([
  ['image/jpeg', 'image/jpeg'],
  ['image/jpg', 'image/jpeg'],
  ['image/png', 'image/png'],
]);

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function hasSignature(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.byteLength >= signature.byteLength &&
    signature.every((value, index) => bytes[index] === value);
}

export class AttachmentPreviewError extends Error {
  constructor(
    readonly code: 'unsupported' | 'animated' | 'content_mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentPreviewError';
  }
}

export function attachmentPreviewMimeType(mimeType: string): string | null {
  const normalized = mimeType.split(';', 1)[0]!.trim().toLowerCase();
  return previewableImageMimeTypes.get(normalized) ?? null;
}

function isAnimatedPng(bytes: Uint8Array): boolean {
  if (!hasSignature(bytes, pngSignature)) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = pngSignature.byteLength;
  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.byteLength) return false;
    const chunkType = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunkType === 'acTL') return true;
    if (chunkType === 'IEND') return false;
    offset = chunkEnd;
  }
  return false;
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(''));
}

export function attachmentPreviewDataUrl(
  attachment: EmailAttachment,
  bytes: Uint8Array,
): string {
  const mimeType = attachmentPreviewMimeType(attachment.mimeType);
  if (!mimeType) {
    throw new AttachmentPreviewError(
      'unsupported',
      'Preview is not available for this attachment type.',
    );
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength !== attachment.sizeBytes ||
    bytes.byteLength > maximumAttachmentExportBytes
  ) {
    throw new AttachmentPreviewError(
      'content_mismatch',
      'The downloaded attachment did not match its metadata.',
    );
  }
  if (isAnimatedPng(bytes)) {
    throw new AttachmentPreviewError(
      'animated',
      'Animated images are not available in preview.',
    );
  }
  const contentMatchesMimeType = mimeType === 'image/png'
    ? hasSignature(bytes, pngSignature)
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!contentMatchesMimeType) {
    throw new AttachmentPreviewError(
      'content_mismatch',
      'The downloaded attachment did not match its metadata.',
    );
  }
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

export function attachmentPreviewErrorMessage(error: unknown): string {
  if (error instanceof AttachmentPreviewError) return error.message;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === 'offline') {
      return 'Preview is unavailable until the mailbox connection is ready.';
    }
    if (code === 'attachment_too_large') {
      return 'This attachment is larger than the 8 MB preview limit.';
    }
    if (code === 'attachment_not_found') {
      return 'This attachment is no longer available from the mail provider.';
    }
    if (code === 'invalid_response') {
      return 'The downloaded attachment could not be verified for preview.';
    }
  }
  return 'Could not preview this attachment. Try again.';
}
