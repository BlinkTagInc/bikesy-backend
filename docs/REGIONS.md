# Regional builds

SF remains the default; Tahoe is the second region. Each container serves one
region. Set `BIKESY_CONFIG` to select its self-contained config. To add another
region, follow [Adding a region](#adding-a-region). For local development with Node 22.9+:

```sh
cp .env.example .env
```

Use `BIKESY_CONFIG=./config/tahoe.json` in `.env` for Tahoe, then run:

```sh
npm run start:adapter
```

Both `npm start` and `npm run start:adapter` automatically load `.env` when present.
Shell environment variables take precedence. `BIKESY_CONFIG` is the only runtime
selector; when unset, it defaults to `config/sf.json`. Generated Docker images
set an absolute `BIKESY_CONFIG` path for their region and do not include `.env`.

This adapter command requires a separately running, patched Tahoe engine and data.
Changing the region does not download or replace routing data. The checked-in
Dockerfile still pins the existing SF image. Starting it with Tahoe selected fails
with a region mismatch, even if the application config hash is approved.

## Region config reference

A region is a single file, `config/REGION.json`, whose `region` value equals its file
name. Region configs are discovered automatically: `scripts/lock-source.mjs` locks
every one into `release.json`, the test suites validate every one, and
`node scripts/check-region.mjs [REGION]` (`npm run check:regions`) reports what each
still needs. Files without a `region` key, such as `valhalla-*.json`, are engine
settings. Startup rejects unknown keys and names the offending key and file.

| Key | Required | Meaning | Changing it requires |
| --- | --- | --- | --- |
| `region` | yes | Lowercase slug (`[a-z][a-z0-9-]{0,47}`), the data release identity. It does not load another file. | New data release |
| `bounds` | yes | `left`, `bottom`, `right`, `top` in degrees: the OSM extraction, DEM coverage and policy-index rectangle. Tahoe uses `-120.5,38.65,-119.55,39.5`. | New data release |
| `admin_states` | yes | Every US state the bounds touch, by postal code, each once. Complete state polygons are required for the build. | New data release |
| `bounds_inset` | no | Inward margin in degrees for the public service area (`/bounds` and route validation). A number applies to all sides; an object sets `left`, `bottom`, `right`, `top`. Omit or use zero to serve the whole rectangle. The SF/Tahoe per-side values preserve their original service areas exactly. | App release |
| `scenarios` | yes | Map of positive integer ids to bicycle costing options. `"1"` is required and is the default. `use_hills` and `use_roads` are 0 to 1; optional `maneuver_penalty` is nonnegative. Other keys pass through to Valhalla's bicycle costing. Ferries are always disabled. | App release |
| `readiness` | yes | `locations` (two `{lat, lon}` inside the service area) and a configured `scenario`. Startup routes this trip and samples its elevation before listening. | App release |
| `engine_policy` | yes | Must be `"bikesy-distance-v1"`. | Engine release |

Data manifests bind `bounds` and `admin_states`; startup rejects a mismatch with the
packaged data. The Tahoe readiness coordinates are a Tahoe City candidate route;
validate them against the built graph before publishing. The backend serves JSON
APIs only; route responses include native elevation.

## Adding a region

New regions must be within the United States and drive on the right (see
[Limits](#limits-of-the-region-abstraction)). Use a fresh slug, for example `reno`.

1. **Config.** Copy `config/tahoe.json` to `config/reno.json`. Set `region`, the
   extraction `bounds` (leave room for the inset; routes near the edge need
   surrounding roads), `admin_states` for every state the bounds touch,
   `bounds_inset`, `scenarios` and two in-region `readiness` locations on a
   bikeable road. Then run:

   ```sh
   node scripts/check-region.mjs reno
   ```

   It validates the config and prints the service area, required DEM tiles and what
   is still missing. Errors exit nonzero.
2. **Smoke trips.** Add representative trips under `"reno"` in
   `test/fixtures/smoke-regions.json`. Include trips crossing state lines or
   barriers (water, freeways) that the region has. Without them,
   `scripts/smoke-region.mjs` only routes the readiness trip.
3. **Lock and test.** Run `node scripts/lock-source.mjs`, `npm test` and
   `npm run test:data`. The tests pick up the new config automatically, including
   release-context generation for it. Commit the config, fixtures and `release.json`.
4. **Inputs.** Download same-snapshot OSM extracts for every state in
   `admin_states`, then follow [Prepare geographic inputs](#prepare-geographic-inputs-and-review)
   with `--config config/reno.json`: `prepare-admin.py`, `prepare-osm.py`,
   `fetch-dem.py` and `lock-inputs.py --build-lock graph/reno/inputs.lock.json`.
5. **Review.** Create `graph/reno/` with the other four review files described
   below. Inventory motorway mainlines and facilities from the actual extract; never
   copy another region's way IDs. `rebuild-variant.py --region reno` uses
   `graph/reno/` by default; `--review DIR` overrides it. Commit the reviewed files
   once approved, or keep them outside the repository and pass `--review`.
6. **Build and package** in the pinned toolchain with `--region reno`, as below.
7. **Validate and release.** Build and run the image, then run
   `BIKESY_CONFIG=config/reno.json BIKESY_API_URL=... node scripts/smoke-region.mjs`.
   Use `prepare-release.py --region reno` and a separate Vercel project for the
   region, as in the [README](../README.md#deploy-to-vercel).
8. **Frontend.** Point the frontend's regional `BIKESY_API_URL` at the new
   deployment; the frontend needs its own region entry.

## Prepare geographic inputs and review

Use Python 3.12+ for the acquisition/locking tools. Raw data, generated contexts and
build outputs stay outside Git. Download/extract OSM separately, retaining complete
ways and enough DEM coverage for the full extraction buffer. Examples below use
Tahoe, which spans CA and NV; substitute your region's config and states.

A fresh data directory needs:

- `region.osm.pbf`: the regional extraction matching the build buffer.
- `admin-input.osm.pbf`: complete administrative polygons for the config's
  `admin_states` (`CA` for SF, `CA` and `NV` for Tahoe), optionally their US
  parent. The admin helper rejects other administrative scope. A simple small routing bbox extract is not
  sufficient to supply complete state polygons. A full state extract containing
  additional admin levels must be filtered before using this helper.
- `elevation/`: uncompressed HGT rasters covering the full build buffer.

To merge state routing extracts (here California and Nevada), install `osmium-tool` and run:

```sh
python3 scripts/prepare-osm.py --config config/tahoe.json \
  --data /path/to/tahoe-data \
  --admin-input /path/to/prepared-ca-nv-admin.osm.pbf \
  /path/to/california.osm.pbf /path/to/nevada.osm.pbf
```

The helper merges the state files before extracting complete ways to `bounds`,
checks way-node references, and records source/output hashes. It accepts one input
for SF. Inputs must have the same nonempty replication timestamp; mismatched or
history snapshots fail. [Osmium merge](https://docs.osmcode.org/osmium/latest/osmium-merge.html)
deduplicates overlapping objects but does not reconcile different snapshots.
Allow temporary disk for the merged states plus the regional output.

`--admin-input` copies an already prepared administrative input unchanged. It does
not create complete state polygons from a clipped routing extract. Omit it only
if you will supply `admin-input.osm.pbf` separately before locking/building.

`node scripts/check-region.mjs REGION` lists the HGT tiles the bounds require; for
Tahoe these are N38/N39 × W120/W121. Acquisition is explicit:

```sh
python3 scripts/fetch-dem.py config/tahoe.json /path/to/tahoe-data
python3 scripts/lock-inputs.py /path/to/tahoe-data config/tahoe.json \
  --osm-source 'Describe dated regional AND administrative OSM inputs' \
  --dem-source 'Describe DEM source and acquisition date' \
  --build-lock /path/to/tahoe-review/inputs.lock.json
```

`--build-lock` includes the admin input and creates the flat hashes used by the
builder, alongside the normal provenance/coverage lock in the data directory.
Use `--verify --build-lock NEW_PATH` to export an already locked dataset.

A review directory contains five files. The builder uses `graph/REGION/` when it
exists; the original SF review lives directly in `graph/`. Pass `--review DIR` to
use another location. The build stops early if the directory's `quality.json`
names a different region.

| File | Contents |
| --- | --- |
| `inputs.lock.json` | Flat input filename → SHA-256 mapping from the command above. |
| `quality.json` | `region`, positive `minimum_bicycle_nodes`, nonnegative `expected_walking_edges`, and nonempty `facilities` array of `{ "way": OSM_WAY_ID, "cyclelane": EXPECTED_VALHALLA_VALUE }`. Choose reviewed bidirectional facilities across the region, including both sides of any state line. |
| `target-ways.json` | `{ "ways": [...] }`, including every facility check and any reviewed access exception. All stairs are exported independently. |
| `baseline-access-overrides.json` | Reviewed `osm_motorway_mainlines`, `allow_motorway_ways`, `allow_directed_edges`, `walk_bicycle_ways`, and `deny_ways` arrays. Inventory motorway mainlines from the actual extract. Empty allowance arrays retain conservative motorway exclusion. Do not copy SF allowances. |
| `baseline-graph-edges.jsonl` | Original graph records for any directed exceptions, including ID, way, orientation and full shape. May be empty only when there are no directed exceptions. |

The checked-in `graph/` review remains the SF baseline. Tahoe intentionally has no
fabricated facility IDs or approved input hashes. Obtain and review those against
its source extract before building. Existing full-graph driving-side, access,
positive-grade and stair checks remain mandatory. The stair gate still requires
stair metadata; it does not silently accept missing extraction results.

## Build and package in the pinned toolchain

Use the isolated toolchain setup in [DATA.md](DATA.md). Copy the project to `/work`,
fresh inputs to `/data`, and the Tahoe review directory to `/review` in that container.
The following commands are run **inside that toolchain**:

```sh
python3 /work/scripts/rebuild-variant.py --region tahoe --review /review
python3 /work/scripts/package-data.py /data /work/build/tahoe/runtime --region tahoe
```

`--review` may be omitted when the project copy contains `graph/REGION/`.
SF retains its existing input/review defaults:

```sh
python3 /work/scripts/rebuild-variant.py --region sf
python3 /work/scripts/package-data.py /data /work/build/sf/runtime --region sf
```

Evidence defaults to `/work/build/REGION/evidence`. To override it, pass
`--output BUILD_DIR` to the builder and `--build BUILD_DIR` to the packager.
Use separate source/toolchain containers for concurrent builds: engine outputs
are still shared under `engine/out` within each checkout.

Copy the runtime directory out, build its data image using the included Dockerfile,
then validate actual routes, elevations, border crossings and every configured scenario.
Review the generated graph/access evidence. Publish the data image only as a
separate authorized release action and record its immutable registry digest.

## Prepare the application image

Once a validated packaged runtime and its immutable image digest are available:

```sh
python3 scripts/prepare-release.py \
  --region tahoe \
  --runtime /path/to/tahoe-runtime \
  --image 'REGISTRY/IMAGE@sha256:ACTUAL_DIGEST' \
  --output build/tahoe-app

docker build --platform linux/amd64 -f build/tahoe-app/Dockerfile.vercel \
  -t bikesy:tahoe build/tahoe-app

docker run --rm --platform linux/amd64 -p 127.0.0.1:8080:80 bikesy:tahoe
```

The preparer verifies local package hashes and generates a separate Docker context,
release manifest and data lock. Its Dockerfile defaults to the selected region and
image. It does not alter the repository's SF release, download data, build images,
push or deploy. The Docker build verifies that the supplied image actually matches
the packaged data and engine. Data manifests bind the configured `bounds` and `admin_states`;
changing those requires rebuilding data. Inset/scenario/readiness changes only require a
new application release and route validation. Startup verifies region and build settings and probes
an in-region route and its elevation before listening.

The same workflow works with `--region sf` for a future SF data release. For ordinary
SF application edits, continue using the checked-in Dockerfile and
`node scripts/lock-source.mjs`; its engine/data pin is unchanged.

After deployment, configure the frontend's Tahoe `BIKESY_API_URL` to the Tahoe
endpoint and select `NEXT_PUBLIC_REGION=tahoe`. The frontend's old scenario `server`
fields do not select the current backend. This repository does not change that
frontend or its deployment.

## Limits of the region abstraction

- **US only.** `admin_states` accepts US postal codes; `prepare-admin.py` selects
  `ISO3166-2=US-XX` relations; `complete-regional-admin.py` creates or requires a
  `US` parent with US access defaults exported from the pinned Valhalla headers.
  A non-US region would need a country/subdivision admin scope in the config and
  those scripts, the matching country access defaults, and review of the Lua access
  profile's US-centric assumptions.
- **Right-hand traffic.** `check-graph-quality.py` requires every node to be
  drive-on-right. Left-hand regions would need that gate made configurable.
- **One rectangle.** Each region is a single bounding box; irregular areas need a
  larger box and inset, or a polygon extraction step that does not exist yet.
- DEM acquisition (`fetch-dem.py`) uses the global Skadi tiles and handles all
  hemispheres.

## Verification boundary

Offline tests cover region/config selection and validation for every
`config/REGION.json`, readiness requests, release binding, context generation and
geographic build gates. A full Tahoe graph/admin build,
C++ helper compilation, Docker build and live routing validation still require the
real inputs and pinned toolchain. Existing SF golden route fixtures remain SF-only;
`scripts/smoke-release.mjs` is the historical SF regression suite, not a Tahoe test.
