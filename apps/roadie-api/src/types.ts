import type { WorkerEntrypoint } from "cloudflare:workers";

type DirectoryRpcMethods = {
  resolveCanonicalUser(input: unknown): Promise<unknown>;
  getPrincipalContext(input: unknown): Promise<unknown>;
  listMembers(input: unknown): Promise<unknown>;
};

type DirectoryRpcService = WorkerEntrypoint<unknown> & DirectoryRpcMethods;

export type RoadieApiEnv = {
  AUTH0_AUDIENCE: string;
  AUTH0_DOMAIN: string;
  DB: D1Database;
  DIRECTORY_API: Service<DirectoryRpcService>;
  ENVIRONMENT: string;
};

export type RoadieRequestIdentity = {
  userId: string;
};
