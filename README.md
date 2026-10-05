# Bikesy Valhalla backend

Git-ready source for the corrected regional import and counted-stairs engine deployed on October 4, 2026. It includes the legacy-compatible routing API, nine SF scenarios, queue/cancellation controls, old/new comparison grid, elevation comparison, and 16 geographic/bridge presets. The configured hill weights are unchanged; there is no experimental detour selector.

**Routing data stays in Vercel Container Registry, outside Git.** `Dockerfile.vercel` inherits the exact existing private image by SHA-256 digest, overlays this repository's application, and verifies the engine and 56 data files at image build. Startup verifies them again. Routes and cold starts do not download or rebuild OSM/DEM data.

## Start here

1. Read [deployment setup](docs/DEPLOY.md), including the one-time Git connection and private-base build check.
2. Put this directory at the root of your GitHub repository. No Git repository or remote was created for you.
3. Run source checks with Node 22+ and Python 3.12; there are no npm dependencies:

```sh
npm test
npm run test:data
npm run check
npm run verify:release
python3 engine/apply_patch.py --check
```

Current package validation and its limits are in [VALIDATION.md](docs/VALIDATION.md). Source hashes in `release.json` match the verified deployed runtime. Packaging metadata, extra test helpers, Docker layering and documentation are new; they do not change route behavior.

## Run locally

With Docker access to the private VCR base (see deployment guide):

```sh
docker build --platform linux/amd64 -f Dockerfile.vercel -t bikesy:local .
docker run --rm --name bikesy-local --platform linux/amd64 --cpus 2 --memory 2g \
  -p 127.0.0.1:8080:80 bikesy:local
```

Open `http://127.0.0.1:8080/stage`; health is `/health`. Apple Silicon uses amd64 emulation. This starts the new Valhalla backend only. The comparison page calls the public historical Bikesy API for its Old column; the packaged backend does not launch a legacy server. Stop the container with Ctrl-C. For JS-only development against an already running Valhalla engine, use `npm run start:adapter` and the variables in `.env.example`.

## API examples

After starting the local container above, request the public comparison page's **Wiggle · Fell to Valencia** trip:

```sh
BASE_URL='http://127.0.0.1:8080'
curl --get "$BASE_URL/api/route" \
  --data-urlencode 'lat1=37.77201183539485' \
  --data-urlencode 'lng1=-122.45188647879988' \
  --data-urlencode 'lat2=37.761314357988724' \
  --data-urlencode 'lng2=-122.42157490354151' \
  --data-urlencode 'scenario=5'
```

For a deployed backend, replace `BASE_URL` with its actual HTTPS origin, without a trailing slash. A protected Vercel deployment also requires authorized access. The examples do not depend on a particular staging URL; `bikesy.com` currently serves the historical comparison API.

`lat1`/`lng1` are the start and `lat2`/`lng2` are the destination, in decimal degrees. All four are required and must lie within the configured bounds. `scenario` is optional and defaults to `1` when missing or empty. Route aliases are `/route`, `/`, `/api.php` and `/api.php/`; all accept the same query. `HEAD` and CORS `OPTIONS` are supported. `GET /api/bounds` (also `/bounds`) returns the service area, and `GET /health` returns `{"status":"ok"}`.

The active Bay Area configuration maps all nine scenarios as follows:

| Facility preference             | Flatter (`use_hills=0`) | Balanced hills (`0.75`) | More hill-tolerant (`1`) |
| ------------------------------- | ----------------------- | ----------------------- | ------------------------ |
| Direct (`use_roads=1`)          | 1                       | 2                       | 3                        |
| Balanced (`use_roads=0.5`)      | 4                       | 5                       | 6                        |
| Bike facilities (`use_roads=0`) | 7                       | 8                       | 9                        |

These are preferences, not guarantees about distance or elevation. Scenario 9 retains the engine's default maneuver penalty; the others use 2.

### Success response

HTTP **200** returns the legacy-compatible JSON shape below. This saved example is derived from [`valhalla-current-sf-wiggle.json`](test/fixtures/valhalla-current-sf-wiggle.json), a separate Wiggle fixture with start `(37.7701073, -122.4537431)`, destination `(37.7845765, -122.4073571)` and scenario `7`. Its captured geometry and distance can differ from a new data release. **Shortened sample:** only the first two directions and first three elevation samples are shown; `path` and `total_distance` are complete, and `stats` is omitted.

```json
{
  "directions": [
    ["start north", "Stanyan Street", [-122.453743, 37.770107]],
    ["sharp left", "Stanyan Street", [-122.45397, 37.771603]]
  ],
  "path": [
    "c~oeFzvkjVuDb@QGcBPHVZEOi@QkBGWUa@M{@e@m@E_@MgESiAEcA@iCFwA@i@Sy@]m@Ka@Ga@Ca@CmBC_@UyA@UNqA?QO]]a@E[SiE?yAOq@E{AIaAAaAHcAEs@EMYeCSy@S]KmAWQ{Dd@}Ba^oPnByJc|Aa@mGCkAc@eHaEf@cEeo@GsAJaAJ_@jAaBaJ{L_BtBoBoC",
    "B??@????????@???????????????????????????@????@?@@@???@@?@??@@@B"
  ],
  "total_distance": 5278,
  "elevation_profile": [
    [0, 80.61],
    [18, 80.04],
    [36, 79.62]
  ]
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
curl -i "$BASE_URL/api/route"
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
- API contract and scenario mapping: [API.md](docs/API.md).

Existing limitations remain: bridge hours/closures are static, timezone data is absent, route-distance ordering and some regional detours/duplicates remain, unknown stair counts use a length fallback, and DEM heights are estimates. Tahoe configuration is retained for contract tests; this data image serves the Bay Area only.

## Where the data comes from

The bootstrap already exists as this immutable private image:

```
vcr.vercel.com/blinktag/bikesy-valhalla-preview/dockerfile@sha256:6619a51429b555a865eabbe99bae03cb0d9676b1c5a47a0d33cd44c09a810da1
```

It holds the patched amd64 engine, 46 graph tiles, six HGT rasters, admin DB, policy/stair indexes and config. Docker pulls those image layers during the build. Git contains only code, fixture snippets and hashes. The image digest pins the artifact; `graph/deployed-runtime.lock.json` binds individual files. Keep this base through deployment cleanups. Deleting its deployment-associated image can break future builds even if an already-built deployment still runs. A later separately named `routing-data` repository can hold releases independently; creating/pushing it is a separate approved maintenance operation.

The registry is project-private; the digest is an identifier, not a credential. For a new developer machine, use authorized `vercel link --scope blinktag --project bikesy-valhalla-preview`, then `vercel vcr login docker`, which creates a short-lived project credential. These setup commands were not run during packaging. Never commit `.vercel`, `.env`, Docker credentials or signed transfer URLs. Another Vercel project needs separately authorized access or its own copied data image.
