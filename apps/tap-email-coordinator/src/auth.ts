export interface ProfileIdentity {
  readonly profileId: string;
}

export type TapEmailAction = 'tap-email.view' | 'tap-email.manage';

/** Stable platform-session audience for this package and its coordinator. */
export const tapEmailSessionAudience = 'tap_pkg_examples_tap_email_0001';

export type AccessVerifier = (
  request: Request,
  env: Env,
  requiredAction: TapEmailAction,
) => Promise<ProfileIdentity>;

export class AccessError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const safeProfileId = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const maxIntrospectionBytes = 16_384;

async function readBoundedText(
  response: Response,
  maximum: number,
): Promise<string> {
  const declared = Number(response.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > maximum) {
    throw new AccessError(502, 'introspection_invalid', 'Session response is too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maximum) {
      await reader.cancel('response too large');
      throw new AccessError(502, 'introspection_invalid', 'Session response is too large.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

export const verifyPlatformSession: AccessVerifier = async (
  request,
  env,
  requiredAction,
) => {
  if (env.ALLOW_DEV_IDENTITY === 'true' && !env.TAP_INTROSPECTION_URL) {
    const profileId = request.headers.get('X-TAP-Dev-Profile')?.trim() ?? '';
    if (!safeProfileId.test(profileId)) {
      throw new AccessError(
        401,
        'development_identity_required',
        'Supply a valid local development profile.',
      );
    }
    return { profileId };
  }

  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 8_192) {
    throw new AccessError(401, 'session_required', 'A TAP platform session is required.');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(env.TAP_INTROSPECTION_URL);
  } catch {
    throw new AccessError(
      503,
      'introspection_unavailable',
      'Session introspection is not configured.',
    );
  }
  if (endpoint.protocol !== 'https:') {
    throw new AccessError(
      503,
      'introspection_unavailable',
      'Session introspection must use HTTPS.',
    );
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audience: tapEmailSessionAudience,
        requiredAction,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AccessError(
      503,
      'introspection_unavailable',
      'Session introspection did not complete.',
    );
  }
  if (!response.ok) {
    throw new AccessError(403, 'session_denied', 'The TAP session is not authorized.');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(response, maxIntrospectionBytes));
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError(502, 'introspection_invalid', 'Session response is invalid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AccessError(502, 'introspection_invalid', 'Session response is invalid.');
  }
  const result = payload as Readonly<Record<string, unknown>>;
  if (
    result.active !== true ||
    typeof result.profileId !== 'string' ||
    !safeProfileId.test(result.profileId) ||
    result.audience !== tapEmailSessionAudience ||
    !Array.isArray(result.grantedActions) ||
    !result.grantedActions.every(action => typeof action === 'string') ||
    !result.grantedActions.includes(requiredAction)
  ) {
    throw new AccessError(
      403,
      'session_denied',
      'The TAP session is not authorized for this email action.',
    );
  }
  return { profileId: result.profileId };
};
