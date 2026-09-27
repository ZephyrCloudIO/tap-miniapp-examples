import { readFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import path from 'node:path';

const [reportPath, directory] = process.argv.slice(2);
if (!reportPath || !directory) throw new Error('Usage: node scripts/symbolicate-report.mjs <report.json> <map-directory>');
const input = JSON.parse(await readFile(reportPath, 'utf8'));
const reports = Array.isArray(input) ? input : Array.isArray(input.value) ? input.value : [input];
const index = JSON.parse(await readFile(path.join(directory, 'index.json'), 'utf8'));
for (const report of reports) {
  console.log(`Report ${report.id} (${report.source ?? 'surface'}): ${report.error?.name ?? 'Error'}`);
  for (const stack of [report.error?.stack, report.error?.componentStack]) {
    if (typeof stack !== 'string') continue;
    for (const line of stack.split('\n')) {
      const match = /([^\s/()]+\.(?:js|mjs)):(\d+):(\d+)/u.exec(line);
      if (!match) continue;
      const entries = index.maps.filter(entry => path.basename(entry.asset) === match[1]);
      if (entries.length !== 1) { console.log(`  ${match[0]} (matching map unavailable)`); continue; }
      const mapPath = path.resolve(directory, entries[0].map);
      if (!mapPath.startsWith(path.resolve(directory) + path.sep)) throw new Error('Invalid map path.');
      const map = new SourceMap(JSON.parse(await readFile(mapPath, 'utf8')));
      const entry = map.findEntry(Number(match[2]) - 1, Number(match[3]) - 1);
      console.log(entry.originalSource
        ? `  ${entry.originalSource}:${entry.originalLine + 1}:${entry.originalColumn + 1}`
        : `  ${match[0]} (no source mapping)`);
    }
  }
}
