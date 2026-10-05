#!/usr/bin/env python3
"""Run in the pinned engine image; exercise real stock Lua plus the narrow wrapper."""
import ctypes
import json
from pathlib import Path
root=Path(__file__).resolve().parent
fixtures=json.loads((root.parent/'test/fixtures/bicycle-access.json').read_text())
lib=ctypes.CDLL('libluajit-5.1.so.2')
lib.luaL_newstate.restype=ctypes.c_void_p
for name in ('luaL_openlibs','lua_close'):
    getattr(lib,name).argtypes=[ctypes.c_void_p]
lib.luaL_loadstring.argtypes=[ctypes.c_void_p,ctypes.c_char_p]
lib.lua_pcall.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_int,ctypes.c_int]
lib.lua_tolstring.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p]
lib.lua_tolstring.restype=ctypes.c_char_p
state=lib.luaL_newstate();lib.luaL_openlibs(state)
def execute(source):
    code=lib.luaL_loadstring(state,source.encode())
    if code==0:
        code=lib.lua_pcall(state,0,0,0)
    if code:
        raise RuntimeError(lib.lua_tolstring(state,-1,None).decode())
try:
    execute((root/'vendor/valhalla-3.5.1-graph.lua').read_text())
    execute('baseline_ways=ways_proc; baseline_nodes=nodes_proc; baseline_rels=rels_proc')
    execute((root/'bicycle-access.lua').read_text())
    execute('assert(nodes_proc==baseline_nodes and rels_proc==baseline_rels)')
    for case in fixtures:
        tags={'highway':'residential',**case['tags']}
        literal='{'+','.join('['+json.dumps(k)+']='+json.dumps(v) for k,v in tags.items())+'}'
        expected='true' if case['normalize'] else 'false'
        execute(f'''
          local input={literal}; local a={{}}; local b={{}}; local count=0
          for k,v in pairs(input) do a[k]=v; b[k]=v; count=count+1 end
          local fa,ta=baseline_ways(a,count); local fb,tb=ways_proc(b,count)
          assert(fa==fb, 'filter changed')
          local exempt={expected}
          if exempt then assert(tb.private=='false' and tb.no_thru_traffic=='false') end
          for k,v in pairs(ta) do
            if not exempt or (k~='private' and k~='no_thru_traffic') then
              assert(tb[k]==v,'unexpected field change: '..k)
            end
          end
          for k,v in pairs(tb) do assert(ta[k]~=nil,'unexpected added field: '..k) end
        ''')
        print('PASS',case['name'])
    print(json.dumps({'lua_regressions_passed':len(fixtures)}))
finally:
    lib.lua_close(state)
