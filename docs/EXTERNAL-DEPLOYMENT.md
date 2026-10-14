# Deploying with your own account

The root Dockerfile is the existing SF deployment fast path and retains its private
image pin for compatibility. External teams should generate a deployment directory;
they do not need access to BlinkTag's registry. No runtime API secret is required.

## Check prerequisites

Use Node 22.9+ and Python 3.12+ consistently:

```sh
python3 scripts/preflight.py --build
docker build --platform linux/amd64 -f engine/Dockerfile.toolchain -t bikesy-toolchain .
```

The preflight requires Docker resources of at least 2 CPUs, 6 GiB memory and 8 GiB
free disk. Allow additional room for downloaded state extracts and final images;
this is a minimum, not a peak-disk guarantee. Apple Silicon runs amd64 through
emulation. Inside the toolchain, run `python3 /work/scripts/preflight.py --toolchain`.
The Dockerfile includes Node and osmium; an older cached toolchain may not.
Public base images are pinned, but apt packages are not frozen. Record the resulting
toolchain digest and rerun validation rather than expecting historical engine bytes.

## Prepare and review regional inputs

Follow [REGIONS.md](REGIONS.md) for extraction bounds, DEM coverage and build gates.
Download state extracts from the same dated OSM snapshot. Prepare administrative data:

```sh
python3 scripts/prepare-admin.py --config config/tahoe.json \
  --output /inputs/admin-input.osm.pbf /inputs/california.osm.pbf /inputs/nevada.osm.pbf
python3 scripts/prepare-osm.py --config config/tahoe.json --data /data \
  --admin-input /inputs/admin-input.osm.pbf /inputs/california.osm.pbf /inputs/nevada.osm.pbf
```

The helper selects complete US state relations, preserves their references and
strips tags from referenced objects. The actual admin build rejects missing,
extra or invalid state polygons. Never clip administrative polygons to the route box.
Lock the inputs and review the access/facility inventory as described in REGIONS.md.
Motorway exceptions require review; neither this helper nor a new region grants them.

Additional US regions need only `config/SLUG.json` plus their reviewed inputs; see
[Adding a region](REGIONS.md#adding-a-region) for the checklist and
`node scripts/check-region.mjs SLUG` to validate the config. Pass that slug to the
rebuild/package/prepare commands. Non-US driving/admin rules are not implemented. SF defaults and Tahoe's existing two-scenario public configuration
remain unchanged. A nine-scenario Tahoe experiment must use its own config snapshot.

## Build a self-contained application image

After a gated data build and packaging, generate the app with the local runtime:

```sh
python3 scripts/prepare-release.py --region tahoe --runtime /output/runtime \
  --bundle-data --vercel-region sfo1 --output /output/tahoe-app
docker build --platform linux/amd64 -f /output/tahoe-app/Dockerfile.vercel \
  -t bikesy-tahoe:candidate /output/tahoe-app
docker run --rm --platform linux/amd64 --cpus 2 --memory 2g \
  -p 127.0.0.1:8080:80 bikesy-tahoe:candidate
```

This uses the public pinned Node/Valhalla bases and copies your own verified data
and patched engine. It requires no private upstream image or data registry login.
The final build verifies every data hash, engine and application configuration.
The generated Docker context contains data: keep it out of Git and inspect upload
size before deployment. The alternative `--image REGISTRY/IMAGE@sha256:DIGEST`
reuses an image you already control and keeps application upload contexts small.

The image is Linux/amd64, listens on port 80, runs unprivileged and expects immutable
`/data` plus `/usr/local/bin/valhalla_service`. Health becomes available only after
engine, route and elevation readiness checks. These internal paths are a container
contract. `MAX_CONCURRENT_ROUTES=2` is the candidate default; measure workload before
changing it. SIGTERM triggers graceful engine shutdown. Use full data verification
for mutable local data; preserve the image/config digest pair for rollback.

## Validate and deploy explicitly

```sh
BIKESY_CONFIG=config/tahoe.json BIKESY_API_URL=http://127.0.0.1:8080 \
  node scripts/smoke-region.mjs
```

The regional smoke suite checks each configured scenario, bounds and elevation;
new regions fall back to their readiness trip until representative fixtures are
added. Full-graph access gates remain separate. The historical SF golden suite
also requires an explicit `BIKESY_API_URL`; it never silently contacts production.

Link only the generated app directory to your own Vercel project and deploy a
protected preview. `--vercel-region` selects compute placement, independently of
routing geography. Do not transfer production domains until validation and approval.
An ordinary source Git push is not a data release or verified deployment; current
CI checks source only. Keep credentials, `.vercel` and raw data out of Git.

Budget build compute, request CPU/memory and registry storage. Store one current
and one rollback release unless more retention is intentional; deleting a pinned
base image can break later rebuilds. Protected previews limit unintended traffic.
No recurring keepalive is required. Establish an explicit trial end/retention decision
and review measured usage before exposing a deployment publicly.
