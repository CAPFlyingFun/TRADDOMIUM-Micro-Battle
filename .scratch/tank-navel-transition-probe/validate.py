from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
p=Path('shots/navel-transition-review');m=json.loads((p/'manifest.json').read_text());s=m['smoothing'];assert s['success'] and s['changedNormals']>0 and s['positionErrors']==s['protectedErrors']==0
a=json.loads((p/'before-region.json').read_text());b=json.loads((p/'after-region.json').read_text());center=m['fitStats']['bareNavelAnchor'];changed=core=0;max_angle=0
for x,y in zip(a,b):
 assert x['triangles']==y['triangles'];assert len(x['vertices'])==len(y['vertices'])
 for v,w in zip(x['vertices'],y['vertices']):
  assert v['i']==w['i'] and v['p']==w['p'] and v['o']==w['o'];r=np.linalg.norm(np.array(v['p'][:2])-center[:2]);diff=v['n']!=w['n']
  if r<=.65:core+=1;assert not diff
  if diff:
   assert .65<r<2.4 and v['p'][2]>center[2]-6;changed+=1
   u=np.array(v['n']);q=np.array(w['n']);max_angle=max(max_angle,float(np.degrees(np.arccos(np.clip(np.dot(u,q)/np.linalg.norm(u)/np.linalg.norm(q),-1,1)))))
assert changed==s['changedNormals'];assert core>0
for angle in [0,90,45]:
 old=next(v for v in m['views'] if v['phase']=='before' and v['angleDegrees']==angle);new=next(v for v in m['views'] if v['phase']=='after' and v['angleDegrees']==angle)
 assert old['camera']==new['camera'] and old['lighting']==new['lighting'];assert old['before']==new['before'] and old['after']==new['after'];assert old['geometryUnchanged'] and new['geometryUnchanged']
 for v in [old,new]:
  with Image.open(p/v['file']) as im:im.verify()
for name,h in m['sources'].items():assert hashlib.sha256((Path('.scratch/tank-navel-transition-working')/name).read_bytes()).hexdigest()==h
# Fresh pre-edit front crop matches the saved approved preview exactly.
old=np.asarray(Image.open('shots/tank-spot-review/spandex-spot-100-0-close.png'));restored=np.asarray(Image.open('shots/recovery-check/spandex-spot-100-0-close.png'));assert np.array_equal(old[315:425,730:870],restored[315:425,730:870])
report={'status':'pass','scope':'100% Spandex/high static local navel shading trial; not a release candidate','changedOuterNormals':changed,'maximumNormalRotationDegrees':max_angle,'protectedCoreVertices':core,'allSurfacePositionsExact':True,'bodyAndLeggingsStampsExactWithinTrial':True,'centerAndProjectionExact':True,'cameraAndLightingExact':True,'approvedFrontNavelCropRecoveredExactly':True,'recoveryLimitation':'Unpublished full alpha.98 checkout/GLB not recovered; current Git main is alpha.97. Full candidate body/pants hashes differ. No whole-candidate or release validation claim.'}
(p/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
