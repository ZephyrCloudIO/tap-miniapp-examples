/** JSON keeps attachment bytes available through credential-protected SDK HTTP. */
export const MAXIMUM_ATTACHMENT_DOWNLOAD_BYTES = 8 * 1_024 * 1_024;
// Base64 expands this to 8 MiB; leave room below TAP's 10 MiB HTTP limit.
export const ATTACHMENT_DOWNLOAD_CHUNK_BYTES = 6 * 1_024 * 1_024;
export const MAXIMUM_ATTACHMENT_RESPONSE_BYTES = 9 * 1_024 * 1_024;
export const ATTACHMENT_DOWNLOAD_VERSION = 1;

export interface AttachmentDownloadChunk {
  readonly version: typeof ATTACHMENT_DOWNLOAD_VERSION;
  readonly accountId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly resourceId: string;
  readonly mimeType: string;
  readonly totalSizeBytes: number;
  readonly offset: number;
  readonly sizeBytes: number;
  readonly sha256Base64Url: string;
  readonly bodyBase64: string;
}
