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
        // The rebuild queue's consumer is this Worker's default export, which calls the real
        // Google API. Tests point the producer at a queue nobody consumes and deliver
        // rebuild batches to a mocked worker themselves.
        queueProducers: {
          CALENDAR_REBUILD_QUEUE: { queueName: "tap-calendar-cache-rebuilds-test-sink" },
        },
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
    // Each file boots workerd and applies the D1 migrations. Avoid competing
    // runtimes starving the provider/cache integration tests on CI runners.
    fileParallelism: false,
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
