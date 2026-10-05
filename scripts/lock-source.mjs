import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
const path=new URL('../release.json',import.meta.url),r=JSON.parse(readFileSync(path));
const next=Object.fromEntries(Object.keys(r.runtime_files).map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')]));
if(JSON.stringify(next)!==JSON.stringify(r.runtime_files)) {
 r.deployed_baseline_files??=r.runtime_files;
 r.runtime_files=next;r.source_changed_from_deployed=true;
 r.git_deployment_verified=false;r.source_updated_at=new Date().toISOString();
 writeFileSync(path,JSON.stringify(r,null,2)+'\n');
 console.log('Updated source hashes; validate this new revision before deploying.');
} else console.log('Source hashes unchanged.');
