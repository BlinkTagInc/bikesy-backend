import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/adapter.js';
import { loadConfig } from '../src/config.js';
import { encode } from '../src/polyline.js';

const config = loadConfig({ MAX_CONCURRENT_ROUTES: '2' });
const latitude = n => Number((37.789281 + n / 1e6).toFixed(6));
const query = (n = 0) => new URLSearchParams({ lat1: String(latitude(n)), lng1: '-122.460942', lat2: '37.780126', lng2: '-122.444334', scenario: String(n % 9 + 1) });
const shape = encode([[37.789281, -122.460942], [37.785, -122.46], [37.780126, -122.444334]], 6);
const trip = { trip: { status: 0, units: 'kilometers', summary: { length: 2.34 }, legs: [{ shape, maneuvers: [{ type: 1, begin_shape_index: 0 }] }] } };
const height = { encoded_polyline: shape, range_height: [[0, 82.86], [483.17, 45], [1962.76, 60]] };
const json = data => new Response(JSON.stringify(data));
const tick = () => new Promise(resolve => setImmediate(resolve));

function controlledEngine() {
  const calls = [], pending = [];
  let active = 0, peak = 0, open = false;
  return {
    calls, pending,
    get peak() { return peak; },
    open() { open = true; for (const p of pending.splice(0)) p.resolve(); },
    fetch: async (url, options) => {
      if (String(url).endsWith('/height')) { active--; return json(height); }
      calls.push(JSON.parse(options.body).locations[0].lat);
      peak = Math.max(peak, ++active);
      try {
        if (!open) await new Promise((resolve, reject) => pending.push({ resolve, reject }));
        options.signal.throwIfAborted();
        return json(trip);
      } catch (error) { active--; throw error; }
    },
  };
}

test('two simultaneous nine-scenario bursts queue FIFO and never exceed two active routes', async () => {
  const engine = controlledEngine(), route = createAdapter(config, engine.fetch);
  for (let round = 0; round < 2; round++) {
    const requests = Array.from({ length: 18 }, (_, i) => route(query(i)));
    if (!round) {
      await tick();
      assert.equal(engine.calls.length, 2);
      engine.open();
    }
    const results = await Promise.all(requests);
    assert(results.every(r => r.total_distance === 2340 && r.elevation_profile.length === 3));
  }
  assert.equal(engine.peak, 2);
  const expected = Array.from({ length: 18 }, (_, i) => latitude(i));
  assert.deepEqual(engine.calls, [...expected, ...expected]);
});

test('queue overflow keeps 503 and validation precedence; failed work releases a slot', async () => {
  const engine = controlledEngine();
  const route = createAdapter({ ...config, maxConcurrent: 1, maxQueued: 2 }, engine.fetch);
  const first = assert.rejects(route(query(0)), e => e.status === 502);
  const second = route(query(1)), third = route(query(2));
  await assert.rejects(route(query(3)), e => e.status === 503 && e.message === 'Routing service busy');
  await assert.rejects(route(new URLSearchParams()), e => e.status === 200 && e.message === 'No `lat1` specified');
  await tick();
  engine.pending.shift().reject(Error('private upstream error'));
  await first;
  await tick();
  assert.deepEqual(engine.calls, [37.789281, 37.789282]);
  engine.open();
  await Promise.all([second, third]);
  assert.equal((await route(query(4))).total_distance, 2340);
  assert.equal(engine.peak, 1);
});

test('cancelled queued requests never reach upstream and immediately free queue capacity', async () => {
  const engine = controlledEngine(), client = new AbortController();
  const route = createAdapter({ ...config, maxConcurrent: 1, maxQueued: 1 }, engine.fetch);
  const first = route(query(0));
  const cancelled = assert.rejects(route(query(1), client.signal), e => e.status === 499);
  client.abort();
  await cancelled;
  const replacement = route(query(2));
  await tick();
  assert.equal(engine.calls.length, 1);
  engine.open();
  await Promise.all([first, replacement]);
  assert.deepEqual(engine.calls, [37.789281, 37.789283]);
  await assert.rejects(route(query(3), client.signal), e => e.status === 499);
  assert.equal((await route(query(4))).total_distance, 2340);
});

test('deadline expires in queue, does not dispatch expired work, and leaves no leaked permits', async () => {
  const engine = controlledEngine();
  const route = createAdapter({ ...config, maxConcurrent: 1, maxQueued: 1, timeoutMs: 20 }, engine.fetch);
  // Simulate an upstream operation that takes time to acknowledge cancellation.
  const first = assert.rejects(route(query(0)), e => e.status === 504);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(route(query(1)), e => e.status === 504);
    assert.equal(engine.calls.length, 1);
    const replacement = assert.rejects(route(query(2)), e => e.status === 504);
    await assert.rejects(route(query(3)), e => e.status === 503);
    await replacement;
    engine.open();
    await first;
    assert.equal((await route(query(4))).total_distance, 2340);
    assert.deepEqual(engine.calls, [37.789281, 37.789285]);
    assert.equal(engine.peak, 1);
  } finally { clearTimeout(keepAlive); }
});

test('queue length is bounded and can be explicitly disabled', () => {
  assert.equal(config.maxQueued, 16);
  assert.equal(loadConfig({ MAX_QUEUED_ROUTES: '0' }).maxQueued, 0);
  for (const value of ['-1', '257', '1.5', 'NaN', 'Infinity']) {
    assert.throws(() => loadConfig({ MAX_QUEUED_ROUTES: value }), /Invalid MAX_QUEUED_ROUTES/);
  }
});
