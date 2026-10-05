import { readFileSync } from 'node:fs';
export function loadConfig(env = process.env) {
  const region = env.BIKESY_REGION || 'sf';
  if (!['sf', 'tahoe'].includes(region)) throw new Error('BIKESY_REGION must be sf or tahoe');
  const config = JSON.parse(readFileSync(env.BIKESY_CONFIG || new URL(`../config/${region}.json`, import.meta.url)));
  if (config.engine_policy && config.engine_policy !== 'bikesy-distance-v1') throw new Error('Invalid engine policy');
  const b = config.bounds;
  if (!b || !['left', 'bottom', 'right', 'top'].every(k => Number.isFinite(b[k])) ||
      b.left >= b.right || b.bottom >= b.top || b.left < -180 || b.right > 180 || b.bottom < -90 || b.top > 90) throw new Error('Invalid configured bounds');
  if (!config.scenarios || !Object.hasOwn(config.scenarios, '1')) throw new Error('Missing default scenario');
  for (const options of Object.values(config.scenarios)) {
    for (const key of ['use_hills', 'use_roads']) {
      if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 1) throw new Error(`Invalid ${key}`);
    }
  }
  const valhallaUrl = env.VALHALLA_URL || 'http://127.0.0.1:8002/';
  const url = new URL(valhallaUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid VALHALLA_URL');
  const timeoutMs = Number(env.VALHALLA_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Invalid VALHALLA_TIMEOUT_MS');
  const maxConcurrent = Number(env.MAX_CONCURRENT_ROUTES || 16);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 256) throw new Error('Invalid MAX_CONCURRENT_ROUTES');
  const maxQueued = Number(env.MAX_QUEUED_ROUTES ?? 16);
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 256) throw new Error('Invalid MAX_QUEUED_ROUTES');
  return { ...config, maxConcurrent, maxQueued, valhallaUrl: valhallaUrl.replace(/\/?$/, '/'), timeoutMs };
}
