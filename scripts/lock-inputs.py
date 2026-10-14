#!/usr/bin/env python3
"""Freeze local OSM/DEM inputs, or verify them before an offline graph build."""
import argparse
import hashlib
import json
import math
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('data', type=Path)
parser.add_argument('config', type=Path)
parser.add_argument('--verify', action='store_true')
parser.add_argument('--build-lock', type=Path, help='Also export a flat input lock for the regional review directory')
parser.add_argument('--osm-source', help='Dated OSM extract URL or provenance description')
parser.add_argument('--dem-source', help='DEM source URL and acquisition date')
args = parser.parse_args()
root = args.data.resolve()
config = json.loads(args.config.read_text())
bounds = config['bounds']
# DEM must cover the entire declared extract rectangle, including border tiles.
required = []
for lat in range(math.floor(bounds['bottom']), math.floor(bounds['top']) + 1):
    for lon in range(math.floor(bounds['left']), math.floor(bounds['right']) + 1):
        ns = f'{"N" if lat >= 0 else "S"}{abs(lat):02}'
        ew = f'{"E" if lon >= 0 else "W"}{abs(lon):03}'
        required.append(Path('elevation') / ns / f'{ns}{ew}.hgt')
files = [Path('region.osm.pbf'), *sorted(p.relative_to(root) for p in (root / 'elevation').rglob('*') if p.is_file())]
if (root / 'admin-input.osm.pbf').is_file():
    files.append(Path('admin-input.osm.pbf'))
if args.build_lock and (args.build_lock.exists() or Path('admin-input.osm.pbf') not in files):
    parser.error('--build-lock requires admin-input.osm.pbf and a new output path')
for relative in required:
    path = root / relative
    if not path.is_file() or path.stat().st_size not in (1201 * 1201 * 2, 3601 * 3601 * 2):
        raise SystemExit(f'Missing or invalid uncompressed HGT tile: {relative}')
checksums = {}
for relative in files:
    with (root / relative).open('rb') as stream:
        checksums[str(relative)] = hashlib.file_digest(stream, 'sha256').hexdigest()
lockpath = root / 'inputs.lock.json'
if args.verify:
    lock = json.loads(lockpath.read_text())
    if lock['sha256'] != checksums or lock['bounds'] != bounds:
        raise SystemExit('Input checksum/bounds mismatch; restore locked inputs or explicitly create a new lock')
    print('OSM, DEM coverage and SHA-256 checksums verified')
else:
    if lockpath.exists():
        raise SystemExit('Lock exists; archive it before explicitly locking a new data release')
    if not args.osm_source or not args.dem_source:
        parser.error('--osm-source and --dem-source are required when creating a lock')
    with lockpath.open('x') as out:
        json.dump({'bounds': bounds, 'osm_source': args.osm_source,
                   'dem_source': args.dem_source, 'sha256': checksums}, out, indent=2)
        out.write('\n')
    print(lockpath)

if args.build_lock:
    args.build_lock.parent.mkdir(parents=True, exist_ok=True)
    with args.build_lock.open('x') as out:
        json.dump(checksums, out, indent=2)
        out.write('\n')
