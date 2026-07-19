import path from 'node:path';
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, 'migrations'),
          ),
          VANTA_WEBHOOK_SECRET:
            'whsec_dGVzdC13ZWJob29rLXNlY3JldC0zMi1ieXRlcy1sb25n',
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
