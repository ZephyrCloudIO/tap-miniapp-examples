import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  deleteTripRequestSchema,
  getWorkspaceContextRequestSchema,
  listTripsRequestSchema,
  putTripRequestSchema,
} from "@tap-examples/roadie-contract/zod";
import type { RoadieMember } from "@tap-examples/roadie-contract";

import { authenticateRoadieRequest, requireJoinedWorkspace } from "./auth";
import { listMembersResponseSchema } from "./directory-boundary";
import { deleteTrip, listTrips, putTrip, tripOwner } from "./trips";
import type { RoadieApiEnv } from "./types";

const app = new Hono<{ Bindings: RoadieApiEnv }>();

const ROLE_MAP = {
  WORKSPACE_ROLE_OWNER: "ROADIE_WORKSPACE_ROLE_OWNER",
  WORKSPACE_ROLE_ADMIN: "ROADIE_WORKSPACE_ROLE_ADMIN",
  WORKSPACE_ROLE_MEMBER: "ROADIE_WORKSPACE_ROLE_MEMBER",
  WORKSPACE_ROLE_VIEW_ONLY: "ROADIE_WORKSPACE_ROLE_VIEW_ONLY",
} as const satisfies Readonly<Record<string, RoadieMember["role"]>>;

function canAdministerTrips(role: string): boolean {
  return role === "WORKSPACE_ROLE_OWNER" || role === "WORKSPACE_ROLE_ADMIN";
}

function connectJson(body: unknown): Response {
  return Response.json(body, {
    headers: { "Connect-Protocol-Version": "1" },
  });
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON request" });
  }
}

app.get("/health", (context) => context.json({ ok: true, service: "roadie-api" }));

app.post("/rpc/tap.roadie.v1.RoadieService/GetWorkspaceContext", async (context) => {
  const identity = await authenticateRoadieRequest(context.req.raw, context.env);
  const input = getWorkspaceContextRequestSchema.parse(await requestJson(context.req.raw));
  const principal = await requireJoinedWorkspace(context.env, input.workspaceId, identity);
  const roster = listMembersResponseSchema.parse(
    await context.env.DIRECTORY_API.listMembers({
      workspaceId: input.workspaceId,
      statuses: ["WORKSPACE_MEMBERSHIP_STATUS_JOINED"],
    }),
  );
  const members = roster.members.flatMap((entry): RoadieMember[] => {
    const membership = entry.membership;
    if (!membership?.userId) return [];
    const isCurrentUser = membership.userId === identity.userId;
    const avatarUrl = isCurrentUser
      ? (identity.user.picture ?? entry.profile?.picture)
      : entry.profile?.picture;
    return [
      {
        userId: membership.userId,
        displayName:
          (isCurrentUser ? identity.user.name : undefined) ??
          entry.profile?.name ??
          entry.profile?.handle ??
          membership.invitedEmail,
        ...(avatarUrl ? { avatarUrl } : {}),
        role: ROLE_MAP[membership.role],
      },
    ];
  });
  const currentMember = members.find((member) => member.userId === identity.userId);
  if (!currentMember) {
    throw new HTTPException(409, {
      message: "Joined member missing from workspace roster",
    });
  }
  return connectJson({
    workspaceId: principal.workspaceId,
    currentMember,
    members,
  });
});

app.post("/rpc/tap.roadie.v1.RoadieService/ListTrips", async (context) => {
  const identity = await authenticateRoadieRequest(context.req.raw, context.env);
  const input = listTripsRequestSchema.parse(await requestJson(context.req.raw));
  await requireJoinedWorkspace(context.env, input.workspaceId, identity);
  return connectJson({
    trips: await listTrips(context.env.DB, input.workspaceId, input.ownerUserId),
  });
});

app.post("/rpc/tap.roadie.v1.RoadieService/PutTrip", async (context) => {
  const identity = await authenticateRoadieRequest(context.req.raw, context.env);
  const input = putTripRequestSchema.parse(await requestJson(context.req.raw));
  const principal = await requireJoinedWorkspace(context.env, input.workspaceId, identity);
  if (principal.role === "WORKSPACE_ROLE_VIEW_ONLY") {
    throw new HTTPException(403, { message: "Trip editing is not permitted" });
  }
  if (!input.trip) {
    throw new HTTPException(400, { message: "Trip is required" });
  }
  const existingOwner = await tripOwner(context.env.DB, input.workspaceId, input.trip.tripId);
  if (
    existingOwner !== null &&
    existingOwner !== identity.userId &&
    !canAdministerTrips(principal.role)
  ) {
    throw new HTTPException(403, { message: "Only the trip owner or an admin may edit it" });
  }
  return connectJson({
    trip: await putTrip(context.env.DB, input, existingOwner ?? identity.userId),
  });
});

app.post("/rpc/tap.roadie.v1.RoadieService/DeleteTrip", async (context) => {
  const identity = await authenticateRoadieRequest(context.req.raw, context.env);
  const input = deleteTripRequestSchema.parse(await requestJson(context.req.raw));
  const principal = await requireJoinedWorkspace(context.env, input.workspaceId, identity);
  const existingOwner = await tripOwner(context.env.DB, input.workspaceId, input.tripId);
  if (existingOwner === null) {
    return connectJson({ tripId: input.tripId });
  }
  if (existingOwner !== identity.userId && !canAdministerTrips(principal.role)) {
    throw new HTTPException(403, { message: "Only the trip owner or an admin may delete it" });
  }
  await deleteTrip(context.env.DB, input.workspaceId, input.tripId);
  return connectJson({ tripId: input.tripId });
});

app.onError((error) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof Error && error.name === "ZodError") {
    return new Response("Invalid Roadie request", { status: 400 });
  }
  console.error("[roadie-api] request failed", error);
  return new Response("Roadie service unavailable", { status: 500 });
});

export default app;
