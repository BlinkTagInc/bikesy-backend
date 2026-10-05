#!/usr/bin/env python3
"""Package a gated rebuild into a NEW private runtime-image build context."""
import argparse,pathlib,json,hashlib,shutil
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('data',type=pathlib.Path)
p.add_argument('destination',type=pathlib.Path)
a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[1]
e=root/'build/evidence';source=a.data.resolve();dest=a.destination.resolve()
assert not dest.exists(),'Destination must be new'
gate=json.loads((e/'graph-quality-gate.json').read_text());assert gate['passed']
assert (e/'engine-cost-tests.json').stat().st_size and (e/'access-invariants.jsonl').stat().st_size
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
receipt=json.loads((e/'gated-build.json').read_text());assert receipt['passed']
assert sha(root/'engine/out/valhalla_service')==receipt['engine_sha256']
for name,expected in receipt['files'].items():assert sha(source/name)==expected,name
for name,expected in json.loads((root/'graph/inputs.lock.json').read_text()).items():assert sha(source/name)==expected,name
dest.mkdir(parents=True);(dest/'engine').mkdir();out=dest/'data';out.mkdir()
for name in ['tiles','elevation']:shutil.copytree(source/name,out/name)
for name in ['admin.sqlite','bikesy-policy.bin','bikesy-stairs.txt']:shutil.copyfile(source/name,out/name)
shutil.copyfile(root/'config/valhalla-runtime.json',out/'valhalla.json')
shutil.copyfile(root/'engine/out/valhalla_service',dest/'engine/valhalla_service')
files={str(f.relative_to(out)):sha(f) for f in sorted(out.rglob('*')) if f.is_file()}
lock={'policy':'bikesy-distance-v1','graph_access_policy':'bikesy-access-v1','graph_import_policy':'bikesy-import-v2','stair_policy':'counted-stairs-v1','engine_sha256':sha(dest/'engine/valhalla_service'),'files':files}
(out/'engine-policy.json').write_text(json.dumps(lock,indent=2)+'\n')
shutil.copyfile(root/'engine/Dockerfile.data',dest/'Dockerfile')
print(f'Packaged {len(files)} files. This creates no registry upload or deployment. Validate routes before publishing {dest}.')
