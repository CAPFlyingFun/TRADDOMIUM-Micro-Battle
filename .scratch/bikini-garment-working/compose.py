from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
p=Path('shots/bikini-garment-review');m=json.loads((p/'manifest.json').read_text());c=m['change'];assert c['bodyExact'] and c['topExact'];assert c['cloth']['penetrating']==c['trimPenetrations']==c['triangleCenterPenetrations']==0
assert [v['angle'] for v in m['views']]==[0,90,180,45,135]
assert all(v['before']==v['after']==m['views'][0]['before'] for v in m['views'])
assert all(v['camera']==m['views'][0]['camera'] and v['lighting']==m['views'][0]['lighting'] for v in m['views'])
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',28);s=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
im=Image.new('RGB',(1800,1300),'#1b2028');d=ImageDraw.Draw(im)
d.text((22,16),'Bikini bottom refinement · 100% belly · five matched views',font=f,fill='#eee8df')
d.text((22,57),'Curved low front · higher hips/back · continuous cloth and rounded binding',font=s,fill='#e2bd7d')
d.text((22,89),'Static alpha.97 body reference · body / bikini top unchanged · no push',font=s,fill='#d2d5d9')
for i,(a,label) in enumerate([(0,'Front'),(90,'Direct side'),(180,'Direct back'),(45,'45° front'),(135,'45° back')]):
 x=(i%3)*600;y=140+(i//3)*565
 with Image.open(p/f'proposed-{a}.png') as src:im.paste(src.crop((150,380,1050,1130)).resize((600,500),Image.Resampling.LANCZOS),(x,y))
 d.text((x+22,y+508),label,font=f,fill='#e2bd7d')
with Image.open(p/'proposed-0.png') as src:im.paste(src.crop((260,660,940,1060)).resize((600,353),Image.Resampling.LANCZOS),(1200,760))
d.text((1222,1213),'Front edge / panel close-up',font=s,fill='#e2bd7d')
d.text((22,1263),'Placement/shape review only · runtime pose and size-range integration pending',font=s,fill='#d2d5d9')
im.save(p/'bikini-bottom-five-view-review.png')
with Image.open(p/'bikini-bottom-five-view-review.png') as x:x.verify()
print('Five views checked: matched cameras/light, protected body/top, no sampled penetration')
