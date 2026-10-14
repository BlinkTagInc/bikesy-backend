import { readFileSync } from 'node:fs';
export function resolveConfigPath(env = process.env) {
  if (env.BIKESY_CONFIG) {
    return env.BIKESY_CONFIG;
  }
  return new URL('../config/sf.json', import.meta.url);
}
// Configured bounds describe the data extraction; the API uses the inset area.
export function deriveBounds(config) {
  const outer = config.bounds;
  const inset = config.bounds_inset ?? 0;
  const result = {};
  for (const key of ['left', 'bottom', 'right', 'top']) {
    const margin = typeof inset === 'number' ? inset : inset?.[key];
    if (!Number.isFinite(outer?.[key]) || !Number.isFinite(margin) || margin < 0) {
      throw new Error('Bounds and nonnegative bounds_inset must be finite degrees');
    }
    const direction = ['left', 'bottom'].includes(key) ? 1 : -1;
    result[key] = Number((outer[key] + direction * margin).toFixed(6));
  }
  if (result.left >= result.right || result.bottom >= result.top) {
    throw new Error('bounds_inset leaves no service area');
  }
  return result;
}

export function loadConfig(env = process.env) {
  const config = JSON.parse(readFileSync(resolveConfigPath(env)));
  if (config.engine_policy && config.engine_policy !== 'bikesy-distance-v1') {
    throw new Error('Invalid engine policy');
  }
  const region = config.region;
  if (typeof region !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(region)) {
    throw new Error('Invalid configured region');
  }
  const b = deriveBounds(config);
  if (!b || !['left', 'bottom', 'right', 'top'].every(k => Number.isFinite(b[k])) ||
      b.left >= b.right || b.bottom >= b.top || b.left < -180 || b.right > 180 || b.bottom < -90 || b.top > 90) {
    throw new Error('Invalid configured bounds');
  }
  const build = config.bounds;
  if (!build || !['left', 'bottom', 'right', 'top'].every(key => Number.isFinite(build[key])) ||
      build.left < -180 || build.right > 180 || build.bottom < -90 || build.top > 90 ||
      build.left > b.left || build.right < b.right || build.bottom > b.bottom || build.top < b.top) {
    throw new Error('Build bounds must contain the service bounds');
  }
  if (!Array.isArray(config.admin_states) || !config.admin_states.length ||
      new Set(config.admin_states).size !== config.admin_states.length ||
      config.admin_states.some(state => !('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')).includes(state))) {
    throw new Error('Invalid admin_states');
  }
  if (!config.scenarios || !Object.hasOwn(config.scenarios, '1')) {
    throw new Error('Missing default scenario');
  }
  for (const options of Object.values(config.scenarios)) {
    for (const key of ['use_hills', 'use_roads']) {
      if (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 1) {
        throw new Error(`Invalid ${key}`);
      }
    }
  }
  const valhallaUrl = env.VALHALLA_URL || 'http://127.0.0.1:8002/';
  const url = new URL(valhallaUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid VALHALLA_URL');
  }
  const timeoutMs = Number(env.VALHALLA_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new Error('Invalid VALHALLA_TIMEOUT_MS');
  }
  const maxConcurrent = Number(env.MAX_CONCURRENT_ROUTES || 16);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 256) {
    throw new Error('Invalid MAX_CONCURRENT_ROUTES');
  }
  const maxQueued = Number(env.MAX_QUEUED_ROUTES ?? 16);
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 256) {
    throw new Error('Invalid MAX_QUEUED_ROUTES');
  }
  const runtimeConfig = { ...config, bounds: b, dataBounds: config.bounds, region };
  readinessRequest(runtimeConfig);
  return { ...runtimeConfig, maxConcurrent, maxQueued, valhallaUrl: valhallaUrl.replace(/\/?$/, '/'), timeoutMs };
}

export function readinessRequest(config) {
  const { locations, scenario } = config.readiness || {};
  if (!Array.isArray(locations) || locations.length !== 2) {
    throw new Error('Readiness requires two locations');
  }
  if (!Object.hasOwn(config.scenarios, scenario)) {
    throw new Error('Readiness scenario is not configured');
  }
  for (const { lat, lon } of locations) {
    const b = config.bounds;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < b.bottom || lat > b.top || lon < b.left || lon > b.right) {
      throw new Error('Readiness location outside routing bounds');
    }
  }
  return {
    locations, costing: 'bicycle', shape_format: 'polyline6',
    costing_options: { bicycle: { bicycle_type: 'Hybrid', ...config.scenarios[scenario], use_ferry: 0 } },
  };
}

export function verifyRegionData(config, lock) {
  if ((lock.region || 'sf') !== config.region) {
    throw new Error('Routing data region differs from application region');
  }
  if (lock.region && !lock.build_config) {
    throw new Error('Data release is missing build settings');
  }
  if (lock.build_config) {
    const expected = lock.build_config;
    if (JSON.stringify(expected.admin_states) !== JSON.stringify(config.admin_states) ||
        ['left', 'bottom', 'right', 'top'].some(key => expected.bounds?.[key] !== config.bounds?.[key])) {
      throw new Error('Build settings differ from data release');
    }
  }
}
