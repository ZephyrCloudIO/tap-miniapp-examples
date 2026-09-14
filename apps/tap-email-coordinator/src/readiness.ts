import { encryptionSecretIsValid } from './crypto';

export interface CoordinatorReadiness {
  readonly ready: boolean;
  readonly configuration: boolean;
  readonly database: boolean;
  readonly issueCodes: readonly string[];
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validRedirect(value: string, allowDevelopment: boolean): boolean {
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'https:' || (allowDevelopment && loopback && url.protocol === 'http:');
  } catch {
    return false;
  }
}

function validOrigins(value: string, allowDevelopment: boolean): boolean {
  const origins = value.split(',').map(origin => origin.trim()).filter(Boolean);
  if (origins.length === 0 || origins.length > 20) return false;
  return origins.every(origin => {
    try {
      const url = new URL(origin);
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      return (
        url.origin === origin &&
        (url.protocol === 'https:' || (allowDevelopment && loopback && url.protocol === 'http:'))
      );
    } catch {
      return false;
    }
  });
}

export async function coordinatorReadiness(env: Env): Promise<CoordinatorReadiness> {
  const issueCodes: string[] = [];
  const allowDevelopment = env.ALLOW_DEV_IDENTITY === 'true';
  if (env.ALLOW_DEV_IDENTITY !== 'true' && env.ALLOW_DEV_IDENTITY !== 'false') {
    issueCodes.push('invalid_identity_mode');
  }
  if (!allowDevelopment && !validHttpsUrl(env.TAP_INTROSPECTION_URL)) {
    issueCodes.push('invalid_introspection_url');
  }
  if (!validOrigins(env.ALLOWED_ORIGINS, allowDevelopment)) {
    issueCodes.push('invalid_allowed_origins');
  }
  if (!env.GOOGLE_CLIENT_ID.trim()) issueCodes.push('missing_google_client_id');
  if (!env.GOOGLE_CLIENT_SECRET.trim()) issueCodes.push('missing_google_client_secret');
  if (!validRedirect(env.GOOGLE_REDIRECT_URI, allowDevelopment)) {
    issueCodes.push('invalid_google_redirect_uri');
  }
  if (!(await encryptionSecretIsValid(env.GOOGLE_TOKEN_ENCRYPTION_KEY))) {
    issueCodes.push('invalid_encryption_key');
  }
  if (!(await encryptionSecretIsValid(env.ATTACHMENT_STAGING_ENCRYPTION_KEY))) {
    issueCodes.push('invalid_attachment_staging_encryption_key');
  }
  if (
    typeof env.COMMAND_QUEUE?.send !== 'function' ||
    typeof env.SYNC_QUEUE?.send !== 'function'
  ) {
    issueCodes.push('missing_queue_binding');
  }
  if (
    typeof env.ATTACHMENT_STAGING?.get !== 'function' ||
    typeof env.ATTACHMENT_STAGING?.put !== 'function' ||
    typeof env.ATTACHMENT_STAGING?.delete !== 'function'
  ) {
    issueCodes.push('missing_attachment_staging_binding');
  }
  const configuration = issueCodes.length === 0;
  let database = false;
  try {
    const result = await env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>();
    database = result?.ready === 1;
  } catch {
    database = false;
  }
  if (!database) issueCodes.push('database_unavailable');
  return {
    ready: configuration && database,
    configuration,
    database,
    issueCodes,
  };
}
