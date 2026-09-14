import type {
  MiniAppFileHandle,
  MiniAppFileMetadata,
} from '@theaiplatform/miniapp-sdk/sdk';
import { describe, expect, it, rstest as rs } from '@rstest/core';
import {
  mentionsMissingAttachment,
  selectAndStageAttachments,
  type OutboundAttachmentFilesApi,
} from './outbound-attachment';

const selectedHandle: MiniAppFileHandle = {
  id: 'handle_1',
  revision: 'selected',
  recoverable: false,
  expiresAt: null,
};
const observedHandle: MiniAppFileHandle = {
  ...selectedHandle,
  revision: 'observed',
};

function metadata(overrides: Partial<MiniAppFileMetadata> = {}): MiniAppFileMetadata {
  return {
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    extension: '.pdf',
    byteLength: 3,
    contentHash: null,
    modifiedAt: null,
    revision: 'observed',
    provenance: 'user-selected',
    handle: observedHandle,
    ...overrides,
  };
}

function files(events: string[]): OutboundAttachmentFilesApi {
  return {
    pickOpen: rs.fn(async options => {
      events.push(`pick:${String(options?.multiple)}:${String(options?.recoverable)}`);
      return [selectedHandle];
    }),
    metadata: rs.fn(async () => {
      events.push('metadata');
      return metadata();
    }),
    read: rs.fn(async (_handle, options) => {
      events.push(`read:${String(options?.maxBytes)}`);
      return Uint8Array.from([0, 128, 255]);
    }),
    revoke: rs.fn(async handle => {
      events.push(`revoke:${handle.revision}`);
      return null;
    }),
  };
}

describe('outbound draft attachments', () => {
  it('reads an explicit host selection, stages it, and returns metadata only', async () => {
    const events: string[] = [];
    const stageAttachment = rs.fn(async input => {
      events.push(`stage:${input.fileName}:${input.mimeType}:${input.bytes.byteLength}`);
      return {
        stageId: 'stage_1',
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256Base64Url: 'A'.repeat(43),
      };
    });

    const result = await selectAndStageAttachments({
      accountId: 'account_1',
      draftKey: 'draft_1',
      existingAttachments: [],
      files: files(events),
      idFactory: () => 'id_1',
      stageAttachment,
    });

    expect(events).toEqual([
      'pick:true:false',
      'metadata',
      `read:${8 * 1_024 * 1_024}`,
      'stage:brief.pdf:application/pdf:3',
      'revoke:observed',
    ]);
    expect(stageAttachment).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account_1',
      draftKey: 'draft_1',
      idempotencyKey: 'attachment_id_1',
      bytes: Uint8Array.from([0, 128, 255]),
    }));
    expect(result).toEqual({
      attachments: [{
        stageId: 'stage_1',
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
        sha256Base64Url: 'A'.repeat(43),
      }],
      cancelled: false,
      failures: [],
    });
    expect(result.attachments[0]).not.toHaveProperty('bytes');
    expect(result.attachments[0]).not.toHaveProperty('handle');
  });

  it('does not read bytes when a selected file exceeds the attachment limit', async () => {
    const fixture = files([]);
    fixture.metadata = rs.fn(async () => metadata({ byteLength: 8 * 1_024 * 1_024 + 1 }));
    const stageAttachment = rs.fn(async () => {
      throw new Error('must not stage');
    });

    const result = await selectAndStageAttachments({
      accountId: 'account_1',
      draftKey: 'draft_1',
      existingAttachments: [],
      files: fixture,
      idFactory: () => 'id_1',
      stageAttachment,
    });

    expect(fixture.read).not.toHaveBeenCalled();
    expect(stageAttachment).not.toHaveBeenCalled();
    expect(result.failures).toEqual(['brief.pdf is larger than the 8 MiB attachment limit.']);
    expect(fixture.revoke).toHaveBeenCalledWith(observedHandle);
  });

  it('treats a cancelled picker as a no-op and detects missing attachment language', async () => {
    const fixture = files([]);
    fixture.pickOpen = rs.fn(async () => {
      throw Object.assign(new Error('cancelled'), {
        name: 'MiniAppHostActionError',
        code: 'file_cancelled',
      });
    });
    await expect(selectAndStageAttachments({
      accountId: 'account_1',
      draftKey: 'draft_1',
      existingAttachments: [],
      files: fixture,
      idFactory: () => 'id_1',
      stageAttachment: async () => {
        throw new Error('must not stage');
      },
    })).resolves.toEqual({ attachments: [], cancelled: true, failures: [] });

    expect(mentionsMissingAttachment('I attached the signed brief.', [])).toBe(true);
    expect(mentionsMissingAttachment('No files are needed.', [])).toBe(false);
    expect(mentionsMissingAttachment('I attached the signed brief.', [{
      stageId: 'stage_1',
      fileName: 'brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 3,
      sha256Base64Url: 'A'.repeat(43),
    }])).toBe(false);
  });
});
