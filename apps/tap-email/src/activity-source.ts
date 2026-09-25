import { sdk } from '@theaiplatform/miniapp-sdk/sdk';
import { createEmailActivitySource } from './activity-source-runtime';

// This expose's only export is the SDK activity ABI. Host access stays lazy.
export const activitySource = createEmailActivitySource({ get: address => sdk.storage.get(address) });
