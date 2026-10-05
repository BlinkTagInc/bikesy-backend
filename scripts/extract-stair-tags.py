import pathlib,json,zlib,struct
import sys
P=pathlib.Path(sys.argv[2]);out={}
def var(b,i):
 n=s=0
 while True:
  c=b[i];i+=1;n|=(c&127)<<s
  if c<128:return n,i
  s+=7
def fields(b):
 i=0
 while i<len(b):
  key,i=var(b,i);wire=key&7
  if wire==0:v,i=var(b,i)
  elif wire==2:l,i=var(b,i);v=b[i:i+l];i+=l
  elif wire in (1,5):l=8 if wire==1 else 4;v=b[i:i+l];i+=l
  else:raise ValueError(wire)
  yield key>>3,v
def packed(b):
 i=0
 while i<len(b):v,i=var(b,i);yield v
with pathlib.Path(sys.argv[1]).open('rb')as f:
 while head:=f.read(4):
  h=dict(fields(f.read(struct.unpack('>I',head)[0])));blob=dict(fields(f.read(h[3])))
  if h[1]!=b'OSMData':continue
  raw=blob.get(1)or zlib.decompress(blob[3]);groups=[];strings=[]
  for k,v in fields(raw):
   if k==1:strings=[s.decode('utf8')for _,s in fields(v)]
   if k==2:groups.append(v)
  for g in groups:
   for k,v in fields(g):
    if k!=3:continue
    w=dict(fields(v));wid=w[1]
    t={strings[k]:strings[v]for k,v in zip(packed(w.get(2,b'')),packed(w.get(3,b'')))}
    if t.get('highway')=='steps':out[wid]=t
(P/'stair-tags.json').write_text(json.dumps(out,indent=2));print('stair ways',len(out))
