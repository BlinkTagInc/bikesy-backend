import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mobilePolyline from './vendor/mapbox-polyline-1.1.1.cjs';
import { createHandler } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/valhalla-current-sf-wiggle.json', import.meta.url)));
async function invoke(path, query, upstream) {
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    end(body) { this.body = JSON.parse(body); } };
  await createHandler(loadConfig({}), upstream)({ method: 'GET', url: `${path}?${query}` }, response);
  return response;
}
test('published mobile URL and nine scenario selections retain the response its decoder and views consume', async () => {
  const [start, finish] = capture.request.locations;
  for (let hills = 1; hills <= 3; hills++) {
    for (let bikeLanes = 1; bikeLanes <= 3; bikeLanes++) {
      // bikesy-native app/services/api.ts scenario lookup: bikeLanes 1 means strongest preference.
      const scenario = (3 - bikeLanes) * 3 + hills;
      const query = new URLSearchParams({ lat1: start.lat, lng1: start.lon, lat2: finish.lat, lng2: finish.lon, scenario });
      const response = await invoke('/api.php/', query, async (url, options) => {
        if (url.pathname === '/route') {
          const body = JSON.parse(options.body);
          assert.equal(body.costing_options.bicycle.use_hills, [0, .75, 1][hills - 1]);
          assert.equal(body.costing_options.bicycle.use_roads, (bikeLanes - 1) / 2);
          return Response.json(capture.route);
        }
        assert.equal(url.pathname, '/height');
        return Response.json(capture.height);
      });
      assert.equal(response.statusCode, 200);
      const result = response.body;
      assert.equal(result.error, undefined);
      const path = mobilePolyline.decode(result.path[0]); // App.tsx uses the decoder's default precision 5.
      assert.ok(path.length > 1);
      for (const [point, location] of [[path[0], start], [path.at(-1), finish]]) {
        assert.ok(Math.abs(point[0] - location.lat) < 0.001);
        assert.ok(Math.abs(point[1] - location.lon) < 0.001);
      }
      const elevation = result.elevation_profile.map(item => ({ distance: item[0] * 0.000621371, elevation: item[1] * 3.28084 }));
      assert.ok(elevation.every(item => Number.isFinite(item.distance) && Number.isFinite(item.elevation)));
      assert.ok(elevation.at(-1).distance > 1 && elevation.at(-1).distance < 5);
      const displayed = result.directions.filter(direction => direction[1] !== 'nameless');
      assert.ok(displayed.length > 0);
      assert.ok(displayed.every(direction => typeof direction[0] === 'string' && typeof direction[1] === 'string'));
      assert.ok(result.directions.every(direction => !direction[0].startsWith('arrive'))); // Native client appends arrival.
    }
  }
});
test('mobile api.php aliases preserve JSON errors the client checks before decoding', async () => {
  for (const path of ['/api.php', '/api.php/']) {
    const response = await invoke(path, '', async () => { throw new Error('Must validate before contacting engine'); });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { error: 'No `lat1` specified' });
    assert.match(response.headers['Content-Type'], /^application\/json/);
  }
});
