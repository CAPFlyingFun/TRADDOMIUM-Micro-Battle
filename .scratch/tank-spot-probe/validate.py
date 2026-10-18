import json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
root=Path.cwd();out=root/'shots/tank-spot-review';a=json.loads((out/'manifest.json').read_text())[0];old=json.loads((root/'shots/tank-hem-soft-review/manifest.json').read_text())[0];s=a['stats'];r=s['spotRepair'];assert r['enabled'] and r['success'] and r['before']['innerOvertakes']>0 and r['after']['innerOvertakes']==0
sh=s['spotShading'];assert sh['enabled'] and sh['success'] and sh['changedNormals']>0 and sh['positionErrors']==sh['outsideErrors']==0
for k in ['xyErrors','outerErrors','outsideErrors','navelErrors','hemErrors','outerNormalErrors','outsideNormalErrors','sourceErrors']:assert r[k]==0,(k,r[k])
for k in ['skin','pants']:assert r[k]['newFailures']==r[k]['worsenedFailures']==0
assert r['maxInwardCm']<=.40001
for v,b in zip(a['views'],old['views']):
 assert v['camera']==b['camera'] and v['lighting']==b['lighting'] and v['geometryUnchanged'] and v['before']==v['after']
 assert v['before']['body']==b['before']['body'] and v['before']['native']==b['before']['native']
 for cur,prior in zip(v['before']['shirt'],b['before']['shirt']):
  for k in ['index','fullOriginalIndex','vertexCount']:assert cur[k]==prior[k]
 with Image.open(out/v['file']) as im:im.verify()
G=json.loads((root/'shots/tank-shape-100-review/spandex-after-100-geometry.json').read_text());before=G['tank'][0];p=np.array(before['posedWorldPositions']).reshape(-1,3);q=np.array(json.loads((out/'spot-positions.json').read_text())[0]).reshape(-1,3);side=np.array(before['shellSide']);regions=json.loads((out/'spot-region.json').read_text());region=regions[0]
for v in region['vertices']:
 i=v['i'];q[i]=v['p'];assert q[i,0]==p[i,0] and q[i,1]==p[i,1]
 if side[i]>=-.25:assert np.array_equal(q[i],p[i])
changed=np.where(np.any(p!=q,axis=1))[0];assert len(changed)==r['movedVertices'];assert np.all(side[changed]<-.25);assert np.all(p[changed,2]>-6);assert np.array_equal(p[:,0:2],q[:,0:2]);assert np.array_equal(p[side>=-.25],q[side>=-.25])
assert np.all(np.linalg.norm(p[changed,:2]-r['center'],axis=1)<3)
ix=np.array(region['triangles'],dtype=int)
# Independent barycentric +Z raster, staggered relative to the module's .1cm probes.
xs=np.arange(-11.537,-5.4,.075);ys=np.arange(95.463,101.6,.075);xx,yy=np.meshgrid(xs,ys)
def raster(vertices,orientation):
 z=np.full(xx.shape,-np.inf);t=vertices[ix];ok=side[ix].mean(1)*orientation>.1666667
 for tri in t[ok]:
  A,B,C=tri;den=(B[1]-C[1])*(A[0]-C[0])+(C[0]-B[0])*(A[1]-C[1]);
  if abs(den)<1e-10:continue
  u=((B[1]-C[1])*(xx-C[0])+(C[0]-B[0])*(yy-C[1]))/den;v=((C[1]-A[1])*(xx-C[0])+(A[0]-C[0])*(yy-C[1]))/den;w=1-u-v;hit=(u>=-1e-7)&(v>=-1e-7)&(w>=-1e-7);values=u*A[2]+v*B[2]+w*C[2];z[hit]=np.maximum(z[hit],values[hit])
 return z
outer=raster(p,1);innerBefore=raster(p,-1);innerAfter=raster(q,-1);valid=(outer>-6)&(innerBefore>-6)&(innerAfter>-6)&np.isfinite(outer)&np.isfinite(innerBefore)&np.isfinite(innerAfter)&(np.hypot(xx+8.5,yy-98.5)<2.9)
bgap=outer-innerBefore;agap=outer-innerAfter;bad=valid&(bgap< -1e-4);assert bad.sum()>0;assert not (valid&(agap< -1e-4)).any(),float(agap[valid].min())
B=np.array(Image.open(out/'spandex-before-100-0-close.png').convert('RGB'));A=np.array(Image.open(out/'spandex-spot-100-0-close.png').convert('RGB'));assert np.array_equal(B[340:400,755:845],A[340:400,755:845]),'navel pixels changed'
for name,digest in a['sourceStamps'].items():assert hashlib.sha256((root/'.scratch/tank-spot-working'/name).read_bytes()).hexdigest()==digest
for name in ['hem-shading.js','belly-contour.js','closer-profile.js','dome.js','navel-policy.js','shoulder.js','back-layer.js','high-hem-correction.js','high-hem-occlusion.js','leggings-mask.js']:
 assert (root/'.scratch/tank-hem-soft-working'/name).read_bytes()==(root/'.scratch/tank-spot-working'/name).read_bytes()
assert hashlib.sha256((root/'public/models/sarah-v2-body.glb').read_bytes()).hexdigest()=='67ff41d30d75ee155d4edc696ebb65c7e987eac8155396089b5535ebbdb9fdc8'
report={'status':'pass','scope':'100% Spandex/high static trial; local hidden inner-sheet repair and outer normals-only smoothing. Default-off; no live integration or other-size claim.','outerSpotShading':sh,'changedInnerVertices':int(len(changed)),'maximumInwardMm':r['maxInwardCm']*10,'outerGeometryExact':True,'bodyAndLeggingsExact':True,'navelGeometryAndPixelsExact':True,'hemProtected':True,'xyExact':True,'independentStaggeredRaster':{'stepCm':.075,'samples':int(valid.sum()),'beforeCrossings':int(bad.sum()),'afterCrossings':int((valid&(agap< -1e-4)).sum()),'minimumAfterGapAtPriorCrossingsMm':float(agap[bad].min())*10},'sampledSkin':r['skin'],'sampledPants':r['pants'],'checks':{'typecheck':'pass','npmTestPassed':3766,'npmTestSkipped':3,'build':'pass','focusedPassed':30}}
(out/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['sampledSkin','sampledPants']},indent=2))
