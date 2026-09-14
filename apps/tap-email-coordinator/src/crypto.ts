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
    throw new Error('Encryption key must be base64url encoded.');
  }
  if (raw.byteLength !== 32) {
    throw new Error('Encryption key must decode to exactly 32 bytes.');
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

export async function sha256BytesBase64Url(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
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

/**
 * AES-GCM envelope whose authentication tag also binds the ciphertext to its
 * storage owner. Moving the value to another row, profile, or command kind
 * therefore fails closed even when both rows use the same encryption key.
 */
export async function sealBoundSecret(
  value: string,
  secret: string,
  associatedData: string,
): Promise<string> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(associatedData),
    },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  return `v2.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

/** Versioned AES-GCM envelope for coordinator-owned binary resources. */
export async function sealBytes(
  value: Uint8Array,
  secret: string,
  associatedData: string,
): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(associatedData) },
    await encryptionKey(secret),
    value,
  );
  const payload = new Uint8Array(1 + iv.byteLength + ciphertext.byteLength);
  payload[0] = 1;
  payload.set(iv, 1);
  payload.set(new Uint8Array(ciphertext), 1 + iv.byteLength);
  return payload;
}

export async function openBytes(
  value: Uint8Array,
  secret: string,
  associatedData: string,
): Promise<Uint8Array> {
  if (value.byteLength < 29 || value[0] !== 1) {
    throw new Error('Encrypted bytes have an unsupported format.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: value.subarray(1, 13),
        additionalData: encoder.encode(associatedData),
      },
      await encryptionKey(secret),
      value.subarray(13),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new Error('Encrypted bytes could not be opened.');
  }
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

export async function openBoundSecret(
  value: string,
  secret: string,
  associatedData: string,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split('.');
  if (version !== 'v2' || !encodedIv || !encodedCiphertext) {
    throw new Error('Encrypted bound secret has an unsupported format.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(encodedIv),
        additionalData: encoder.encode(associatedData),
      },
      await encryptionKey(secret),
      base64UrlToBytes(encodedCiphertext),
    );
    return decoder.decode(plaintext);
  } catch {
    throw new Error('Encrypted bound secret could not be opened.');
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
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`Decoded base64url value exceeds ${maximumBytes} bytes.`);
  }
  const decoded = decoder.decode(bytes);
  const normalizedBytes = encoder.encode(decoded);
  if (normalizedBytes.byteLength <= maximumBytes) return decoded;

  // Invalid UTF-8 bytes are replaced with U+FFFD by TextDecoder, which can
  // expand one provider byte into three normalized bytes. Preserve a complete
  // UTF-8 prefix so downstream encryption and D1 bounds still use the declared
  // maximum rather than the potentially inflated replacement text.
  let end = maximumBytes;
  while (end > 0 && (normalizedBytes[end]! & 0xc0) === 0x80) end -= 1;
  return decoder.decode(normalizedBytes.subarray(0, end));
}
