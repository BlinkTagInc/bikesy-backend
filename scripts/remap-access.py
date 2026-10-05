"""Rebind narrow directed exceptions by exact OSM way, orientation and full shape.
Never reuse old graph IDs on a different graph or widen a segment to a whole way.
"""
import json,pathlib,sys,collections,hashlib
P=pathlib.Path(sys.argv[1]);old=json.loads((pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else P/'evidence/baseline-access-overrides.json').read_text())
def read(name):return[json.loads(l)for l in(P/'evidence'/name).read_text().splitlines()]
before={e['id']:e for e in read('baseline-graph-edges.jsonl')};after=read('corrected-graph-edges.jsonl');index=collections.defaultdict(list)
def key(e):return e['way'],e['forward'],json.dumps(e['shape'],separators=(',',':'))
for e in after:index[key(e)].append(e)
proof=[]
for item in old['allow_directed_edges']:
 src=before[item['graph_id']];matches=index[key(src)]
 if len(matches)!=1:raise ValueError(f'Exact directed segment match failed: {item}')
 dst=matches[0]
 if not dst['bike']:raise ValueError('Rebuilt graph explicitly excludes this exception; do not grant access')
 proof.append({'way':src['way'],'old_id':src['id'],'new_id':dst['id'],'forward':src['forward'],'length':src['length'],'shape_sha256':hashlib.sha256(key(src)[2].encode()).hexdigest()})
 item['graph_id']=dst['id']
old.pop('input_graph_files',None)
old['rebinding']='Exact unchanged OSM way + travel orientation + complete geometry; see remapped-directed-proof.json. Apply only with separate fresh graph fingerprint.'
(P/'evidence/access-overrides-rebound.json').write_text(json.dumps(old,indent=2));(P/'evidence/remapped-directed-proof.json').write_text(json.dumps(proof,indent=2));print('exact segment exceptions rebound',len(proof))
