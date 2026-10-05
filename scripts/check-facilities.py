"""Exercise real pinned Lua: specific-side precedence and unchanged access fields."""
import runpy,json
from pathlib import Path
base=Path(__file__).parent
setup=(base/'check-bicycle-access.py').read_text().split('try:\n')[0]
exec(setup)
cases=[
 ('both-track',{'cycleway:both':'track'},3,3),
 ('both-lane',{'cycleway:both':'lane'},2,2),
 ('right-no',{'cycleway:both':'track','cycleway:right':'no'},0,3),
 ('left-separate',{'cycleway:both':'lane','cycleway:left':'separate'},2,0),
 ('generic-specific',{'cycleway':'track','cycleway:right':'lane','cycleway:left':'no'},2,0),
 ('both-over-generic',{'cycleway':'lane','cycleway:both':'track'},3,3),
 ('both-denied',{'cycleway:both':'track','bicycle':'no'},3,3),
 ('oneway',{'cycleway:both':'lane','oneway':'yes'},2,2),
 ('reversed-oneway',{'cycleway:both':'lane','oneway':'-1'},2,2),
 ('contraflow',{'cycleway:right':'lane','cycleway:left':'opposite_lane','oneway':'yes'},2,2),
 ('side-explicit',{'cycleway:both':'track','cycleway:right':'lane'},2,3),
 ('shared-both',{'cycleway:both':'shared_lane'},1,1),
 ('bicycle-reverse-no',{'cycleway:both':'track','bicycle:backward':'no'},3,3),
]
try:
 execute((base/'vendor/valhalla-3.5.1-graph.lua').read_text());execute('baseline_ways=ways_proc');execute((base/'bicycle-access.lua').read_text())
 for name,t,right,left in cases:
  t={'highway':'residential',**t};literal='{'+','.join('['+json.dumps(k)+']='+json.dumps(v)for k,v in t.items())+'}'
  execute(f'''local input={literal};local a={{}};local b={{}};local n=0
   for k,v in pairs(input)do a[k]=v;b[k]=v;n=n+1 end
   local fa,ta=baseline_ways(a,n);local fb,tb=ways_proc(b,n)
   assert(fa==fb);assert(tb.cycle_lane_right=={right},'right {name}');assert(tb.cycle_lane_left=={left},'left {name}')
   for k,v in pairs(ta)do if not string.find(k,'cycle_lane',1,true)then assert(tb[k]==v,'access/nonfacility changed '..k..' {name}')end end
  ''');print('PASS',name)
 print(json.dumps({'facility_tests':len(cases),'passed':True}))
finally:lib.lua_close(state)
