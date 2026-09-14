import type {
  MiniAppFileHandle,
  MiniAppFileMetadata,
  MiniAppFileWriteReceipt,
} from '@theaiplatform/miniapp-sdk/sdk';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import {
  AttachmentExportError,
  attachmentPickerMimeType,
  attachmentSuggestedName,
  exportAttachment,
  type AttachmentFilesApi,
} from './attachment-export';

const attachment = {
  resourceId: 'attachment_1',
  fileName: 'launch.txt',
  mimeType: 'text/plain',
  sizeBytes: 5,
  disposition: 'attachment' as const,
  contentId: null,
};

const selectedHandle: MiniAppFileHandle = {
  id: 'handle_1',
  revision: 'revision_selected',
  recoverable: false,
  expiresAt: null,
};
const observedHandle: MiniAppFileHandle = {
  ...selectedHandle,
  revision: 'revision_observed',
};
const writtenHandle: MiniAppFileHandle = {
  ...selectedHandle,
  revision: 'revision_written',
};

function filesFixture(events: string[]): AttachmentFilesApi {
  return {
    pickSave: rs.fn(async options => {
      events.push(`pick:${options.suggestedName}`);
      return selectedHandle;
    }),
    metadata: rs.fn(async () => {
      events.push('metadata');
      return {
        name: 'launch.txt',
        mimeType: 'text/plain',
        extension: '.txt',
        byteLength: 0,
        contentHash: null,
        modifiedAt: null,
        revision: 'revision_observed',
        provenance: 'user-selected',
        handle: observedHandle,
      } satisfies MiniAppFileMetadata;
    }),
    write: rs.fn(async (_handle, _bytes, options) => {
      events.push(`write:${options.expectedRevision}:${options.idempotencyKey}`);
      return {
        handle: writtenHandle,
        revision: 'revision_written',
        contentHash: 'sha256:written',
        byteLength: 5,
        committedAt: Date.now(),
        idempotencyKey: options.idempotencyKey,
      } satisfies MiniAppFileWriteReceipt;
    }),
    revoke: rs.fn(async handle => {
      events.push(`revoke:${handle.revision}`);
      return null;
    }),
  };
}

describe('attachment export', () => {
  it('picks a destination before loading and writes against the exact observed revision', async () => {
    const events: string[] = [];
    const phases: string[] = [];
    const files = filesFixture(events);

    await expect(exportAttachment({
      attachment,
      files,
      idempotencyKey: 'attachment-export-1',
      loadAttachment: async () => {
        events.push('load');
        return new TextEncoder().encode('hello');
      },
      onPhase: phase => phases.push(phase),
    })).resolves.toBe('saved');

    expect(events).toEqual([
      'pick:launch.txt',
      'metadata',
      'load',
      'write:revision_observed:attachment-export-1',
      'revoke:revision_written',
    ]);
    expect(phases).toEqual(['choosing', 'loading', 'saving']);
    expect(files.write).toHaveBeenCalledWith(
      observedHandle,
      new TextEncoder().encode('hello'),
      {
        expectedRevision: 'revision_observed',
        idempotencyKey: 'attachment-export-1',
      },
    );
  });

  it('does not load when the picker is cancelled and reports no error', async () => {
    const loadAttachment = rs.fn(async () => new Uint8Array(5));
    const files = filesFixture([]);
    files.pickSave = rs.fn(async () => {
      throw Object.assign(new Error('Cancelled'), {
        name: 'MiniAppHostActionError',
        code: 'file_cancelled',
      });
    });

    await expect(exportAttachment({
      attachment,
      files,
      idempotencyKey: 'attachment-export-2',
      loadAttachment,
    })).resolves.toBe('cancelled');
    expect(loadAttachment).not.toHaveBeenCalled();
    expect(files.revoke).not.toHaveBeenCalled();
  });

  it('rejects unsupported and known oversized exports without fetching bytes', async () => {
    const loadAttachment = rs.fn(async () => new Uint8Array());

    await expect(exportAttachment({
      attachment,
      files: null,
      idempotencyKey: 'unsupported',
      loadAttachment,
    })).rejects.toMatchObject({ code: 'unsupported' } satisfies Partial<AttachmentExportError>);
    await expect(exportAttachment({
      attachment: { ...attachment, sizeBytes: 8 * 1_024 * 1_024 + 1 },
      files: filesFixture([]),
      idempotencyKey: 'too-large',
      loadAttachment,
    })).rejects.toMatchObject({ code: 'too_large' } satisfies Partial<AttachmentExportError>);
    expect(loadAttachment).not.toHaveBeenCalled();
  });

  it('rejects mismatched content and revokes the selected handle', async () => {
    const events: string[] = [];
    const files = filesFixture(events);

    await expect(exportAttachment({
      attachment,
      files,
      idempotencyKey: 'attachment-export-3',
      loadAttachment: async () => new Uint8Array(4),
    })).rejects.toMatchObject({ code: 'content_mismatch' });
    expect(events).toEqual(['pick:launch.txt', 'metadata', 'revoke:revision_observed']);
    expect(files.write).not.toHaveBeenCalled();
  });

  it('sanitizes untrusted suggested names before opening the host picker', () => {
    expect(attachmentSuggestedName('../private\\report\u0000.pdf')).toBe('__private_report_.pdf');
    expect(attachmentSuggestedName('..')).toBe('attachment');
    expect(attachmentSuggestedName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(attachmentSuggestedName('report\u061C\u200E\u200F.pdf')).toBe('report.pdf');
    expect(attachmentSuggestedName(`broken-\ud800-name.txt`)).toBe('broken-�-name.txt');
    expect(attachmentSuggestedName('control-\u0085-name.txt')).toBe('control-_-name.txt');
    expect(new TextEncoder().encode(attachmentSuggestedName('🙂'.repeat(100))).byteLength)
      .toBeLessThanOrEqual(180);
    expect(attachmentPickerMimeType('Text/Plain; charset=UTF-8')).toBe('text/plain');
    expect(attachmentPickerMimeType('not a mime type')).toBe('application/octet-stream');
  });
});
