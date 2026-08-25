const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function randomBytes(length: number): Uint8Array {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return value;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = base64UrlToBytes(secret);
  } catch {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must be base64url encoded.');
  }
  if (raw.byteLength !== 32) {
    throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptionSecretIsValid(secret: string): Promise<boolean> {
  try {
    await encryptionKey(secret);
    return true;
  } catch {
    return false;
  }
}

export function secureRandomToken(byteLength = 32): string {
  return bytesToBase64Url(randomBytes(byteLength));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function sealSecret(value: string, secret: string): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openSecret(value: string, secret: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new Error('Encrypted credential has an unsupported format.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(encodedIv) },
      await encryptionKey(secret),
      base64UrlToBytes(encodedCiphertext),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error('Encrypted credential could not be opened.');
  }
}

export function encodeBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

export function encodeBase64(value: string): string {
  return bytesToBase64(encoder.encode(value));
}

export function decodeBase64Url(value: string, maximumBytes: number): string {
  const bytes = base64UrlToBytes(value);
  if (bytes.byteLength > maximumBytes) return decoder.decode(bytes.slice(0, maximumBytes));
  return decoder.decode(bytes);
}
