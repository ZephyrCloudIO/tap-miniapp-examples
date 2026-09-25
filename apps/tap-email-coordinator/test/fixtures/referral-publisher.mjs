import { WorkerEntrypoint } from 'cloudflare:workers';

// Exercise the real named-entrypoint transport without publishing a live link.
export class WebsiteReferralsPublisher extends WorkerEntrypoint {
  async publishTapEmailLink(input) {
    if (Object.keys(input).sort().join(',') !== 'acceptedCommandId,referrerUserId,referrerWorkspaceId' ||
        input.referrerUserId !== 'rpc_user' || input.referrerWorkspaceId !== 'rpc_workspace') {
      throw new Error('Unexpected publisher attribution');
    }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.acceptedCommandId));
    const token = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
    return {
      referralId: `referral_${token}`,
      url: `https://theaiplatform.app/refer/${token}?utm_source=tap_email&utm_medium=email&utm_campaign=sent_with&utm_content=signature`,
    };
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
