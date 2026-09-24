import manifest from './manifest.tap.json' with { type: 'json' };
import { defineTapMiniapp } from '@theaiplatform/miniapp-sdk/authoring';
import { commandTargetBuilder } from '@theaiplatform/miniapp-sdk/lifecycle';
import { staticContributionProvider } from '../../scripts/tap-miniapp-static-contributions.mjs';

const devCoordinatorOrigin = process.env.TAP_EMAIL_COORDINATOR_ORIGIN ?? 'http://localhost:8787';

const builder = commandTargetBuilder({
  command: 'pnpm',
  args: ['exec', 'rslib', 'build'],
  env: { TAP_EMAIL_COORDINATOR_ORIGIN: devCoordinatorOrigin },
});

const excludedContributionIds = new Set(
  // A UI-only build cannot register the production specialist without its MCP
  // tools, or reuse its version with a different capability manifest.
  manifest.contributions
    .filter(
      contribution =>
        contribution.kind === 'mcp.server' || contribution.kind === 'mcp.tool' ||
        contribution.kind === 'specialist',
    )
    .map(contribution => contribution.id),
);

const desktopManifest = {
  ...manifest,
  contributions: manifest.contributions
    .filter(contribution => !excludedContributionIds.has(contribution.id))
    .map(contribution =>
      contribution.kind === 'ui.surface'
        ? {
            ...contribution,
            authorization: {
              ...contribution.authorization,
              effects: contribution.authorization.effects.map(effect =>
                effect.kind === 'external-network'
                  ? {
                      ...effect,
                      resources: [...new Set([...effect.resources, devCoordinatorOrigin])],
                    }
                  : effect,
              ),
            },
          }
        : contribution.kind === 'miniapp'
        ? {
            ...contribution,
            options: {
              ...contribution.options,
              contributionIds: contribution.options.contributionIds.filter(
                id => !excludedContributionIds.has(id),
              ),
            },
          }
        : contribution,
    ),
};

export default defineTapMiniapp({
  versionLabel: manifest.versionLabel,
  presentation: {
    ...manifest.presentation,
    name: 'TAP Email (Local Dev)',
    slug: 'tap-email-local-dev',
    categories: ['other'],
  },
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
  },
  contributions: [staticContributionProvider(desktopManifest)],
  events: manifest.events,
  runtimePolicy: manifest.runtimePolicy,
});
