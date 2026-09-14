import { describe, expect, it } from '@rstest/core';
import {
  attachmentPreviewDataUrl,
  attachmentPreviewErrorMessage,
  attachmentPreviewMimeType,
} from './attachment-preview';
import type { EmailAttachment } from './domain';

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tinyPngBytes = Uint8Array.from(
  atob(tinyPngBase64),
  character => character.charCodeAt(0),
);

const imageAttachment: EmailAttachment = {
  resourceId: 'attachment_1',
  fileName: 'image.png',
  mimeType: 'image/png',
  sizeBytes: tinyPngBytes.byteLength,
  disposition: 'inline',
  contentId: 'image@example.com',
};

describe('attachment preview', () => {
  it('creates a bounded data URL for safe raster image types', () => {
    expect(attachmentPreviewMimeType('IMAGE/PNG; charset=binary')).toBe('image/png');
    expect(attachmentPreviewMimeType('image/jpg')).toBe('image/jpeg');
    expect(attachmentPreviewDataUrl(
      imageAttachment,
      tinyPngBytes,
    )).toBe(`data:image/png;base64,${tinyPngBase64}`);
  });

  it('does not preview active, animated, or non-image formats', () => {
    expect(attachmentPreviewMimeType('image/svg+xml')).toBeNull();
    expect(attachmentPreviewMimeType('image/gif')).toBeNull();
    expect(attachmentPreviewMimeType('image/webp')).toBeNull();
    expect(attachmentPreviewMimeType('image/avif')).toBeNull();
    expect(attachmentPreviewMimeType('application/pdf')).toBeNull();
    expect(() => attachmentPreviewDataUrl(
      { ...imageAttachment, mimeType: 'image/svg+xml' },
      Uint8Array.from([1, 2, 3, 4]),
    )).toThrow('Preview is not available for this attachment type.');

    const animatedPng = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10,
      0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0,
    ]);
    expect(() => attachmentPreviewDataUrl(
      { ...imageAttachment, sizeBytes: animatedPng.byteLength },
      animatedPng,
    )).toThrow('Animated images are not available in preview.');
    expect(() => attachmentPreviewDataUrl(
      {
        ...imageAttachment,
        mimeType: 'image/jpeg',
        sizeBytes: animatedPng.byteLength,
      },
      animatedPng,
    )).toThrow('Animated images are not available in preview.');
  });

  it('rejects bytes that do not match the attachment metadata', () => {
    expect(() => attachmentPreviewDataUrl(
      imageAttachment,
      Uint8Array.from([1, 2, 3]),
    )).toThrow('The downloaded attachment did not match its metadata.');
    expect(() => attachmentPreviewDataUrl(
      imageAttachment,
      new Uint8Array(tinyPngBytes.byteLength),
    )).toThrow('The downloaded attachment did not match its metadata.');

    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97]);
    expect(() => attachmentPreviewDataUrl(
      {
        ...imageAttachment,
        mimeType: 'image/jpeg',
        sizeBytes: gifBytes.byteLength,
      },
      gifBytes,
    )).toThrow('The downloaded attachment did not match its metadata.');
  });

  it('keeps provider failures specific without exposing unknown errors', () => {
    expect(attachmentPreviewErrorMessage({ code: 'attachment_not_found' }))
      .toBe('This attachment is no longer available from the mail provider.');
    expect(attachmentPreviewErrorMessage(new Error('private provider detail')))
      .toBe('Could not preview this attachment. Try again.');
  });
});
