import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, resolveConfigPath, readinessRequest, deriveBounds } from '../src/config.js';
import { parseQuery } from '../src/adapter.js';
import { verifyStartupData } from '../src/verify-startup.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('explicit US region config supports a new slug while rejecting unsafe identities', () => {
  const root = mkdtempSync(join(tmpdir(), 'bikesy-custom-region-'));
  try {
    const config = JSON.parse(readFileSync(new URL('../config/sf.json', import.meta.url)));
    config.region = 'custom-us'; config.admin_states = ['OR', 'WA'];
    const file = join(root, 'region.json');
    writeFileSync(file, JSON.stringify(config));
    assert.equal(loadConfig({ BIKESY_CONFIG: file }).region, 'custom-us');
    for (const region of ['../sf', 'SF', '', 'x'.repeat(49)]) {
      writeFileSync(file, JSON.stringify({ ...config, region }));
      assert.throws(() => loadConfig({ BIKESY_CONFIG: file }), /region/);
    }
    writeFileSync(file, JSON.stringify({ ...config, admin_states: ['ZZ'] }));
    assert.throws(() => loadConfig({ BIKESY_CONFIG: file }), /admin_states/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SF remains default; explicit config takes precedence; each region probes a valid scenario', () => {
  assert.equal(loadConfig({}).region, 'sf');
  assert.match(String(resolveConfigPath({ BIKESY_CONFIG: 'config/tahoe.json' })), /tahoe.json$/);
  assert.match(String(resolveConfigPath({ BIKESY_CONFIG: 'custom.json' })), /custom.json$/);
  for (const region of ['sf', 'tahoe']) {
    const config = loadConfig({ BIKESY_CONFIG: `config/${region}.json` });
    const probe = readinessRequest(config);
    const [a, b] = probe.locations;
    const query = new URLSearchParams({ lat1: a.lat, lng1: a.lon, lat2: b.lat, lng2: b.lon, scenario: config.readiness.scenario });
    assert.doesNotThrow(() => parseQuery(query, config));
    assert.equal(probe.costing_options.bicycle.use_roads, config.scenarios[config.readiness.scenario].use_roads);
    assert.equal(probe.costing_options.bicycle.use_ferry, 0);
    assert.ok(config.dataBounds.left <= config.bounds.left);
    assert.ok(config.dataBounds.right >= config.bounds.right);
    assert.ok(config.dataBounds.bottom <= config.bounds.bottom);
    assert.ok(config.dataBounds.top >= config.bounds.top);
  }
  assert.throws(() => readinessRequest({ ...loadConfig({}), readiness: { locations: loadConfig({}).readiness.locations, scenario: '10' } }), /scenario/);
  const tahoe = loadConfig({ BIKESY_CONFIG: 'config/tahoe.json' });
  assert.throws(() => readinessRequest({ ...tahoe, readiness: loadConfig({}).readiness }), /scenario/);
  const query = new URLSearchParams('lat1=39.1&lng1=-120.39&lat2=39.11&lng2=-120.38&scenario=1');
  assert.doesNotThrow(() => parseQuery(query, tahoe));
});

test('startup binds region and build settings to data, rejecting SF data for Tahoe in both modes', () => {
  const root = mkdtempSync(join(tmpdir(), 'bikesy-region-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'graph'));
    mkdirSync(join(root, 'config'));
    const config = readFileSync(new URL('../config/tahoe.json', import.meta.url));
    const parsed = JSON.parse(config);
    writeFileSync(join(root, 'config/tahoe.json'), config);
    const files = {};
    for (const name of ['valhalla.json', 'admin.sqlite', 'bikesy-policy.bin', 'bikesy-stairs.txt']) {
      writeFileSync(join(root, 'data', name), 'fixture');
      files[name] = hash('fixture');
    }
    const lock = {
      region: 'tahoe', build_config: { bounds: parsed.bounds, admin_states: parsed.admin_states }, policy: 'bikesy-distance-v1',
      graph_access_policy: 'bikesy-access-v1', graph_import_policy: 'bikesy-import-v2',
      stair_policy: 'counted-stairs-v1', engine_sha256: 'fixture-engine', files,
    };
    function save(region) {
      lock.region = region;
      const manifest = JSON.stringify(lock);
      writeFileSync(join(root, 'data/engine-policy.json'), manifest);
      writeFileSync(join(root, 'graph/deployed-runtime.lock.json'), manifest);
      writeFileSync(join(root, 'release.json'), JSON.stringify({
        region: 'tahoe', data_lock_sha256: hash(manifest), engine_sha256: lock.engine_sha256,
        runtime_files: { 'config/tahoe.json': hash(config) },
      }));
    }
    const options = { appRoot: root, dataRoot: join(root, 'data'), configPath: join(root, 'config/tahoe.json'), region: 'tahoe', policy: lock.policy };
    save('tahoe');
    for (const mode of ['light', 'full']) {
      assert.equal(verifyStartupData({ ...options, mode }).checkedDataFiles, 4);
    }
    save('sf');
    for (const mode of ['light', 'full']) {
      assert.throws(() => verifyStartupData({ ...options, mode }), /region differs/);
    }
    save('tahoe');
    parsed.admin_states = ['CA'];
    writeFileSync(join(root, 'config/tahoe.json'), JSON.stringify(parsed));
    assert.throws(() => verifyStartupData(options), /Build settings differ/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('one configured area derives unchanged service bounds and supports uniform insets', () => {
  assert.deepEqual(loadConfig({ BIKESY_CONFIG: 'config/sf.json' }).bounds,
    { left: -123.029, bottom: 37.3064, right: -121.637, top: 38.317 });
  assert.deepEqual(loadConfig({ BIKESY_CONFIG: 'config/tahoe.json' }).bounds,
    { left: -120.399814, bottom: 38.750276, right: -119.659482, top: 39.368232 });
  const bounds = { left: -121, bottom: 38, right: -119, top: 40 };
  assert.deepEqual(deriveBounds({ bounds, bounds_inset: 0.1 }),
    { left: -120.9, bottom: 38.1, right: -119.1, top: 39.9 });
  assert.deepEqual(deriveBounds({ bounds }), bounds);
  assert.throws(() => deriveBounds({ bounds, bounds_inset: -1 }), /nonnegative/);
  assert.throws(() => deriveBounds({ bounds, bounds_inset: 1 }), /no service area/);
});

test('local env file selects Tahoe and an existing environment config takes precedence', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const directory = mkdtempSync(join(tmpdir(), 'bikesy-env-'));
  try {
    const envFile = join(directory, '.env');
    writeFileSync(envFile, `BIKESY_CONFIG=${fileURLToPath(new URL('../config/tahoe.json', import.meta.url))}\n`);
    const env = { ...process.env };
    delete env.BIKESY_CONFIG;
    const script = `import { loadConfig } from ${JSON.stringify(new URL('../src/config.js', import.meta.url).href)}; console.log(loadConfig().region);`;
    const args = [`--env-file-if-exists=${envFile}`, '--input-type=module', '-e', script];
    assert.equal(execFileSync(process.execPath, args, { env, encoding: 'utf8' }).trim(), 'tahoe');
    env.BIKESY_CONFIG = fileURLToPath(new URL('../config/sf.json', import.meta.url));
    assert.equal(execFileSync(process.execPath, args, { env, encoding: 'utf8' }).trim(), 'sf');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
