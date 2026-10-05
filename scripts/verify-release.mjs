import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const release=JSON.parse(readFileSync(resolve(root,'release.json')));
for(const [name,expected] of Object.entries(release.runtime_files)) {
 if(sha(resolve(root,name))!==expected)throw Error(`Runtime source differs from release: ${name}`);
}
const lockPath=resolve(root,'graph/deployed-runtime.lock.json');
if(sha(lockPath)!==release.data_lock_sha256)throw Error('Data lock differs from release');
if(process.argv.includes('--image')) {
 if(sha('/data/engine-policy.json')!==release.data_lock_sha256)throw Error('Base image data release mismatch');
 const lock=JSON.parse(readFileSync(lockPath));
 for(const [name,expected] of Object.entries(lock.files)) {
  if(name.includes('..')||name.startsWith('/'))throw Error('Unsafe data lock');
  if(sha('/data/'+name)!==expected)throw Error(`Data mismatch: ${name}`);
 }
 if(sha('/usr/local/bin/valhalla_service')!==release.engine_sha256)throw Error('Engine mismatch');
 console.log(`Verified ${Object.keys(lock.files).length} data files and engine`);
}
console.log('Verified deployed runtime source and data release identity');
