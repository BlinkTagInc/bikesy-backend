import { verifyRegionData } from './config.js';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Light mode relies on exhaustive verification of the final immutable image.
// Full mode additionally rehashes all data for mutable/local validation.
export function verifyStartupData({
  appRoot = appDirectory,
  dataRoot = '/data',
  configPath,
  policy,
  region = 'sf',
  mode = 'light',
}) {
  if (!['light', 'full'].includes(mode)) throw Error('Invalid BIKESY_DATA_VERIFICATION; use light or full');
  const release = JSON.parse(readFileSync(resolve(appRoot, 'release.json')));
  const manifest = readFileSync(resolve(dataRoot, 'engine-policy.json'));
  const sourceLock = readFileSync(resolve(appRoot, 'graph/deployed-runtime.lock.json'));
  if (sha(manifest) !== release.data_lock_sha256 || sha(sourceLock) !== release.data_lock_sha256)
    throw Error('Data release manifest mismatch');
  const lock = JSON.parse(manifest);
  if (lock.policy !== 'bikesy-distance-v1' || lock.policy !== policy)
    throw Error('Engine policy version mismatch');
  if (lock.graph_access_policy !== 'bikesy-access-v1' || lock.graph_import_policy !== 'bikesy-import-v2')
    throw Error('Graph policy version mismatch');
  if (lock.stair_policy !== 'counted-stairs-v1') throw Error('Stair policy version mismatch');
  if (lock.engine_sha256 !== release.engine_sha256) throw Error('Engine release identity mismatch');

  if ((release.region || 'sf') !== region || (lock.region || 'sf') !== region) {
    throw Error('Routing data region differs from application region');
  }

  const activeConfig = JSON.parse(readFileSync(configPath));
  verifyRegionData({ ...activeConfig, region }, lock);

  const configHash = sha(readFileSync(configPath));
  const knownConfigs = Object.entries(release.runtime_files)
    .filter(([name]) => name.startsWith('config/') && name.endsWith('.json'));
  if (!knownConfigs.some(([, digest]) => digest === configHash))
    throw Error('Active application config differs from release');
  for (const name of ['valhalla.json', 'admin.sqlite', 'bikesy-policy.bin', 'bikesy-stairs.txt']) {
    if (!Object.hasOwn(lock.files, name)) throw Error('Required data file absent from manifest: ' + name);
  }
  const root = realpathSync(dataRoot) + sep;
  let hashedDataFiles = 0;
  for (const [relative, digest] of Object.entries(lock.files)) {
    if (!/^(?:tiles|elevation)\/[^.][A-Za-z0-9_/. -]+$|^(?:bikesy-policy\.bin|bikesy-stairs\.txt|admin\.sqlite|valhalla\.json)$/.test(relative) || relative.includes('..'))
      throw Error('Invalid policy manifest path');
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid data digest: ' + relative);
    const path = resolve(dataRoot, relative);
    if (!realpathSync(path).startsWith(root)) throw Error('Data path escapes dataset: ' + relative);
    const stat = statSync(path);
    if (!stat.isFile() || stat.size === 0) throw Error('Data file is not a nonempty regular file: ' + relative);
    accessSync(path, constants.R_OK);
    if (mode === 'full' || relative === 'valhalla.json') {
      if (sha(readFileSync(path)) !== digest) throw Error('Engine policy dataset mismatch: ' + relative);
      hashedDataFiles++;
    }
  }
  return { lock, mode, checkedDataFiles: Object.keys(lock.files).length,
    hashedDataFiles, dataManifestSha256: release.data_lock_sha256 };
}
