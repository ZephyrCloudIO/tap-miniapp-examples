import manifest from './manifest.tap.json' with { type: 'json' };
import { defineTapMiniapp } from '@theaiplatform/miniapp-sdk/authoring';
import { commandTargetBuilder } from '@theaiplatform/miniapp-sdk/lifecycle';
import { zephyrPublisher } from '@zephyrcloudio/miniapp-zephyr-publisher';
import { staticContributionProvider } from '../../scripts/tap-miniapp-static-contributions.mjs';

const builder = commandTargetBuilder({
  command: 'pnpm',
  args: ['exec', 'rslib', 'build'],
});

export default defineTapMiniapp({
  versionLabel: manifest.versionLabel,
  presentation: manifest.presentation,
  compatibility: { tapHost: manifest.compatibility.tapHost },
  targets: {
    desktop: {
      remoteName: manifest.targets.desktop.remoteName,
      exposes: {
        './tap/lifecycle': {
          source: './src/lifecycle.ts',
          runtime: 'webview',
        },
        './ui/desktop': { source: './src/surface.tsx', runtime: 'webview' },
      },
      builder,
    },
    quickjs: {
      remoteName: manifest.targets.quickjs.remoteName,
      exposes: {
        './activity/tap-email-committed-actions': { source: './src/activity-source.ts', runtime: 'quickjs' },
        './mcp/tap-email-mcp': {
          source: './src/mcp.ts',
          runtime: 'quickjs',
        },
      },
      builder,
    },
  },
  contributions: [staticContributionProvider(manifest)],
  events: manifest.events,
  runtimePolicy: manifest.runtimePolicy,
  publisher: zephyrPublisher({
    coordinates: {
      organization: 'zephyrcloudio',
      project: 'tap-miniapp-examples',
      application: 'tap-email',
    },
  }),
});
