# API and compatibility

`GET /api/route?lat1=37.789281229572&lng1=-122.46094205322234&lat2=37.78012650217339&lng2=-122.44433400393197&scenario=5`

Aliases: `/route`, `/`, `/api.php`, `/api.php/`. Latitude and longitude inputs are decimal degrees. Scenario defaults to `1`. Out-of-region or malformed inputs return JSON errors. `HEAD` and CORS `OPTIONS` are supported.

The response preserves the historical fields: `directions`, `path` (precision-5 encoded route and legacy levels), `total_distance` (meters), `elevation_profile` (distance/height pairs), and `stats` (timing seconds). Direction coordinates use longitude/latitude. Walking maneuvers add optional `route_warnings` with code `walk_bicycle`; clients must tolerate this additive field. A walking warning is not a measured stair count. See `test/mobile.test.js` and the golden fixtures for exact decoder compatibility.

| Scenarios | Facility preference | Hill preference by column |
|---|---|---|
| 1, 2, 3 | Direct (`use_roads=1`) | 0, 0.75, 1 |
| 4, 5, 6 | Balanced (`use_roads=0.5`) | 0, 0.75, 1 |
| 7, 8, 9 | Bike facilities (`use_roads=0`) | 0, 0.75, 1 |

Maneuver penalty is 2 except scenario 9, which retains the engine default. The patched distance/hill policy, corrected imported facilities, narrow access overlay and counted-stairs penalties determine routes. Ferries are excluded first; a single retry is allowed only after the engine certifies disconnected land components. Generic failures do not enable ferries.

Other endpoints: `/health`, `/api/bounds` (alias `/bounds`), `/stage`, and `POST /stage/elevation` for the comparison page's fixed-method elevation calculation. See `test/stage-elevation.test.js` for that request contract.

Errors use `{ "error": "..." }`: 400 validation/no route, 404 unknown path, 405 unsupported method, 503 full queue, 504 deadline, 502 unavailable/malformed upstream or missing DEM. The container defaults to two simultaneous routes and a bounded queue of 16; requests share a 15-second routing deadline. Deployment Protection applies outside the app, so protected Preview URLs require Vercel access before API requests reach this handler.
