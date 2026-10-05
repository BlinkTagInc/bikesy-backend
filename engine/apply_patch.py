#!/usr/bin/env python3
"""Verify pinned upstream, reconstruct the complete patch, and compare source.

Default/--check leaves source untouched. --apply restores the two patched files
after verifying their reconstructed hashes; custom headers stay checked-in.
"""
import argparse,hashlib,json,pathlib,re
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--check',action='store_true')
p.add_argument('--apply',action='store_true')
a=p.parse_args();root=pathlib.Path(__file__).resolve().parent
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for item in json.loads((root/'source-lock.json').read_text())['files']:
 assert digest(root/'upstream'/item['path'])==item['sha256'],item['path']
locked=json.loads((root/'patched-source.lock.json').read_text())
# Strict context matching; no fuzz, external patch dependency, or network access.
lines=(root/'bikesy-3.5.1.patch').read_text().splitlines(True);i=0;outputs={}
sources={'bicyclecost.cc':'src/sif/bicyclecost.cc','route_action.cc':'src/thor/route_action.cc'}
while i<len(lines):
 assert lines[i].startswith('--- a/');name=lines[i][6:].strip();i+=1
 assert name in sources and name not in outputs
 assert lines[i].strip()=='+++ b/'+name;i+=1
 original=(root/'upstream'/sources[name]).read_text().splitlines(True);result=[];pos=0
 while i<len(lines) and lines[i].startswith('@@ '):
  h=re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\n',lines[i]);assert h
  start=int(h[1])-1;assert start>=pos;result.extend(original[pos:start]);pos=start;i+=1;old_count=new_count=0
  while i<len(lines) and not lines[i].startswith(('@@ ','--- a/')):
   line=lines[i];i+=1;assert line[0] in ' +-'
   if line[0] in ' -':assert original[pos]==line[1:];pos+=1;old_count+=1
   if line[0] in ' +':result.append(line[1:]);new_count+=1
  assert old_count==int(h[2] or 1) and new_count==int(h[4] or 1)
 result.extend(original[pos:]);outputs[name]=''.join(result)
assert set(outputs)==set(sources)
for name,content in outputs.items():
 assert hashlib.sha256(content.encode()).hexdigest()==locked['src/'+name],f'Patch output mismatch: {name}'
 if a.apply:(root/'src'/name).write_text(content)
for name,sha in locked.items():assert digest(root/name)==sha,f'Patched source mismatch: {name}'
print('Pinned upstream and complete graph/stair engine patch verified')
