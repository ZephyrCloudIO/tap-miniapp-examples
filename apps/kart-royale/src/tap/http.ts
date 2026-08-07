/**
 * Host-mediated REST for the packaged surface: requests to the session server
 * go through `tap.http` with the reserved `platform-session` credential
 * reference, so the host attaches the active TAP account's credential and
 * secret material never enters miniapp JavaScript. The server introspects
 * that credential server-to-server (see apps/kart-royale-server/src/auth.ts).
 */
import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { BridgeError } from './bridge';
import type { RestRequest } from '../net/RaceClient';

export function tapRest(serverUrl: string): RestRequest {
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
        { credentialRef: 'platform-session' },
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
