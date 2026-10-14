---
name: update-map-data
description: Refresh a region's routing data from the latest OpenStreetMap snapshot — download extracts, rebuild and validate the Valhalla graph, review access changes, package the runtime, and (with approval) publish and deploy it to Vercel. Use when asked to update or refresh map data or routing data for a region ("update the Tahoe map data", "update the contracosta map data", "pull in the latest OSM for SF"), or to set up routing data for a new region.
---

# Update map data

Periodic job: rebuild one region's routing data from a fresh OSM snapshot and roll it out.
The repo docs and `scripts/build-region.sh --help` are the source of truth for *how* each
step works. This skill is the ordered runbook, the decisions to bring to the user, and
lessons learned from previous runs. Don't restate the docs here; link to them and record
only what they don't say.

Reference docs (read the relevant section before each phase):

- [docs/REGIONS.md](../../../docs/REGIONS.md): region config reference, adding a region, the one-command build, review gates, packaging
- [docs/EXTERNAL-DEPLOYMENT.md](../../../docs/EXTERNAL-DEPLOYMENT.md): prerequisites, self-contained image, smoke tests
- [docs/DATA.md](../../../docs/DATA.md): toolchain and data provenance
- [README.md § Deploy to Vercel](../../../README.md#deploy-to-vercel): VCR publish, `prepare-release.py`, deploy and verify

## 1. Resolve the region

Take the region slug from the request ("update the contracosta map data" → `contracosta`;
"Tahoe" → `tahoe`; "SF" or "Bay Area" → `sf`). Slugs are lowercase, matching
`config/<slug>.json`. Ask if the request names no region, or names one ambiguously.

- **`config/<slug>.json` exists:** this is a refresh. Run `npm run check:regions` and stop on
  errors for that region.
- **It doesn't exist:** this is a new region. Follow REGIONS.md § "Adding a region" first.
  Draft the config with the user: bounds, `admin_states`, scenarios, readiness probes, and
  smoke trips in `test/fixtures/smoke-regions.json`. **Get the user's approval of the
  bounds and states before downloading anything.** The first build produces a candidate
  review with no prior review to carry forward, so step 4 below covers every item, not just
  the changes.

Always pass `--region <slug>` explicitly. The scripts default to `sf`.

## 2. Load deployment settings

Deployment settings vary per deployer, so they live in a gitignored local file,
`.claude/update-map-data.local.json`:

```json
{
  "data_dir": "~/bikesy-data",
  "regions": {
    "<slug>": {
      "vercel_scope": "<team slug>",
      "vercel_project": "<project>",
      "vercel_region": "sfo1",
      "domain": "<public hostname>",
      "routing_extracts": ["<geofabrik id>", "..."],
      "notes": "anything deployer-specific worth remembering"
    }
  }
}
```

If the file or the region's entry is missing, ask the user for the values, then write
them. `routing_extracts` is optional; see step 3. Keep each build's workspace at
`WORK=<data_dir>/<slug>-<YYYY-MM-DD>/` (the snapshot date). Never put raw data or build
output in Git.

## 3. Environment and inputs

- **Docker** must be running with enough resources (see the preflight in
  EXTERNAL-DEPLOYMENT.md). On Apple Silicon, enable Rosetta for amd64 emulation. If `docker`
  isn't found, try `export PATH=$HOME/.docker/bin:$PATH`; Docker Desktop installs its CLI there.
- **Python:** use the repo `.venv` (create it with `uv venv --python 3.12 .venv`). The
  scripts are stdlib-only. Never use or modify the system Python; macOS ships 3.9, which is
  too old, and `npm run test:data` calls `python3`, so activate the venv first.
- **Node** 22.9+.
- **Snapshot:** use the latest Geofabrik daily snapshot unless the user is waiting on
  specific OSM edits. In that case, confirm each edit is older than the extract's replication
  timestamp (in the `.osm.pbf` header, or the `state.txt` next to it).
- **Which extracts to download.** Look them up in Geofabrik's index
  (`https://download.geofabrik.de/index-v1-nogeom.json`). Take every file from the same
  dated snapshot (`<name>-YYMMDD.osm.pbf`):
  - **Admin input:** the full state extract for every code in the config's `admin_states`.
    Match the index's `iso3166-2` (`US-CA` → `us/california`). Sub-state extracts such as
    `norcal` lack the complete state boundary and are rejected.
  - **Routing input:** the smallest extracts that together cover the config's `bounds`, from
    `routing_extracts` if set; for example `norcal` plus `nevada` for Tahoe. Full state
    files also work; they're just slower to merge.
- **Download** in parallel with ranged requests, because Geofabrik throttles each connection
  to about 1 MB/s. Split the size from `curl -sI` into about 8 `curl -r` ranges and
  concatenate them. Check each file against Geofabrik's `.md5`. Reuse files that are already
  downloaded from the same snapshot.

## 4. Runbook

1. **Build up to the review:**
   ```sh
   scripts/build-region.sh --region <slug> --workdir "$WORK" --cpus 8 --memory 12g \
     --routing-pbf <routing extract> [--routing-pbf ...] \
     --admin-pbf <state extract> [--admin-pbf ...] \
     --osm-source 'Geofabrik <names> YYYY-MM-DD (replication <timestamp>)' \
     [--reuse-dem <previous WORK>/data/elevation] \
     [--carry-forward graph/<slug>] --to review
   ```
   - Use `--carry-forward` whenever the region has an approved review (`graph/<slug>/`,
     or `graph/` for SF).
   - Reuse the previous run's DEM unless the bounds changed.
   - The toolchain image is reused automatically, and completed steps are skipped, so after
     a failure rerun the same command. `--from` / `--to` run part of the sequence.

2. **Access review.** **Stop here and bring the user every decision. Never approve on
   their behalf.**
   - Diff the candidate against the approved review: `diff -r graph/<slug> "$WORK/review"`,
     plus `motorway_mainline_diff_vs_carry_forward` in `$WORK/review-candidates.json`.
   - Present each new or changed item with its way id, name, location, current tags and
     proposed handling. REGIONS.md explains each review field.
   - Flag likely OSM tagging errors you spot, and suggest fixing them in OSM rather than
     overriding them in the review.
   - After sign-off, edit `$WORK/review` and replace `review_status` with an approval note:
     date, who approved it, and the decisions.

3. **Finish the build:** if `$WORK/runtime/` exists, move it aside first, because the
   package step skips when it's present. Then rerun step 1's command with `--from build`.
   The gated build checks the graph against the approved review, then packages it, builds
   the app and smoke-tests it.

4. **Validate beyond the smoke test.**
   - Read `$WORK/smoke-region.json` (and `border-validation.jsonl` for multi-state
     regions). Check every scenario and the elevation profiles.
   - Compare trip distances with the previous run's `smoke-region.json` and flag large changes.
   - Run `scripts/check-detours.mjs` if it exists, and the region's canary trips from the
     region notes below.

5. **Commit the approved review** to `graph/<slug>/` on a new branch
   (`<slug>-review-YYYY-MM-DD`), along with any build or doc fixes on their own branch.
   Never push; the user pushes.

6. **Publish (needs explicit user approval for each step).** Use the region's deployment
   settings:
   ```sh
   vercel whoami                                    # must be an account in <vercel_scope>
   vercel vcr login docker --scope <scope> --project <project>     # valid ~12 h
   IMG=vcr.vercel.com/<scope>/<project>/routing-data
   docker build --platform linux/amd64 -t $IMG:v<N>-<YYMMDD> "$WORK/runtime"
   docker push $IMG:v<N>-<YYMMDD>                   # record the digest
   .venv/bin/python scripts/prepare-release.py --region <slug> --runtime "$WORK/runtime" \
     --image $IMG@sha256:<digest> --vercel-region <vercel_region> --output "$WORK/deploy-v<N>"
   vercel link --yes --cwd "$WORK/deploy-v<N>" --scope <scope> --project <project>
   vercel deploy --cwd "$WORK/deploy-v<N>" --scope <scope> --prod --skip-domain
   ```
   - **Verify** the returned URL with `vercel curl`: `/health`, `/bounds`, every smoke trip
     in every scenario, and an out-of-bounds request. Compare against
     `$WORK/smoke-region.json`.
   - **Then ask before** `vercel promote <url>`, which moves the public domain.
   - **New projects only:** attach the domain with `vercel domains add <domain> <project>`,
     then have the user add the DNS record that `vercel domains verify <domain>` shows.

7. **Record the run:** append to `<data_dir>/RUNS.md`: date, region, snapshot, runtime
   `engine-policy.json` sha256, image tag and digest, deployment URL, timings from
   `$WORK/timings.tsv`, and issues. Add new general findings to the lessons below, and
   deployer-specific ones to the local settings `notes`.

## Approval gates

Stop and ask before each of these:
- approving review items or a new region's bounds and states;
- pushing to the registry, deploying, promoting, or changing domains;
- deleting old images or workspaces.

Keep the current release and one rollback release. The docs warn that deleting a pinned
base image breaks rebuilds.

## Lessons learned

General findings, dated and specific.

- **Timings** (2026-10-14, Tahoe, Apple Silicon with Rosetta, 8 CPUs and 12 GB for Docker):
  - California download: 23 minutes. Only the downloads are worth optimizing.
  - One-off steps: DEM 100 s, toolchain image 220 s.
  - Everything after the downloads: about 131 s.
  - Image push about 1 minute; Vercel deploy under 1 minute.
- **Builds aren't byte-reproducible.** A rerun with the same inputs gave identical routes,
  review and policy indexes. But `admin.sqlite` and some tiles differed, so
  `engine-policy.json` changes every build. Compare routes, not hashes, and don't spend time
  on determinism reruns.
- **Size:** the runtime package is about 150 MB. Local images are 1.5–2.2 GB each, so prune
  old `bikesy-<slug>*:candidate` images. The deploy directory is about 100 KB, because the
  data stays in the registry.
- **Don't blame OSM too quickly.** Before calling a detour a data problem, confirm the tags
  and topology (Overpass, or `osmium getid -r` in the toolchain image), and route the pieces
  of the trip separately. If the pieces add up to less than the whole, the cause is costing,
  not data.
- **Hill cost:** steep side-slopes inflate it (see `docs/HILL-COST.md` if present).
  Scenario 2 detours on mountain highways are a known engine issue, not a build failure.
- **`vercel curl` must run from inside the deploy directory.** It passes `--cwd` through to
  curl, which rejects it. Deployment URLs are behind Vercel Deployment Protection (plain curl
  gets a 302); only the promoted custom domain is public.
- **New domains:** if the parent domain has a wildcard DNS record, resolvers (Vercel's
  included) can cache the wildcard answer for its TTL when queried before the CNAME exists.
  The certificate then waits until that cache expires. Don't run `vercel domains verify`
  before the user has added the record.
- **zsh:** an unquoted `$VAR` holding "lat lon" doesn't split into two arguments. Use arrays.

## Region notes

Facts about a region's data that every deployer needs.

- **tahoe** (CA and NV): routing uses `norcal` and `nevada`; admin uses the full
  `california` and `nevada` extracts.
  - Canary: Carson City (39.1638, -119.7674) → Spooner Summit (39.1050, -119.8960). In
    scenario 2 it detours about 109 km via Luther Pass because of the hill cost issue,
    although US 50 is correctly mapped as a divided highway (ways 307623778 and 691578108).
  - Approved review: `graph/tahoe/` (2026-10-14). Every motorway excluded, including I-80
    segments tagged `bicycle=yes`.
- **sf**: the review lives in `graph/`, not `graph/sf/`. The checked-in root Dockerfile
  pins the original owner's private SF image, so external deployers must publish their own
  data.
