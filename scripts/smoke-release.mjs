import{readFileSync,writeFileSync}from'node:fs';import assert from'node:assert/strict';
// Override BIKESY_API_URL only when intentionally testing a local/Preview backend.
assert(process.env.BIKESY_API_URL,'Set BIKESY_API_URL explicitly; this is the SF golden regression suite');
const base=process.env.BIKESY_API_URL.replace(/\/$/,'');let healthy=false;
for(let i=0;i<120;i++){try{const r=await fetch(base+'/health');healthy=r.ok}catch{}if(healthy)break;await new Promise(r=>setTimeout(r,250))}assert(healthy,'readiness');
const health=await fetch(base+'/health');assert.equal(health.headers.get('x-bikesy-engine-sha256'),'82c32a1218531ac87de394699791212e32989147f3c17b705140cbac35fa755d');assert.equal(health.headers.get('x-bikesy-stair-policy'),'counted-stairs-v1');
const rows=JSON.parse(readFileSync(new URL('../test/fixtures/release-smoke.json',import.meta.url)));for(const r of rows){const p=r.points,q=new URLSearchParams({lat1:p[0],lng1:p[1],lat2:p[2],lng2:p[3],scenario:r.scenario});const v=await fetch(base+'/route?'+q).then(x=>x.json());for(const k of['path','directions','total_distance','route_warnings'])assert.deepEqual(v[k],r.payload[k],r.case+' '+k);assert(v.elevation_profile?.length>1)}
console.log(JSON.stringify({passed:true,routes:rows.length,engineAndStairHeaders:true,exactPayloadFields:['path','directions','total_distance','route_warnings'],nativeElevationPresent:true}));
