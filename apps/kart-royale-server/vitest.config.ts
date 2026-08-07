import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          // Fast race clock for the suite; the default matches the game (4.4 s).
          COUNTDOWN_MS: '150',
          DISCONNECT_GRACE_SECONDS: '1',
        },
      },
    }),
  ],
});
