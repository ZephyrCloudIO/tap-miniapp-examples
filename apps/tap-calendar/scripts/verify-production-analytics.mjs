import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const schema = 'tap.calendar.public-booking-analytics.v2';
export async function verifyProductionAnalytics({ request = fetch, packageRoot } = {}) {
  const read = async url => {
    const response = await request(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Production analytics check failed: ${url} returned ${response.status}`);
    return response;
  };
  const readiness = await (await read('https://calendar-api.theaiplatform.app/health/booking-analytics')).json();
  if (readiness.ready !== true || readiness.schemaVersion !== schema ||
      !Number.isFinite(Date.parse(readiness.trafficSince)) || !Number.isFinite(Date.parse(readiness.conversionSince))) {
    throw new Error('Deploy the gateway and analytics migrations before publishing the organizer package.');
  }
  const publicOrigin = 'https://cal.with-tap.ai';
  const html = await (await read(publicOrigin)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map(match => new URL(match[1], publicOrigin));
  if (scripts.length === 0 || scripts.some(url => url.origin !== publicOrigin)) {
    throw new Error('Public booking assets could not be verified.');
  }
  const code = (await Promise.all(scripts.map(async url => (await read(url.href)).text()))).join('\n');
  if (!code.includes('/analytics') || !code.includes('visitId')) {
    throw new Error('Deploy the public booking tracker before publishing the organizer package.');
  }
  if (packageRoot) {
    const files = await readdir(packageRoot, { recursive: true });
    const source = (await Promise.all(files.filter(file => /\.(?:js|mjs)$/u.test(file))
      .map(file => readFile(join(packageRoot, file), 'utf8')))).join('\n');
    if (!source.includes('/v2/publications/analytics') || !source.includes('"https://calendar-api.theaiplatform.app".trim()')) {
      throw new Error('The organizer package does not contain production analytics v2.');
    }
  }
  return readiness;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyProductionAnalytics({ packageRoot: resolve(process.argv[2] ?? 'dist') });
  console.log('Verified production analytics migration, gateway, public tracker, and organizer package.');
}
