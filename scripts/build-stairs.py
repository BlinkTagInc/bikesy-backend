import json,pathlib,sys,runpy,collections,hashlib
policy=runpy.run_path(str(pathlib.Path(__file__).with_name('stair-policy.py')))['flight_policy']
graph=pathlib.Path(sys.argv[1]);tags=json.loads(pathlib.Path(sys.argv[2]).read_text());dest=pathlib.Path(sys.argv[3]);byway=collections.defaultdict(list)
for l in graph.read_text().splitlines():
    e=json.loads(l)
    if e['use']==26:byway[e['way']].append(e)
records=[];flights=[]
for way,es in sorted(byway.items()):
    ids={e['id']for e in es};physical={}
    for e in es:
        if e['opposing']not in ids:raise ValueError('Missing opposite stair edge')
        key=min(e['id'],e['opposing']);length=e['length']
        if key in physical and physical[key]!=length:raise ValueError('Opposing edge lengths disagree')
        physical[key]=length
    total=sum(physical.values());p=policy(tags[str(way)],total);sums=collections.Counter()
    for e in es:
        cost=p['penalty_m']*e['length']/total;records.append((e['id'],cost));sums[e['forward']]+=cost
    for cost in sums.values():
        if abs(cost-p['penalty_m'])>1e-6:raise ValueError('Split-way allocation doubled/missed a penalty')
    flights.append({'way':way,**p,'physical_segments':len(physical),'directed_edges':len(es),'forward_penalty_sum':sums[1],'reverse_penalty_sum':sums[0]})
if not records:raise ValueError('No stair metadata')
dest.write_text('BIKESY_STAIRS_V1 '+str(len(records))+'\n'+''.join(f'{i} {c:.9f}\n'for i,c in sorted(records)))
dest.with_suffix('.json').write_text(json.dumps({'policy':'counted-stairs-v1','allocation':'Full OSM way penalty prorated across unique physical stair segments; same total per direction; partial edges prorate again in routing. No per-transition charges.','graph_export_sha256':hashlib.sha256(graph.read_bytes()).hexdigest(),'flights':flights},indent=2))
print('stair ways',len(flights),'directed records',len(records),'tagged reliable',sum(f['trusted_step_count']is not None for f in flights))
