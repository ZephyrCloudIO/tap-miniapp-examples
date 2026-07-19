const encoder = new TextEncoder();
const MAX_CLOCK_SKEW_SECONDS = 300;

export interface SignatureInput {
  readonly body: string;
  readonly messageId: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly secret: string;
  readonly nowSeconds?: number;
}

export class WebhookVerificationError extends Error {}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new WebhookVerificationError('Webhook signature is not valid Base64.');
  }
}

function signingKey(secret: string): Uint8Array {
  if (!secret.startsWith('whsec_')) {
    throw new WebhookVerificationError(
      'Webhook signing secret must use the whsec_ format.',
    );
  }
  const decoded = decodeBase64(secret.slice('whsec_'.length));
  if (decoded.byteLength < 16) {
    throw new WebhookVerificationError('Webhook signing secret is invalid.');
  }
  return decoded;
}

function candidateSignatures(header: string): readonly Uint8Array[] {
  return header
    .split(' ')
    .map(value => value.trim())
    .filter(value => value.startsWith('v1,'))
    .map(value => decodeBase64(value.slice(3)));
}

export async function verifyVantaWebhookSignature(
  input: SignatureInput,
): Promise<void> {
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new WebhookVerificationError(
      'Webhook timestamp is invalid or outside the 5-minute replay window.',
    );
  }

  const key = await crypto.subtle.importKey(
    'raw',
    signingKey(input.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signedContent = `${input.messageId}.${input.timestamp}.${input.body}`;
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent)),
  );
  const candidates = candidateSignatures(input.signature);
  const valid = candidates.some(
    candidate =>
      candidate.byteLength === expected.byteLength &&
      crypto.subtle.timingSafeEqual(candidate, expected),
  );
  if (!valid) {
    throw new WebhookVerificationError('Webhook signature verification failed.');
  }
}
