import { sdk } from "@theaiplatform/miniapp-sdk/sdk";
import { createCalendarActivitySource } from "./activity-source-runtime";

export const activitySource = createCalendarActivitySource({ get: address => sdk.storage.get(address) });
