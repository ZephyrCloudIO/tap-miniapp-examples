import {
  isMiniAppHostActionError,
  type MiniAppFileHandle,
  type MiniAppFilesApi,
} from '@theaiplatform/miniapp-sdk/sdk';
import {
  MAXIMUM_DRAFT_ATTACHMENTS,
  MAXIMUM_DRAFT_ATTACHMENT_BYTES,
  MAXIMUM_DRAFT_ATTACHMENT_TOTAL_BYTES,
  type MailDraftAttachment,
} from '@tap-examples/tap-email-protocol';
import { attachmentPickerMimeType, attachmentSuggestedName } from './attachment-export';
import type { StageOutboundAttachmentInput } from './coordinator-client';

export type OutboundAttachmentFilesApi = Pick<
  MiniAppFilesApi,
  'pickOpen' | 'metadata' | 'read' | 'revoke'
>;

export interface SelectAndStageAttachmentsOptions {
  readonly accountId: string;
  readonly draftKey: string;
  readonly existingAttachments: readonly MailDraftAttachment[];
  readonly files?: OutboundAttachmentFilesApi | null;
  readonly idFactory: () => string;
  readonly stageAttachment: (
    input: StageOutboundAttachmentInput,
  ) => Promise<MailDraftAttachment>;
}

export interface SelectAndStageAttachmentsResult {
  readonly attachments: readonly MailDraftAttachment[];
  readonly cancelled: boolean;
  readonly failures: readonly string[];
}

const attachmentMentionPattern = /\b(?:attach(?:ed|ing|ment|ments)|enclos(?:ed|ing|ure))\b/iu;

export function mentionsMissingAttachment(
  bodyText: string,
  attachments: readonly MailDraftAttachment[],
): boolean {
  return attachments.length === 0 && attachmentMentionPattern.test(bodyText);
}

function hostFileErrorMessage(error: unknown): string {
  if (isMiniAppHostActionError(error)) {
    if (error.code === 'file_too_large') return 'The selected file is larger than the host read limit.';
    if (error.code === 'file_denied') return 'TAP Email does not have permission to read the selected file.';
    if (error.code === 'file_stale') return 'The selected file changed before it could be attached. Choose it again.';
    if (error.code === 'file_revoked' || error.code === 'file_unavailable') {
      return 'The selected file is no longer available. Choose it again.';
    }
    if (error.code === 'file_encrypted') return 'The selected file is encrypted and could not be attached.';
    if (error.code === 'file_unsupported') return 'Attaching files is not supported by this TAP host.';
    if (error.code === 'file_malformed') return 'The selected file could not be read safely.';
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === 'attachment_too_large') return 'The selected file is larger than the 8 MiB attachment limit.';
    if (code === 'attachment_stage_expired') return 'The secure attachment upload expired. Choose the file again.';
    if (code === 'attachment_storage_failed') return 'The secure attachment upload could not be stored.';
  }
  return 'The selected file could not be attached.';
}

async function revokeQuietly(
  files: OutboundAttachmentFilesApi,
  handle: MiniAppFileHandle,
): Promise<void> {
  try {
    await files.revoke(handle);
  } catch {
    // An opaque picker handle is already unusable if host revocation fails.
  }
}

/**
 * Reads only explicit host-selected files and immediately stages their bytes.
 * The return value contains immutable attachment descriptors, never handles,
 * native paths, or byte buffers.
 */
export async function selectAndStageAttachments({
  accountId,
  draftKey,
  existingAttachments,
  files,
  idFactory,
  stageAttachment,
}: SelectAndStageAttachmentsOptions): Promise<SelectAndStageAttachmentsResult> {
  if (!files) {
    return {
      attachments: [],
      cancelled: false,
      failures: ['Attaching files is not supported by this TAP host.'],
    };
  }

  let selected: readonly MiniAppFileHandle[];
  try {
    selected = await files.pickOpen({ multiple: true, recoverable: false });
  } catch (error) {
    if (isMiniAppHostActionError(error) && error.code === 'file_cancelled') {
      return { attachments: [], cancelled: true, failures: [] };
    }
    return { attachments: [], cancelled: false, failures: [hostFileErrorMessage(error)] };
  }
  if (selected.length === 0) return { attachments: [], cancelled: true, failures: [] };
  if (selected.length + existingAttachments.length > MAXIMUM_DRAFT_ATTACHMENTS) {
    await Promise.all(selected.map(handle => revokeQuietly(files, handle)));
    return {
      attachments: [],
      cancelled: false,
      failures: [`A draft can contain at most ${MAXIMUM_DRAFT_ATTACHMENTS} attachments.`],
    };
  }

  const attachments: MailDraftAttachment[] = [];
  const failures: string[] = [];
  let totalBytes = existingAttachments.reduce(
    (total, attachment) => total + attachment.sizeBytes,
    0,
  );
  for (const selectedHandle of selected) {
    let revokeHandle = selectedHandle;
    try {
      const metadata = await files.metadata(selectedHandle);
      revokeHandle = metadata.handle;
      const fileName = attachmentSuggestedName(metadata.name);
      if (metadata.byteLength <= 0) {
        failures.push(`${fileName} is empty and was not attached.`);
        continue;
      }
      if (metadata.byteLength > MAXIMUM_DRAFT_ATTACHMENT_BYTES) {
        failures.push(`${fileName} is larger than the 8 MiB attachment limit.`);
        continue;
      }
      if (totalBytes + metadata.byteLength > MAXIMUM_DRAFT_ATTACHMENT_TOTAL_BYTES) {
        failures.push(`${fileName} would exceed the 20 MiB draft attachment limit.`);
        continue;
      }
      const bytes = await files.read(metadata.handle, {
        maxBytes: MAXIMUM_DRAFT_ATTACHMENT_BYTES,
      });
      if (bytes.byteLength !== metadata.byteLength) {
        failures.push(`${fileName} changed while it was being attached. Choose it again.`);
        continue;
      }
      const attachment = await stageAttachment({
        accountId,
        draftKey,
        idempotencyKey: `attachment_${idFactory()}`,
        fileName,
        mimeType: attachmentPickerMimeType(metadata.mimeType ?? ''),
        bytes,
      });
      attachments.push(attachment);
      totalBytes += attachment.sizeBytes;
    } catch (error) {
      failures.push(hostFileErrorMessage(error));
    } finally {
      await revokeQuietly(files, revokeHandle);
    }
  }
  return { attachments, cancelled: false, failures };
}
