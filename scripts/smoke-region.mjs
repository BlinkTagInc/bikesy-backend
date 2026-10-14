import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';

assert(process.env.BIKESY_API_URL, 'Set BIKESY_API_URL explicitly');
const config = loadConfig();
const fixtures = JSON.parse(readFileSync(new URL('../test/fixtures/smoke-regions.json', import.meta.url)));
const trips = fixtures[config.region] ?? [{ name: 'configured readiness trip', locations: config.readiness.locations }];
const get = async path => {
  const response = await fetch(new URL(path, process.env.BIKESY_API_URL), { signal: AbortSignal.timeout(120000) });
  assert(response.ok, `HTTP ${response.status}: ${path}`);
  const body = await response.json();
  assert(!body.error, `${path}: ${body.error}`);
  return body;
};
assert.equal((await get('/health')).status, 'ok');
assert.deepEqual(await get('/bounds'), config.bounds);
const results = [];
for (const trip of trips) for (const scenario of Object.keys(config.scenarios)) {
  const [a, b] = trip.locations;
  const query = new URLSearchParams({lat1: a.lat, lng1: a.lon, lat2: b.lat, lng2: b.lon, scenario});
  const route = await get('/route?' + query);
  assert(route.path?.[0]?.length && route.directions?.length && route.total_distance > 0, 'Incomplete route');
  assert(route.elevation_profile?.length > 1, 'Missing elevation');
  for (const [i, point] of route.elevation_profile.entries()) {
    assert(point.every(Number.isFinite) && point[1] > -32768, 'Invalid elevation');
    if (i) assert(point[0] >= route.elevation_profile[i-1][0], 'Invalid elevation distance order');
  }
  results.push({name: trip.name, scenario, distance_m: route.total_distance, elevation_samples: route.elevation_profile.length});
}
const evidence = {target: process.env.BIKESY_API_URL, region: config.region, checked_at: new Date().toISOString(), results};
if (process.env.BIKESY_SMOKE_OUTPUT) writeFileSync(process.env.BIKESY_SMOKE_OUTPUT, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
