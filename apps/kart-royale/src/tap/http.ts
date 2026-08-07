/**
 * Host-mediated REST for the packaged surface: requests to the session server
 * go through `tap.http`. Production requests use the reserved
 * `platform-session` credential reference, so the host attaches the active TAP
 * account's credential and secret material never enters miniapp JavaScript.
 * The exact local Wrangler origin uses the Worker's explicit development
 * identity mode instead. Production JWTs are verified against TAP's Auth0
 * issuer and audience (see kart-royale-server/auth.ts).
 */
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { BridgeError } from './bridge';
import type { RestRequest } from '../net/RaceClient';

/**
 * Only a bare HTTP IPv4-loopback origin with an explicit non-default port may
 * use the local Worker's body identity. Similar-looking hosts, paths, and
 * production URLs continue through the platform-session credential path.
 */
export function isLocalWranglerOrigin(serverUrl: string): boolean {
  try {
    const parsed = new URL(serverUrl);
    const bareOrigin = serverUrl === parsed.origin || serverUrl === `${parsed.origin}/`;
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && parsed.port.length > 0
      && bareOrigin;
  } catch {
    return false;
  }
}

export function tapRest(serverUrl: string): RestRequest {
  const requestOptions = isLocalWranglerOrigin(serverUrl)
    ? undefined
    : { credentialRef: 'platform-session' as const };
  return async (path, init) => {
    const http = sdk.http;
    if (!http) throw new BridgeError('unavailable', 'TAP host http is unavailable');
    try {
      const res = await http.request(
        {
          method: init.method,
          url: `${serverUrl}${path}`,
          headers: init.body !== undefined
            ? [{ name: 'content-type', value: 'application/json' }]
            : undefined,
          body: init.body !== undefined ? JSON.stringify(init.body) : null,
        },
        requestOptions,
      );
      return {
        status: res.status,
        body: res.bodyText ? JSON.parse(res.bodyText) : null,
      };
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error instanceof SyntaxError) {
        throw new BridgeError('invalid', 'session server returned malformed JSON');
      }
      throw new BridgeError('operation', `host http failed: ${String(error)}`);
    }
  };
}
