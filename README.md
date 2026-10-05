# Bikesy Valhalla backend

Git-ready source for the corrected regional import and counted-stairs engine deployed on October 4, 2026. It includes the legacy-compatible routing API, nine SF scenarios, queue/cancellation controls, old/new comparison grid, elevation comparison, and 16 geographic/bridge presets. The configured hill weights are unchanged; there is no experimental detour selector.

**Routing data stays in Vercel Container Registry, outside Git.** `Dockerfile.vercel` inherits the exact existing private image by SHA-256 digest, overlays this repository's application, and verifies the engine and 56 data files at image build. Startup verifies them again. Routes and cold starts do not download or rebuild OSM/DEM data.

## Start here

1. The production backend is [api.bikesy.com](https://api.bikesy.com); the canonical routing endpoint is `/route`.
2. Use the [API examples below](#api-examples) for requests, responses and compatibility details.
3. Run source checks with Node 22+ and Python 3.12; there are no npm dependencies:

```sh
npm test
npm run test:data
npm run check
npm run verify:release
python3 engine/apply_patch.py --check
```

Current package validation and its limits are in [VALIDATION.md](docs/VALIDATION.md). Source hashes in `release.json` identify the current local runtime source; source changes still require deployment. The pinned engine and routing-data image remain unchanged.

## Run locally

With Docker access to the private VCR base (see [Where the data comes from](#where-the-data-comes-from)):

```sh
docker build --platform linux/amd64 -f Dockerfile.vercel -t bikesy:local .
docker run --rm --name bikesy-local --platform linux/amd64 --cpus 2 --memory 2g \
  -p 127.0.0.1:8080:80 bikesy:local
```

The production comparison page is [api.bikesy.com/stage](https://api.bikesy.com/stage), and health is [api.bikesy.com/health](https://api.bikesy.com/health). The Docker command above deliberately binds only to the local loopback interface; for local development, open `/stage` on that mapped port. Apple Silicon uses amd64 emulation. This starts the new Valhalla backend only. The comparison page calls the public historical Bikesy API for its Old column; the packaged backend does not launch a legacy server. Stop the container with Ctrl-C. For JS-only development against an already running Valhalla engine, use `npm run start:adapter` and the variables in `.env.example`.

## API examples

Request the **Wiggle · Fell to Valencia** trip from the production backend. Full API URL:

https://api.bikesy.com/route?lat1=37.77201&lng1=-122.45189&lat2=37.76131&lng2=-122.42157&scenario=5

Copy-paste request:

```sh
BASE_URL='https://api.bikesy.com'
curl --get "$BASE_URL/route" \
  --data-urlencode 'lat1=37.77201' \
  --data-urlencode 'lng1=-122.45189' \
  --data-urlencode 'lat2=37.76131' \
  --data-urlencode 'lng2=-122.42157' \
  --data-urlencode 'scenario=5'
```

`BASE_URL` defaults to the production backend. Override it only when deliberately testing a local instance or a protected Preview deployment. The comparison page uses same-origin requests for the new backend and keeps the historical Bikesy API for its Old column; the old API is a separate comparison source.

`lat1`/`lng1` are the start and `lat2`/`lng2` are the destination, in decimal degrees. All four are required and must lie within the configured bounds. `scenario` is optional and defaults to `1` when missing or empty. The canonical route is `/route`. Compatibility aliases `/api/route`, `/`, `/api.php` and `/api.php/` accept the same query and remain supported. `HEAD` and CORS `OPTIONS` are supported. `GET /bounds` (also `/api/bounds`) returns the service area, and `GET /health` returns `{"status":"ok"}`.

The active Bay Area configuration maps all nine scenarios as follows:

| Facility preference             | Flatter (`use_hills=0`) | Balanced hills (`0.75`) | More hill-tolerant (`1`) |
| ------------------------------- | ----------------------- | ----------------------- | ------------------------ |
| Direct (`use_roads=1`)          | 1                       | 2                       | 3                        |
| Balanced (`use_roads=0.5`)      | 4                       | 5                       | 6                        |
| Bike facilities (`use_roads=0`) | 7                       | 8                       | 9                        |

These are preferences, not guarantees about distance or elevation. Scenario 9 retains the engine's default maneuver penalty; the others use 2.

### Success response

HTTP **200** returned this response for the exact production URL above on October 5, 2026. **Shortened sample:** only the first two directions and first three elevation samples are shown; `path`, `total_distance` and observed `stats` are complete. Direction coordinates are rounded to five decimal places for this display only; the API retains its original coordinate precision. Routes can change with routing-data updates, and timings vary per request.

```json
{
  "directions": [
    [
      "start east",
      "nameless",
      [
        -122.45190,
        37.77206
      ]
    ],
    [
      "left",
      "nameless",
      [
        -122.44103,
        37.77352
      ]
    ]
  ],
  "path": [
    "kjpeFhkkjVEoBSiAEcA@iCFwA@i@Sy@]m@Ka@Ga@Ca@CmBC_@UyA@UNqA?QO]]a@E[SiE?yAOq@E{AIaAAaAFk@?q@c@mDKg@GQS]KmAWQrDc@yBc^tJkAsAoSdOiBAi@fJa@nCOpMg@tI_@kBiw@lKg@",
    "B?????????????????????????????????@@@@@?@???@@B"
  ],
  "total_distance": 4121,
  "elevation_profile": [
    [
      0,
      76.47
    ],
    [
      14,
      76.14
    ],
    [
      28,
      75.84
    ]
  ],
  "stats": {
    "route_find_time": 0.19999127399999997,
    "route_desc_time": 0.017236383999999817,
    "endpoint_find_time": 0
  }
}
```

| Field                      | Meaning                                                                                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directions`               | Rows of `[turn, street_name, [longitude, latitude]]`. There is no separate arrival row.                                                                                                                                                                                    |
| `path`                     | `[encoded_polyline, encoded_levels]`. Decode the first string with precision **5** (`1e-5` degrees); decoded points are `[latitude, longitude]`. The second string contains legacy simplification levels. The API does not expose the engine's internal precision-6 shape. |
| `total_distance`           | Route length in **meters**.                                                                                                                                                                                                                                                |
| `elevation_profile`        | `[distance_along_route_meters, elevation_meters]` samples. Heights are DEM estimates, and sampled shape length may differ slightly from `total_distance`.                                                                                                                  |
| `stats.route_find_time`    | Seconds spent in the upstream route phase, including a permitted ferry retry.                                                                                                                                                                                              |
| `stats.route_desc_time`    | Seconds spent converting the route and obtaining/validating elevation.                                                                                                                                                                                                     |
| `stats.endpoint_find_time` | Always `0`; endpoint snapping is included in the route phase.                                                                                                                                                                                                              |

The `stats` values measure API processing, **not estimated cycling duration**. Queue wait is excluded from these timings but counts toward the request deadline. Optional `route_warnings` appears for walking sections, for example `[{"code":"walk_bicycle","message":"Walking sections may include stairs; dismount or carry your bicycle where required."}]`; it does not supply a stair count.

### Error responses

Clients must check for an `error` field even on **HTTP 200**. Legacy validation and no-route errors deliberately retain that status.

Missing coordinates:

```sh
curl -i "$BASE_URL/route"
```

HTTP **200**:

```json
{ "error": "No `lat1` specified" }
```

Passing `scenario=10` with all four valid coordinates also returns HTTP **200**:

```json
{ "error": "Invalid `scenario` 10" }
```

A backend/upstream failure can return HTTP **502**:

```json
{ "error": "Routing service unavailable or incomplete elevation data" }
```

Other errors use the same envelope: HTTP 200 for `No route found` or `Location outside routing bounds`, 404 for an unknown endpoint, 405 for an unsupported method, 503 when the routing queue is full, and 504 when the deadline expires. An HTTP-200 error contains no success-route fields. See [`src/adapter.js`](src/adapter.js) and [`src/server.js`](src/server.js) for the authoritative status behavior.

## Change code or data

- Application change: edit `src/`, `serve.mjs`, `stage.html` or `config/sample.json`; test; run `node scripts/lock-source.mjs` to update source hashes; commit both code and `release.json`. The data image remains pinned.
- Engine/data change: follow [DATA.md](docs/DATA.md), validate a separate rebuilt release, publish a new immutable image after approval, and update the digest plus data/engine locks in one commit. Never mix old graph IDs with new indexes.
- API contract and scenario mapping: [API examples](#api-examples).

Existing limitations remain: bridge hours/closures are static, timezone data is absent, route-distance ordering and some regional detours/duplicates remain, unknown stair counts use a length fallback, and DEM heights are estimates. Tahoe configuration is retained for contract tests; this data image serves the Bay Area only.

## Where the data comes from

The bootstrap already exists as this immutable private image:

```
vcr.vercel.com/blinktag/bikesy-backend/dockerfile@sha256:6619a51429b555a865eabbe99bae03cb0d9676b1c5a47a0d33cd44c09a810da1
```

It holds the patched amd64 engine, 46 graph tiles, six HGT rasters, admin DB, policy/stair indexes and config. Docker pulls those image layers during the build. Git contains only code, fixture snippets and hashes. The image digest pins the artifact; `graph/deployed-runtime.lock.json` binds individual files. Keep this base through deployment cleanups. Deleting its deployment-associated image can break future builds even if an already-built deployment still runs. A later separately named `routing-data` repository can hold releases independently; creating/pushing it is a separate approved maintenance operation.

The registry is project-private; the digest is an identifier, not a credential. For a new developer machine, use authorized `vercel link --scope blinktag --project bikesy-backend`, then `vercel vcr login docker`, which creates a short-lived project credential. These setup commands were not run during packaging. Never commit `.vercel`, `.env`, Docker credentials or signed transfer URLs. Another Vercel project needs separately authorized access or its own copied data image.
