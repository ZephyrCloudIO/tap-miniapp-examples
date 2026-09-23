import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';
import appPackage from './package.json' with { type: 'json' };

export const emailBuild = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  version: appPackage.version,
  sdkVersion: appPackage.dependencies['@theaiplatform/miniapp-sdk'],
};

/** Extract maps before TAP's report-stage asset lock, after final chunk hashing. */
export function archiveSourceMaps(target: string): RsbuildPlugin {
  return {
    name: 'tap-email:archive-source-maps',
    setup(api) {
      const mapsByEnvironment = new Map<string, { asset: string; sha256: string; map: string }[]>();
      api.processAssets({ stage: 'optimize-transfer' }, async ({ compilation, environment }) => {
        const directory = path.join(api.context.rootPath, '.tap-diagnostics', target);
        const maps: { asset: string; sha256: string; map: string }[] = [];
        for (const asset of compilation.getAssets()) {
          if (!asset.name.endsWith('.map')) continue;
          if (path.isAbsolute(asset.name) || asset.name.split(/[\\/]/u).includes('..')) {
            throw new Error('Refusing an unsafe source map path.');
          }
          const sourceName = asset.name.slice(0, -4);
          const source = compilation.getAsset(sourceName);
          if (!source) throw new Error(`Source map has no matching bundle: ${asset.name}`);
          const destination = path.join(directory, asset.name);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, asset.source.buffer());
          maps.push({
            asset: sourceName,
            sha256: createHash('sha256').update(source.source.buffer()).digest('hex'),
            map: asset.name,
          });
          compilation.deleteAsset(asset.name);
        }
        mapsByEnvironment.set(environment.name, maps);
      });
      api.onAfterEnvironmentCompile(async ({ environment }) => {
        const maps = mapsByEnvironment.get(environment.name) ?? [];
        // TAP normalizes license comments during its report stage. Record final
        // emitted bytes, not the pre-normalization contents used to extract maps.
        for (const map of maps) {
          const bytes = await readFile(path.join(environment.distPath, map.asset));
          map.sha256 = createHash('sha256').update(bytes).digest('hex');
        }
        const directory = path.join(api.context.rootPath, '.tap-diagnostics', target);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'index.json'), JSON.stringify({ ...emailBuild, maps }, null, 2));
      });
    },
  };
}
