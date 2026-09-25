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
        serviceBindings: {
          WEBSITE_REFERRALS: { name: 'referral-publisher-test', entrypoint: 'WebsiteReferralsPublisher' },
        },
        workers: [{
          name: 'referral-publisher-test',
          modules: true,
          scriptPath: path.join(import.meta.dirname, 'test/fixtures/referral-publisher.mjs'),
          compatibilityDate: '2026-07-21',
        }],
        bindings: {
          GOOGLE_CLIENT_ID: 'test-google-client.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
          GOOGLE_TOKEN_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          ATTACHMENT_STAGING_ENCRYPTION_KEY: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, 'migrations'),
          ),
        },
      },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
