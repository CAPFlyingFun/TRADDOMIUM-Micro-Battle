from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from io import BytesIO
import json
p=Path('shots/bikini-placement-reference');m=json.loads((p/'manifest.json').read_text());assert all(v['before']==v['after']==m['views'][0]['before'] for v in m['views']);assert all(v['camera']['distance']==123 and v['camera']['fov']==32 for v in m['views'])
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',27);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',23);im=Image.new('RGB',(1800,650),'#1b2028');d=ImageDraw.Draw(im);d.text((20,15),'DEPLOYED alpha.97 REFERENCE · 100% belly · T-pose for hip visibility',font=f,fill='#eee8df');d.text((20,53),'Older fitted bottom — approved alpha.98 procedural bottom is currently unavailable.',font=small,fill='#e2bd7d')
for c,(a,title) in enumerate([(0,'Front'),(90,'Direct side'),(180,'Back')]):
 with Image.open(p/f'{a}.png') as src:src.load();im.paste(src.crop((150,380,1050,1130)).resize((600,500),Image.Resampling.LANCZOS),(600*c,100))
 d.text((600*c+20,610),title,font=f,fill='#eee8df')
b=BytesIO();im.save(b,format='PNG');(p/'bikini-front-side-back-reference.png').write_bytes(b.getvalue())
with Image.open(p/'bikini-front-side-back-reference.png') as x:x.verify()
print('Three views verified: identical geometry, camera scale and scene lighting')
