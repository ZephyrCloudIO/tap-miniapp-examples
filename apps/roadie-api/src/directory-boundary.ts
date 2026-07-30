import { z } from "zod";

const workspaceRoleSchema = z.enum([
  "WORKSPACE_ROLE_OWNER",
  "WORKSPACE_ROLE_ADMIN",
  "WORKSPACE_ROLE_MEMBER",
  "WORKSPACE_ROLE_VIEW_ONLY",
]);

const principalContextSchema = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  membershipId: z.string(),
  userEmailId: z.string(),
  role: workspaceRoleSchema,
  membershipEpoch: z.number(),
  roleEpoch: z.number(),
  directorySequence: z.number(),
});

const workspaceMembershipSchema = z.object({
  membershipId: z.string(),
  workspaceId: z.string(),
  userId: z.string().optional(),
  userEmailId: z.string().optional(),
  invitedEmail: z.string(),
  status: z.enum([
    "WORKSPACE_MEMBERSHIP_STATUS_INVITED",
    "WORKSPACE_MEMBERSHIP_STATUS_JOINED",
    "WORKSPACE_MEMBERSHIP_STATUS_DECLINED",
    "WORKSPACE_MEMBERSHIP_STATUS_REMOVED",
  ]),
  role: workspaceRoleSchema,
  invitedBy: z.string().optional(),
  invitedAt: z.number(),
  joinedAt: z.number().optional(),
  declinedAt: z.number().optional(),
  removedAt: z.number().optional(),
  membershipEpoch: z.number(),
  roleEpoch: z.number(),
  inviteEpoch: z.number(),
});

const publicProfileSchema = z.object({
  userId: z.string(),
  name: z.string().optional(),
  picture: z.string().optional(),
  handle: z.string().optional(),
  title: z.string().optional(),
  timezone: z.string().optional(),
});

export const resolveCanonicalUserResponseSchema = z.object({
  userId: z.string().optional(),
});

export const getPrincipalContextResponseSchema = z.object({
  context: principalContextSchema.optional(),
});

export const listMembersResponseSchema = z.object({
  members: z
    .array(
      z.object({
        membership: workspaceMembershipSchema.optional(),
        profile: publicProfileSchema.optional(),
      }),
    )
    .default([]),
});
