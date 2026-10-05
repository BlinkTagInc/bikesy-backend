"""Rebuild the isolated California variant. See docs/DATA.md for its input contract.
Run inside the pinned toolchain with /work source and a FRESH /data directory.
No downloads, service launches, access widening, or source checkout mutations.
"""
import pathlib,json,subprocess,hashlib,shutil,os,argparse
p=argparse.ArgumentParser();p.add_argument("--project",type=pathlib.Path,default=pathlib.Path("/work"));p.add_argument("--data",type=pathlib.Path,default=pathlib.Path("/data"));args=p.parse_args()
W=args.project.resolve();D=args.data.resolve();E=W/'build/evidence';engine=W/'engine'
E.mkdir(parents=True,exist_ok=True)
for name in ['target-ways.json','baseline-access-overrides.json','baseline-graph-edges.jsonl']:shutil.copyfile(W/'graph'/name,E/name)
def run(args,log=None,cwd=None):
 if log:
  with (E/log).open('w') as f:subprocess.run(list(map(str,args)),cwd=cwd,stdout=f,stderr=subprocess.STDOUT,check=True)
 else:subprocess.run(list(map(str,args)),cwd=cwd,check=True)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
assert all((D/x).exists() for x in ['region.osm.pbf','admin-input.osm.pbf','elevation'])
assert not any((D/x).exists() for x in ['tiles','tiles-before-access','admin.sqlite','bikesy-policy.bin','bikesy-stairs.txt']), 'Fresh data directory required'
# Lock to the tested source inputs; changing the extract requires renewed geographic review.
locked=json.loads((W/'graph/inputs.lock.json').read_text())
for name,digest in locked.items():assert sha(D/name)==digest, f'Input mismatch: {name}'
run(['python3',engine/'apply_patch.py','--check'])
run(['sh','build.sh'],'rebuild-engine.log',engine)
run(['python3',W/'scripts/check-bicycle-access.py'],'lua-access-tests.log')
run(['python3',W/'scripts/check-facilities.py'],'lua-facility-tests.log')
run(['python3',W/'scripts/prepare-bicycle-access.py',D])
cfg=json.loads((W/'config/valhalla-build.json').read_text());cfg['mjolnir'].update(tile_dir=str(D/'tiles'),tile_extract='',admin=str(D/'admin.sqlite'),graph_lua_name=str(D/'bikesy-graph.lua'));cfg['additional_data']['elevation']=str(D/'elevation');(D/'valhalla.json').write_text(json.dumps(cfg,indent=2))
run(['valhalla_build_admins','-c',D/'valhalla.json',D/'admin-input.osm.pbf'],'rebuild-admin.log')
run([engine/'out/export_country'],'us-access-defaults.json')
run(['python3',W/'scripts/complete-regional-admin.py',D/'admin.sqlite',E/'us-access-defaults.json'])
(D/'tiles').mkdir()
run(['valhalla_build_tiles','--concurrency','2','-c',D/'valhalla.json',D/'region.osm.pbf'],'rebuild-graph.log')
run([engine/'out/graph_quality',D/'valhalla.json',E/'target-ways.json',E/'corrected-graph-edges.jsonl'],'corrected-graph-quality.json')
run(['python3',W/'scripts/check-graph-quality.py',E])
run(['python3',W/'scripts/remap-access.py',W/'build',E/'baseline-access-overrides.json'])
policy=json.loads((E/'access-overrides-rebound.json').read_text());policy['input_graph_files']={str(p.relative_to(D/'tiles')):sha(p) for p in sorted((D/'tiles').rglob('*.gph'))};(E/'access-overrides.json').write_text(json.dumps(policy,indent=2))
shutil.copytree(D/'tiles',D/'tiles-before-access')
run(['python3',engine/'apply-access.py',D/'valhalla.json',E/'access-overrides.json'],'rebuild-access.log')
run([engine/'out/validate_access',D/'valhalla.json',E/'access-overrides.json',D/'tiles-before-access'],'access-invariants.jsonl')
# Use the OSM extraction buffer, not the smaller user-facing service bounds.
run([engine/'out/build_policy',D/'valhalla.json',D/'bikesy-policy.bin','-123.15','37.20','-121.51','38.42'],'rebuild-policy.log')
run(['python3',W/'scripts/extract-stair-tags.py',D/'region.osm.pbf',E])
run(['python3',W/'scripts/build-stairs.py',E/'corrected-graph-edges.jsonl',E/'stair-tags.json',D/'bikesy-stairs.txt'])
os.environ.update(BIKESY_POLICY_DATA=str(D/'bikesy-policy.bin'),BIKESY_STAIRS_DATA=str(D/'bikesy-stairs.txt'))
run([engine/'out/engine_cost_test',D/'valhalla.json'],'engine-cost-tests.json')
bound=[D/'admin.sqlite',D/'bikesy-policy.bin',D/'bikesy-stairs.txt',D/'valhalla.json',*sorted((D/'tiles').rglob('*.gph')),*sorted((D/'elevation').rglob('*.hgt'))]
(E/'gated-build.json').write_text(json.dumps({'passed':True,'engine_sha256':sha(engine/'out/valhalla_service'),'files':{str(p.relative_to(D)):sha(p) for p in bound}},indent=2)+'\n')
print('Graph, facility, exact access rebinding, and stair-cost gates passed; no service started.')
