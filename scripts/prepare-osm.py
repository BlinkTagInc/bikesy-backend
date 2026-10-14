#!/usr/bin/env python3
"""Merge same-snapshot state extracts, then cut complete ways to configured bounds.

Requires osmium-tool. Administrative polygons are supplied separately and are
never clipped to the routing rectangle. Downloads and graph construction are separate.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('inputs', nargs='+', type=Path, help='Sorted state PBF files from the same OSM snapshot')
parser.add_argument('--config', type=Path, default=Path(os.environ.get('BIKESY_CONFIG') or Path(__file__).resolve().parents[1] / 'config/sf.json'))
parser.add_argument('--data', type=Path, required=True, help='Destination input directory')
parser.add_argument('--admin-input', type=Path, help='Prepared complete administrative polygon input to copy unchanged')
a = parser.parse_args()
config = json.loads(a.config.read_text())
b = config['bounds']
if not all(isinstance(b.get(k), (int, float)) and math.isfinite(b[k]) for k in ['left', 'bottom', 'right', 'top']) or not (-180 <= b['left'] < b['right'] <= 180 and -90 <= b['bottom'] < b['top'] <= 90):
    parser.error('Invalid configured bounds')
inputs = [p.resolve() for p in a.inputs]
if len(set(inputs)) != len(inputs) or not all(p.is_file() for p in inputs):
    parser.error('Inputs must be distinct existing files')
if a.admin_input and not a.admin_input.is_file():
    parser.error('--admin-input must be an existing file')
data = a.data.resolve()
outputs = ['region.osm.pbf', 'osm-preparation.json', 'inputs.lock.json']
if a.admin_input:
    outputs.append('admin-input.osm.pbf')
if any((data / name).exists() for name in outputs):
    parser.error('Refusing to replace prepared or locked inputs; use a fresh data directory')
if not shutil.which('osmium'):
    parser.error('osmium-tool is required (osmium executable not found)')

def run(*arguments, capture=False):
    result = subprocess.run(['osmium', *map(str, arguments)], check=True, capture_output=capture, text=True)
    return result.stdout.strip() if capture else None

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

# Osmium merge does not reconcile different snapshots. Fail before writing outputs.
timestamps = [run('fileinfo', '-g', 'header.option.osmosis_replication_timestamp', p, capture=True) for p in inputs]
if not all(timestamps) or len(set(timestamps)) != 1:
    parser.error('State extracts must have the same nonempty OSM replication timestamp; obtain matching snapshots')
data.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.osm-preparation-', dir=data) as work:
    work = Path(work)
    merged, region = work / 'merged.osm.pbf', work / 'region.osm.pbf'
    run('merge', *inputs, '-o', merged)
    if run('fileinfo', '-e', '-g', 'data.multiple_versions', merged, capture=True) != 'no':
        parser.error('Merged input contains multiple/unknown object versions; use consistent non-history extracts')
    bbox = ','.join(str(b[k]) for k in ['left', 'bottom', 'right', 'top'])
    run('extract', f'--bbox={bbox}', '--strategy=complete_ways', '--set-bounds', merged, '-o', region)
    run('check-refs', region)
    manifest = {
        'region': config['region'], 'bounds': b, 'snapshot': timestamps[0],
        'inputs': {str(p): sha(p) for p in inputs}, 'region_sha256': sha(region),
        'strategy': 'merge then complete_ways; check-refs verifies way node references',
    }
    if a.admin_input:
        admin = work / 'admin-input.osm.pbf'
        shutil.copyfile(a.admin_input, admin)
        manifest['admin_input'] = {'source': str(a.admin_input.resolve()), 'sha256': sha(admin)}
    receipt = work / 'osm-preparation.json'
    receipt.write_text(json.dumps(manifest, indent=2) + '\n')
    # Publish only complete outputs, without overwriting a concurrent preparation.
    os.link(region, data / 'region.osm.pbf')
    if a.admin_input:
        os.link(admin, data / 'admin-input.osm.pbf')
    os.link(receipt, data / 'osm-preparation.json')
print(f'Prepared {data}/region.osm.pbf from {len(inputs)} input extract(s). No graph built.')
