// Protected staging-only comparison helper. Existing route API is unchanged.
import { decode, encode } from './polyline.js';
import { validateElevation } from './adapter.js';
export const METHOD = 'locked-skadi-terrain-30m-v1';
export function shapeDistance(points) {
  const rad = Math.PI / 180; let meters = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
    meters += 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  return meters;
}
async function jsonBody(stream, signal, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of stream) {
    signal.throwIfAborted(); size += chunk.length;
    if (size > limit) throw Error('Comparison shape or response too large');
    chunks.push(Buffer.from(chunk));
  }
  signal.throwIfAborted(); return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createStageElevationHandler(config, { fetchImpl = fetch, timeoutMs = 15000, maxConcurrent = 2, maxQueued = 18 } = {}) {
  let active = 0; const queue = [];
  function release() {
    active--;
    while (active < maxConcurrent && queue.length) {
      const next = queue.shift(); next.signal.removeEventListener('abort', next.cancel);
      if (next.signal.aborted) { next.reject(next.signal.reason); continue; }
      active++; next.resolve(release);
    }
  }
  function acquire(signal) {
    signal.throwIfAborted();
    if (active < maxConcurrent) { active++; return Promise.resolve(release); }
    if (queue.length >= maxQueued) throw Error('Comparison elevation service busy');
    return new Promise((resolve, reject) => {
      const next = { signal, resolve, reject, cancel: () => { const i = queue.indexOf(next); if (i >= 0) queue.splice(i, 1); reject(signal.reason); } };
      queue.push(next); signal.addEventListener('abort', next.cancel, { once: true });
    });
  }
  return async function stageElevation(req, res) {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const send = (status, data) => { if (!res.destroyed) { res.statusCode = status; res.end(JSON.stringify(data)); } };
    if (req.method !== 'POST') { send(405, { error: 'Use POST for comparison elevation' }); return; }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref(); const signal = controller.signal;
    const cancel = () => controller.abort(); req.once('aborted', cancel); res.once('close', cancel);
    let unlock;
    try {
      unlock = await acquire(signal);
      if (Number(req.headers['content-length']) > 200000) throw Error('Comparison shape or response too large');
      // Read requests with a deadline as well as upstream response bodies.
      const onTimeout = () => { if (!req.complete) req.destroy(); };
      signal.addEventListener('abort', onTimeout, { once: true });
      let input;
      try { input = await jsonBody(req, signal, 200000); } finally { signal.removeEventListener('abort', onTimeout); }
      const points = decode(input.path, 5);
      if (points.length < 2 || points.length > 20000) throw Error('Invalid comparison shape');
      // Match the locked graph/DEM buffer; never accept a URL or arbitrary engine action.
      if (points.some(([lat, lon]) => lat < 37.2 || lat > 38.42 || lon < -123.15 || lon > -121.51)) throw Error('Comparison elevation outside available terrain');
      const distance = shapeDistance(points);
      if (distance > 250000) throw Error('Comparison route exceeds 250 km limit');
      const response = await fetchImpl(new URL('height', config.valhallaUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ encoded_polyline: encode(points, 6), shape_format: 'polyline6', range: true, height_precision: 2, resample_distance: 30 }),
      });
      if (!response.ok || !response.body) throw Error('Comparison elevation unavailable');
      const data = await jsonBody(response.body, signal, 2 * 1024 * 1024);
      if (data.error || !data.encoded_polyline) throw Error('Comparison elevation unavailable');
      const profile = validateElevation(data.range_height, decode(data.encoded_polyline), points);
      if (profile.length < 2 || profile.length > 8500 || profile.some((p, i) => i && p[0] - profile[i - 1][0] > 31) || Math.abs(profile.at(-1)[0] - distance) > Math.max(5, distance * .02)) throw Error('Incomplete comparison elevation');
      let ascent = 0, descent = 0;
      for (let i = 1; i < profile.length; i++) { const dh = profile[i][1] - profile[i - 1][1]; ascent += Math.max(0, dh); descent += Math.max(0, -dh); }
      send(200, { method: METHOD, spacing_m: 30, geometry_distance_m: distance, ascent_m: ascent, descent_m: descent, profile });
    } catch (error) {
      send(signal.aborted ? 504 : 422, { error: signal.aborted ? 'Comparison elevation timed out or cancelled' : error.message });
    } finally {
      clearTimeout(timer); req.off('aborted', cancel); res.off('close', cancel); unlock?.();
    }
  };
}
