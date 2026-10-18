import json,numpy as np
from pathlib import Path
G=json.loads(Path('shots/tank-shape-100-review/spandex-after-100-geometry.json').read_text());m=G['tank'][0];s=np.array(m['shellSide'])
def hits(p,ix,x,y,side=None):
 t=np.asarray(p).reshape(-1,3)[np.asarray(ix,dtype=int).reshape(-1,3)];ids=np.asarray(ix,dtype=int).reshape(-1,3)
 keep=(t[:,:,0].max(1)>=x)&(t[:,:,0].min(1)<=x)&(t[:,:,1].max(1)>=y)&(t[:,:,1].min(1)<=y)&(t[:,:,2].max(1)>0);t=t[keep];ids=ids[keep]
 a,b,c=t[:,0],t[:,1],t[:,2];den=(b[:,1]-c[:,1])*(a[:,0]-c[:,0])+(c[:,0]-b[:,0])*(a[:,1]-c[:,1]);ok=abs(den)>1e-10;u=np.zeros(len(t));v=u.copy();np.divide((b[:,1]-c[:,1])*(x-c[:,0])+(c[:,0]-b[:,0])*(y-c[:,1]),den,out=u,where=ok);np.divide((c[:,1]-a[:,1])*(x-c[:,0])+(a[:,0]-c[:,0])*(y-c[:,1]),den,out=v,where=ok);w=1-u-v;hit=ok&(u>=-1e-7)&(v>=-1e-7)&(w>=-1e-7);z=u*a[:,2]+v*b[:,2]+w*c[:,2];idx=np.where(hit)[0];idx=idx[np.argsort(-z[idx])]
 return [(float(z[k]),float(side[ids[k]].mean()) if side is not None else None,ids[k].tolist()) for k in idx]
report=[]
S=json.loads(Path('shots/tank-shape-100-review/stages.json').read_text())
for x,y in [(-8.5,98.5),(-8,99),(-9,99),(-9,98.5),(-8.5,98)]:
 row={'xy':[x,y]}
 for key,parts in S['stages'].items():row[key]=[h for p in parts for h in hits(p['positions'],p['indices'],x,y,s)]
 row['final']=hits(m['posedWorldPositions'],m['renderedIndices'],x,y,s)
 row['body']=hits(G['body']['positions'],G['body']['indices'],x,y)
 row['pants']=[h for p in G['nativeHigh'] for h in hits(p['posedWorldPositions'],p['renderedIndices'],x,y)]
 report.append(row);print(json.dumps(row))
Path('shots/tank-spot-review/trace.json').write_text(json.dumps(report,indent=2))
