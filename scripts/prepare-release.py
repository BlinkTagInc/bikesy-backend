#!/usr/bin/env python3
"""Create an isolated application Docker context bound to a packaged regional data image."""
from region_common import region_name
import sys
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--region', type=region_name, required=True)
parser.add_argument('--runtime', type=Path, required=True, help='Packaged runtime directory from package-data.py')
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--image', help='Published immutable data image reference (name@sha256:...)')
mode.add_argument('--bundle-data', action='store_true', help='Bundle verified local data and engine over public pinned base images; no private image needed')
parser.add_argument('--vercel-region', default='sfo1', help='Compute region, separate from routing geography')
parser.add_argument('--output', type=Path, required=True, help='New application build context')
a = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = a.runtime.resolve()
output = a.output.resolve()
if a.image and not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}', a.image):
    parser.error('--image must be an immutable image digest')
if not re.fullmatch(r'[a-z]{3}[0-9]', a.vercel_region):
    parser.error('Invalid Vercel compute region')
if output.exists():
    parser.error('--output must be a new directory')

def sha(path):
    with path.open('rb') as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
        return digest.hexdigest()

manifest = source / 'data/engine-policy.json'
lock = json.loads(manifest.read_text())
expected_policies = {'policy': 'bikesy-distance-v1', 'graph_access_policy': 'bikesy-access-v1', 'graph_import_policy': 'bikesy-import-v2', 'stair_policy': 'counted-stairs-v1'}
if any(lock.get(key) != value for key, value in expected_policies.items()):
    parser.error('Unsupported packaged engine/data policy')
if not {'valhalla.json', 'admin.sqlite', 'bikesy-policy.bin', 'bikesy-stairs.txt'}.issubset(lock['files']):
    parser.error('Packaged data is missing required runtime files')
if lock.get('region') != a.region:
    parser.error('Packaged data region does not match --region')
config = json.loads((root / 'config' / f'{a.region}.json').read_text())
if config['region'] != a.region or lock.get('build_config') != {key: config[key] for key in ['bounds', 'admin_states']}:
    parser.error('Packaged data uses different build settings; rebuild data before changing its bounds/admin states')
if sha(source / 'engine/valhalla_service') != lock['engine_sha256']:
    parser.error('Packaged engine differs from manifest')
for name, digest in lock['files'].items():
    path = (source / 'data' / name).resolve()
    if not path.is_relative_to(source / 'data') or sha(path) != digest:
        parser.error(f'Packaged data mismatch: {name}')
output.mkdir(parents=True)
for name in ['src', 'config']:
    shutil.copytree(root / name, output / name)
for name in ['package.json', 'serve.mjs', '.dockerignore', 'vercel.json']:
    shutil.copyfile(root / name, output / name)
(output / 'scripts').mkdir()
shutil.copyfile(root / 'scripts/verify-release.mjs', output / 'scripts/verify-release.mjs')
(output / 'graph').mkdir()
shutil.copyfile(manifest, output / 'graph/deployed-runtime.lock.json')
files = ['serve.mjs']
files += [str(p.relative_to(output)) for p in sorted((output / 'src').glob('*.js'))]
files += [f'config/{a.region}.json']
release = {
    'release': f'bikesy-{a.region}-candidate', 'region': a.region, 'runtime_image': a.image, 'data_delivery': 'bundled' if a.bundle_data else 'registry',
    'engine_sha256': lock['engine_sha256'], 'data_lock_sha256': sha(manifest),
    'runtime_files': {name: sha(output / name) for name in files},
    'git_deployment_verified': False,
}
(output / 'release.json').write_text(json.dumps(release, indent=2) + '\n')
# Render explicitly; never inherit another team's private image implicitly.
if a.bundle_data:
    shutil.copytree(source / 'data', output / 'runtime/data')
    shutil.copytree(source / 'engine', output / 'runtime/engine')
    dockerfile = (root / 'engine/Dockerfile.data').read_text().replace('COPY data /data', 'COPY runtime/data /data').replace('COPY engine/valhalla_service', 'COPY runtime/engine/valhalla_service')
    with (output / '.dockerignore').open('a') as stream:
        stream.write('\n!runtime\n!runtime/**\n')
else:
    dockerfile = f'ARG BIKESY_RUNTIME_IMAGE={a.image}\nFROM ${{BIKESY_RUNTIME_IMAGE}}\n'
dockerfile += f"""
USER root
WORKDIR /app
COPY package.json serve.mjs release.json ./
COPY src ./src
COPY config ./config
COPY graph/deployed-runtime.lock.json ./graph/deployed-runtime.lock.json
COPY scripts/verify-release.mjs ./scripts/verify-release.mjs
RUN chmod -R a+rX /app && node scripts/verify-release.mjs --image
USER 65534:65534
ENV PORT=80 BIKESY_CONFIG=/app/config/{a.region}.json MAX_CONCURRENT_ROUTES=2
EXPOSE 80
ENTRYPOINT ["node", "/app/serve.mjs"]
"""
vercel = json.loads((output / 'vercel.json').read_text())
vercel['regions'] = [a.vercel_region]
(output / 'vercel.json').write_text(json.dumps(vercel, indent=2) + '\n')
(output / 'Dockerfile.vercel').write_text(dockerfile)
subprocess.run(['node', str(output / 'scripts/verify-release.mjs')], check=True)
print(f'Prepared {output}; no image built or published. Build with docker build -f Dockerfile.vercel in that directory.')
