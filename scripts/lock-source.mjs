import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { listRegionConfigs, validateRegionConfig } from '../src/config.js';
const root = new URL('../', import.meta.url);
const path = new URL('release.json', root);
const release = JSON.parse(readFileSync(path));
// Every region config is an approved runtime config; refuse to lock an invalid one.
const regions = listRegionConfigs(new URL('config/', root));
for (const { path: file, config } of regions) {
  try { validateRegionConfig(config); } catch (error) { throw new Error(`${file}: ${error.message}`); }
}
const names = new Set([
  'serve.mjs',
  ...readdirSync(new URL('src/', root)).filter(name => name.endsWith('.js')).map(name => `src/${name}`),
  ...regions.map(({ region }) => `config/${region}.json`),
]);
const next = Object.fromEntries([...names].map(name => [name,
  createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'),
]));
if (JSON.stringify(next) !== JSON.stringify(release.runtime_files)) {
  release.deployed_baseline_files ??= release.runtime_files;
  release.runtime_files = next;
  release.source_changed_from_deployed = true;
  release.git_deployment_verified = false;
  release.source_updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(release, null, 2) + '\n');
  console.log('Updated source hashes; validate before deploying.');
} else {
  console.log('Source hashes unchanged.');
}
