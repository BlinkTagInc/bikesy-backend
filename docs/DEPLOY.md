# Main-branch deployments to the existing Vercel project

## Supported path and remaining verification

Vercel's current [container documentation](https://vercel.com/docs/functions/container-images) explicitly supports `Dockerfile.vercel` builds from connected Git pushes. Each commit builds and stores an image in VCR. The existing project has already deployed this runtime through Vercel's container builder using a CLI source upload.

**This repository has not been connected to GitHub. End-to-end main-branch deployment and a private VCR `FROM` pull in that Git build have not been tested.** The [VCR guide](https://vercel.com/kb/guide/how-to-use-vercel-container-registry) says the current-project build environment is automatically authenticated. We infer that the same-project base can be pulled; the first Preview build must confirm it. The local source-overlay build passed using the equivalent cached local image, which does not test cloud registry credentials.

## Where the data comes from

The bootstrap already exists as this immutable private image:

```
vcr.vercel.com/blinktag/bikesy-valhalla-preview/dockerfile@sha256:6619a51429b555a865eabbe99bae03cb0d9676b1c5a47a0d33cd44c09a810da1
```

It holds the patched amd64 engine, 46 graph tiles, six HGT rasters, admin DB, policy/stair indexes and config. Docker pulls those image layers during the build. Git contains only code, fixture snippets and hashes. The image digest pins the artifact; `graph/deployed-runtime.lock.json` binds individual files. Keep this base through deployment cleanups. Deleting its deployment-associated image can break future builds even if an already-built deployment still runs. A later separately named `routing-data` repository can hold releases independently; creating/pushing it is a separate approved maintenance operation.

The registry is project-private; the digest is an identifier, not a credential. For a new developer machine, use authorized `vercel link --scope blinktag --project bikesy-valhalla-preview`, then `vercel vcr login docker`, which creates a short-lived project credential. These setup commands were not run during packaging. Never commit `.vercel`, `.env`, Docker credentials or signed transfer URLs. Another Vercel project needs separately authorized access or its own copied data image.

## Costs and limits

The retained base is 642,651,541 bytes (about 613 MiB compressed). VCR currently lists $0.10/GB storage, 2 GB per compressed layer and 15 GB total image size; actual billing depends on storage usage/account terms. See [current VCR pricing and limits](https://vercel.com/docs/container-registry/limits-and-pricing). Builds, function CPU/memory and traffic are additional; repeated Git pushes create images/deployments. No new hosted storage, deployment, credential or paid account was created for this source handoff. Prune superseded app releases only after checking base-image and rollback dependencies.
