import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createHandler } from './src/server.js';
import { loadConfig } from './src/config.js';
import { createStageElevationHandler } from './src/stage-elevation.js';
import { createStartupTiming } from './src/startup-timing.js';
const instance = randomUUID();
const startup = createStartupTiming({ instance });
const config = loadConfig();
if (config.engine_policy === 'bikesy-distance-v1') {
  const lock = startup.measureSync('data_verification', () => {
    const lock = JSON.parse(readFileSync('/data/engine-policy.json'));
    if (lock.policy !== config.engine_policy) throw Error('Engine policy version mismatch');
    for (const [relative, sha] of Object.entries(lock.files)) {
      if (!/^(?:tiles|elevation)\/[^.][A-Za-z0-9_/. -]+$|^(?:bikesy-policy\.bin|bikesy-stairs\.txt|admin\.sqlite|valhalla\.json)$/.test(relative) || relative.includes('..')) throw Error('Invalid policy manifest path');
      if (createHash('sha256').update(readFileSync('/data/' + relative)).digest('hex') !== sha) throw Error('Engine policy dataset mismatch: ' + relative);
    }
    return lock;
  });
  startup.measureSync('engine_verification', () => {
    if (createHash('sha256').update(readFileSync('/usr/local/bin/valhalla_service')).digest('hex') !== lock.engine_sha256) throw Error('Engine binary mismatch');
  });
  if (lock.stair_policy !== 'counted-stairs-v1') throw Error('Stair policy version mismatch');
  process.env.BIKESY_POLICY_DATA = '/data/bikesy-policy.bin';
  process.env.BIKESY_STAIRS_DATA = '/data/bikesy-stairs.txt';
  console.log(JSON.stringify({event:'engine_policy_verified',instance,policy:lock.policy,graphAccessPolicy:lock.graph_access_policy,engineSha256:lock.engine_sha256,verifiedDataFiles:Object.keys(lock.files).length}));
}
const start = performance.now();
const finishEngineReadiness = startup.phase('engine_readiness');
const engine = spawn('valhalla_service', ['/data/valhalla.json', '1'], { stdio: 'inherit' });
function memorySample(reason) {
  const number = path => { try { const n = Number(readFileSync(path, 'utf8').trim()); return Number.isFinite(n) ? n : null; } catch { return null; } };
  let enginePeakRssBytes = null;
  try { const m = readFileSync(`/proc/${engine.pid}/status`, 'utf8').match(/^VmHWM:\s+(\d+) kB/m); if (m) enginePeakRssBytes = Number(m[1]) * 1024; } catch {}
  console.log(JSON.stringify({ event: 'resource_sample', instance, sampleId: randomUUID(), reason,
    nodeRssBytes: process.memoryUsage().rss, enginePeakRssBytes,
    cgroupCurrentBytes: number('/sys/fs/cgroup/memory.current'), cgroupPeakBytes: number('/sys/fs/cgroup/memory.peak'),
    cgroupLimitBytes: number('/sys/fs/cgroup/memory.max') }));
}
let memoryTimer;
let stopping = false;
let server;
let exitCode = 0;
function stop(code = 0) {
  if (stopping) return;
  memorySample('stopping');
  stopping = true;
  exitCode = code;
  server?.close();
  engine.kill('SIGTERM');
  setTimeout(() => { engine.kill('SIGKILL'); process.exit(exitCode); }, 25000).unref();
}
engine.on('error', e => { console.error(e.message); stop(1); });
engine.on('exit', (code, signal) => {
  console.log(JSON.stringify({ event: 'engine_exit', instance, code, signal }));
  if (!stopping) { exitCode = 1; server?.close(); }
  process.exit(exitCode);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop());
const deadline = performance.now() + 45000;
let ready = false;
while (!stopping && performance.now() < deadline) {
  try {
    const response = await fetch(`${config.valhallaUrl}status`, { signal: AbortSignal.timeout(1000) });
    if (response.ok && (await response.json()).version) {
      finishEngineReadiness();
      const route = await startup.measure('route_probe', async () => {
        const probe = { locations: [{lat:37.77201183539485,lon:-122.45188647879988},{lat:37.761314357988724,lon:-122.42157490354151}], costing:'bicycle', costing_options:{bicycle:{bicycle_type:'Hybrid',...config.scenarios['8']}}, shape_format:'polyline6' };
        const routeResponse = await fetch(`${config.valhallaUrl}route`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(probe), signal:AbortSignal.timeout(5000) });
        const route = await routeResponse.json();
        if (!routeResponse.ok || !route.trip?.legs?.[0]?.shape) throw Error('Readiness route failed');
        return route;
      });
      await startup.measure('elevation_probe', async () => {
        const heightResponse = await fetch(`${config.valhallaUrl}height`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({encoded_polyline:route.trip.legs[0].shape,shape_format:'polyline6',range:true,resample_distance:100}), signal:AbortSignal.timeout(5000) });
        const height = await heightResponse.json();
        if (!heightResponse.ok || !height.range_height?.length || height.range_height.some(p=>!Number.isFinite(p[1]))) throw Error('Readiness DEM failed');
      });
      ready = true; break;
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { finishEngineReadiness('failed'); console.error('Valhalla readiness failed'); stop(1); }
else if (!stopping) {
  const port = Number(process.env.PORT || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { stop(1); }
  else {
    const finishHttpReady = startup.phase('http_ready');
    const apiHandler = createHandler(config);
    const stageElevation = createStageElevationHandler(config);
    const stageHtml = readFileSync('/app/stage.html');
    server = http.createServer({ requestTimeout: 30000, headersTimeout: 10000 }, (req, res) => {
      res.setHeader('x-bikesy-policy', config.engine_policy || 'stock');
      if(config.engine_policy){const p=JSON.parse(readFileSync('/data/engine-policy.json'));res.setHeader('x-bikesy-graph-policy',p.graph_access_policy);res.setHeader('x-bikesy-engine-sha256',p.engine_sha256);res.setHeader('x-bikesy-import-policy',p.graph_import_policy);res.setHeader('x-bikesy-stair-policy',p.stair_policy);}
      if (['GET', 'HEAD'].includes(req.method) && ['/stage', '/stage/'].includes(req.url.split('?')[0])) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(req.method === 'HEAD' ? undefined : stageHtml);
        return;
      }
      if (req.url.split('?')[0] === '/stage/elevation') return stageElevation(req, res);
      return apiHandler(req, res);
    });
    memorySample('ready');
    server.on('request', (_req, res) => res.once('finish', () => { clearTimeout(memoryTimer); memoryTimer = setTimeout(() => memorySample('after_requests'), 250); memoryTimer.unref(); }));
    server.on('error', e => { finishHttpReady('failed'); console.error(e.message); stop(1); });
    server.listen(port, '0.0.0.0', () => {
      finishHttpReady();
      console.log(JSON.stringify({ event: 'ready', ...startup.summary(), milliseconds: performance.now() - start, port }));
    });
  }
}
