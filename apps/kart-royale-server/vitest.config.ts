import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const TEST_TICKET_SECRET = 'vitest-only-ticket-secret';
process.env.TICKET_SECRET ??= TEST_TICKET_SECRET;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ALLOW_DEV_IDENTITY: 'true',
          TICKET_SECRET: TEST_TICKET_SECRET,
          // Fast race clock for the suite; the default matches the game (4.4 s).
          COUNTDOWN_MS: '150',
          DISCONNECT_GRACE_SECONDS: '1',
        },
      },
    }),
  ],
});
