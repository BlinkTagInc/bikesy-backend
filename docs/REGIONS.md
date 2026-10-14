# Building SF and Tahoe

SF remains the default. Each container serves one region. Set `BIKESY_CONFIG` to
select its self-contained config. For local development with Node 22.9+:

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

## Region settings

Each region is self-contained in `config/sf.json` or `config/tahoe.json`:

- `bounds`: the single configured area, used for the OSM extraction and DEM coverage.
  Tahoe currently uses `-120.5,38.65,-119.55,39.5`.
- `bounds_inset`: the inward margin in degrees used to derive the public service area.
  A number applies to all sides; an object can set `left`, `bottom`, `right`, and `top`
  separately. The initial per-side values preserve the existing SF/Tahoe service
  areas exactly. Omit it or use zero to serve the entire configured rectangle.
  `/bounds` and route validation use the derived service area.
- `admin_states`: complete administrative polygons required for the build.
- `readiness`: in-region probe locations and scenario.
- `scenarios`, `engine_policy`, and `region`: routing options and release identity.

`region` identifies the data release; it does not load another config file.

- The Tahoe readiness coordinates are a Tahoe City candidate route. Validate them
  against the built graph before publishing; they have not been live route-tested.
- The backend serves JSON APIs only. The staging HTML and its comparison/elevation
  endpoints have been removed. Route responses still include native elevation.

## Prepare geographic inputs and review

Use Python 3.12+ for the acquisition/locking tools. Raw data, generated contexts and
build outputs stay outside Git. Download/extract OSM separately, retaining complete
ways and enough DEM coverage for the full extraction buffer. Tahoe spans CA and NV.

A fresh data directory needs:

- `region.osm.pbf`: the regional extraction matching the build buffer.
- `admin-input.osm.pbf`: complete administrative polygons for the required states
  (`CA` for SF, `CA` and `NV` for Tahoe), optionally their US parent. The admin helper
  rejects other administrative scope. A simple small routing bbox extract is not
  sufficient to supply complete state polygons. A full state extract containing
  additional admin levels must be filtered before using this helper.
- `elevation/`: uncompressed HGT rasters covering the full build buffer.

To merge California and Nevada routing extracts, install `osmium-tool` and run:

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

For Tahoe, the config requires N38/N39 × W120/W121 HGT tiles. Acquisition is explicit:

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

A review directory contains five files:

| File | Contents |
| --- | --- |
| `inputs.lock.json` | Flat input filename → SHA-256 mapping from the command above. |
| `quality.json` | `region`, positive `minimum_bicycle_nodes`, nonnegative `expected_walking_edges`, and nonempty `facilities` array of `{ "way": OSM_WAY_ID, "cyclelane": EXPECTED_VALHALLA_VALUE }`. Choose reviewed bidirectional facilities on both sides of Tahoe's state line. |
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
then validate actual routes, elevations, border crossings and both Tahoe scenarios.
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

## Verification boundary

Offline tests cover region/config selection, readiness requests, release binding,
context generation and geographic build gates. A full Tahoe graph/admin build,
C++ helper compilation, Docker build and live routing validation still require the
real inputs and pinned toolchain. Existing SF golden route fixtures remain SF-only;
`scripts/smoke-release.mjs` is the historical SF regression suite, not a Tahoe test.
