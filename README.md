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

## Change code or data

- Application change: edit `src/`, `serve.mjs`, `stage.html` or `config/sample.json`; test; run `node scripts/lock-source.mjs` to update source hashes; commit both code and `release.json`. The data image remains pinned.
- Engine/data change: follow [DATA.md](docs/DATA.md), validate a separate rebuilt release, publish a new immutable image after approval, and update the digest plus data/engine locks in one commit. Never mix old graph IDs with new indexes.
- API contract and scenario mapping: [API.md](docs/API.md).

Existing limitations remain: bridge hours/closures are static, timezone data is absent, route-distance ordering and some regional detours/duplicates remain, unknown stair counts use a length fallback, and DEM heights are estimates. Tahoe configuration is retained for contract tests; this data image serves the Bay Area only.

See `LICENSE` and [third-party notices](THIRD_PARTY_NOTICES.md). No new license for original project code was selected on the owner's behalf.
