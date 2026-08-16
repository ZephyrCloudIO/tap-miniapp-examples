import type { WorkerEntrypoint } from "cloudflare:workers";
import type { PlatformSessionIdentity } from "@theaiplatform/miniapp-sdk/auth/server";

type DirectoryRpcMethods = {
  resolveCanonicalUser(input: unknown): Promise<unknown>;
  getPrincipalContext(input: unknown): Promise<unknown>;
  listMembers(input: unknown): Promise<unknown>;
};

type DirectoryRpcService = WorkerEntrypoint<unknown> & DirectoryRpcMethods;

export type RoadieApiEnv = {
  DB: D1Database;
  DIRECTORY_API: Service<DirectoryRpcService>;
  ENVIRONMENT: string;
  TAP_MINIAPP_SESSION_ISSUER: string;
};

export type RoadieSessionIdentity = PlatformSessionIdentity;

export type RoadieRequestIdentity = RoadieSessionIdentity & {
  userId: string;
};
