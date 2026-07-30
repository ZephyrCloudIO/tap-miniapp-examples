import type { MiniAppHttpApi } from "@theaiplatform/miniapp-sdk";
import {
  createTripResponseSchema,
  getWorkspaceContextResponseSchema,
  listTripsResponseSchema,
} from "@tap-examples/roadie-contract/zod";
import type {
  CreateTripRequest,
  CreateTripResponse,
  GetWorkspaceContextResponse,
  ListTripsResponse,
} from "@tap-examples/roadie-contract";
import type { z } from "zod";

export const ROADIE_API_ORIGIN = "https://tap-roadie-api-dev.zephyrwmf.workers.dev";

async function callRoadie<TSchema extends z.ZodType>(
  http: MiniAppHttpApi | undefined,
  method: string,
  input: unknown,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  if (!http) {
    throw new Error("This TAP host does not provide authenticated HTTP.");
  }
  const response = await http.request(
    {
      method: "POST",
      url: `${ROADIE_API_ORIGIN}/rpc/tap.roadie.v1.RoadieService/${method}`,
      headers: [
        { name: "Content-Type", value: "application/json" },
        { name: "Connect-Protocol-Version", value: "1" },
      ],
      body: JSON.stringify(input),
      timeoutMs: 20_000,
      responseBodyLimitBytes: 1_048_576,
    },
    { credentialRef: "platform-session" },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      response.bodyText?.trim() ||
        `Roadie service returned ${response.status} ${response.statusText}.`,
    );
  }
  if (!response.bodyText) {
    throw new Error("Roadie service returned an empty response.");
  }
  const value: unknown = await new Response(response.bodyText, {
    headers: { "Content-Type": "application/json" },
  }).json();
  return schema.parse(value);
}

export function getWorkspaceContext(
  http: MiniAppHttpApi | undefined,
  workspaceId: string,
): Promise<GetWorkspaceContextResponse> {
  return callRoadie(
    http,
    "GetWorkspaceContext",
    { workspaceId },
    getWorkspaceContextResponseSchema,
  );
}

export function listSharedTrips(
  http: MiniAppHttpApi | undefined,
  workspaceId: string,
): Promise<ListTripsResponse> {
  return callRoadie(http, "ListTrips", { workspaceId }, listTripsResponseSchema);
}

export function createSharedTrip(
  http: MiniAppHttpApi | undefined,
  input: CreateTripRequest,
): Promise<CreateTripResponse> {
  return callRoadie(http, "CreateTrip", input, createTripResponseSchema);
}
