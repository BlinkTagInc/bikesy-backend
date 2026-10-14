#!/usr/bin/env python3
"""Check source/build prerequisites without downloading, building or deploying."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--build', action='store_true', help='Also require Docker, osmium and build resources')
p.add_argument('--toolchain', action='store_true', help='Check inside the Linux build container')
p.add_argument('--workdir', type=Path, default=Path.cwd())
p.add_argument('--minimum-free-gib', type=float, default=8)
a = p.parse_args()
issues = []
if sys.version_info < (3, 12): issues.append('Python >=3.12 required; invoke this script with that interpreter')
for executable in ['node'] + (['docker'] if a.build else []) + (['osmium', 'g++', 'valhalla_build_tiles', 'valhalla_build_admins'] if a.toolchain else []):
    if not shutil.which(executable): issues.append(f'Missing {executable} on PATH')
if shutil.which('node'):
    version = subprocess.check_output(['node', '-p', 'process.versions.node'], text=True).strip()
    if tuple(map(int, version.split('.')[:2])) < (22, 9): issues.append('Node >=22.9 required')
free = shutil.disk_usage(a.workdir).free / 1024**3
if a.build and free < a.minimum_free_gib: issues.append(f'Need {a.minimum_free_gib} GiB free disk; found {free:.1f}')
docker = None
if a.build and shutil.which('docker'):
    result = subprocess.run(['docker', 'info', '--format', '{{json .}}'], text=True, capture_output=True)
    if result.returncode: issues.append('Docker daemon unavailable; start it and verify access')
    else:
        info = json.loads(result.stdout)
        docker = {key: info.get(key) for key in ['NCPU', 'MemTotal', 'Architecture']}
        if info.get('NCPU', 0) < 2 or info.get('MemTotal', 0) < 6 * 1024**3: issues.append('Build needs at least 2 CPUs and 6 GiB Docker memory')
print(json.dumps({'passed': not issues, 'python': sys.executable, 'free_gib': round(free, 1), 'docker': docker, 'issues': issues}, indent=2))
raise SystemExit(bool(issues))
