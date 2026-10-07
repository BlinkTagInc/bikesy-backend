import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function verifyRelease({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  image = false,
  dataRoot = '/data',
  enginePath = '/usr/local/bin/valhalla_service',
} = {}) {
  const release = JSON.parse(readFileSync(resolve(root, 'release.json')));
  for (const [name, expected] of Object.entries(release.runtime_files)) {
    if (sha(resolve(root, name)) !== expected) throw Error(`Runtime source differs from release: ${name}`);
  }
  const lockPath = resolve(root, 'graph/deployed-runtime.lock.json');
  if (sha(lockPath) !== release.data_lock_sha256) throw Error('Data lock differs from release');
  if (image) {
    if (sha(resolve(dataRoot, 'engine-policy.json')) !== release.data_lock_sha256)
      throw Error('Base image data release mismatch');
    const lock = JSON.parse(readFileSync(lockPath));
    if (lock.engine_sha256 !== release.engine_sha256) throw Error('Engine release identity mismatch');
    // Always exhaustive, regardless of BIKESY_DATA_VERIFICATION or startup policy.
    for (const [name, expected] of Object.entries(lock.files)) {
      if (name.includes('..') || name.startsWith('/')) throw Error('Unsafe data lock');
      if (sha(resolve(dataRoot, name)) !== expected) throw Error(`Data mismatch: ${name}`);
    }
    if (sha(enginePath) !== release.engine_sha256) throw Error('Engine mismatch');
    console.log(`Verified ${Object.keys(lock.files).length} data files and engine`);
  }
  console.log('Verified runtime source and data release identity');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRelease({ image: process.argv.includes('--image') });
}
