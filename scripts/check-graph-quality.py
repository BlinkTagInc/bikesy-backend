import json,pathlib,sys
P=pathlib.Path(sys.argv[1]);raw=(P/'corrected-graph-quality.json').read_text();
try:stats=json.loads(raw)
except json.JSONDecodeError:stats=json.loads(raw.splitlines()[-1])
assert stats['nodes']==stats['right_side_nodes'],'Wrong driving-side nodes remain';assert stats['bicycle_nodes']>1000000;assert stats['right_side_bicycle_nodes']==stats['bicycle_nodes'],'Wrong driving-side nodes remain'
rows=[json.loads(x)for x in(P/'corrected-graph-edges.jsonl').read_text().splitlines()];proof=[]
for way,expected in [(1384008086,3),(1427349494,3),(1383954427,3),(24335458,1)]:
 es=[e for e in rows if e['way']==way and e['bike']];assert es,f'Way {way} missing'
 assert {e['forward']for e in es}=={0,1},f'Way {way} lacks both directions'
 assert all(e['cyclelane']==expected and e['drive_on_right']for e in es),f'Wrong facility on {way}'
 proof.append({'way':way,'expected_facility':expected,'directions':[0,1],'edges':len(es)})
(P/'graph-quality-gate.json').write_text(json.dumps({'passed':True,'stats':stats,'exact_way_facility_checks':proof},indent=2));print('Graph quality gate passed',stats,proof)
