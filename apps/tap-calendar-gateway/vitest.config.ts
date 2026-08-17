import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          LOCAL_DEVELOPMENT: "true",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "migrations"),
          ),
        },
        // Production uses an RPC service binding. Tests run the gateway in
        // LOCAL_DEVELOPMENT mode, so they never call Authz, but workerd still
        // requires every configured service to resolve at startup.
        serviceBindings: {
          AUTHZ_API: () => Response.json(
            { error: "authz_not_available_in_local_tests" },
            { status: 503 },
          ),
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
