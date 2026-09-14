import { defineTapRstestConfig } from '@theaiplatform/miniapp-sdk/testing/rstest-config';

export default defineTapRstestConfig({
  include: ['tests/e2e/**/*.test.ts', 'tests/e2e/**/*.tap.ts'],
  testTimeout: 30_000,
});
