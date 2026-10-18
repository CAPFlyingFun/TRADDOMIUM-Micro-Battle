from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json
p=Path('shots/bikini-hip-rise-trial');m=json.loads((p/'manifest.json').read_text())
assert m['change']['bodyExact'] and all(x['success'] and x['upperErrors']==0 for x in m['change']['parts'])
assert all(v['before']==v['after'] for v in m['views'])
assert all(v['camera']==m['views'][0]['camera'] and v['lighting']==m['views'][0]['lighting'] for v in m['views'])
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',28);s=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
im=Image.new('RGB',(1800,1350),'#1b2028');d=ImageDraw.Draw(im)
d.text((22,16),'Higher hips / low front — 100% belly placement concept',font=f,fill='#eee8df')
d.text((22,57),'alpha.97 reference asset · approved alpha.98 bottom unavailable · body / bikini top unchanged',font=s,fill='#e2bd7d')
for row,(phase,title) in enumerate([('before','Before: older low-rise bottom'),('proposed','Trial: raised hips and back, low front center')]):
 y=105+row*595;d.text((22,y),title,font=f,fill='#eee8df')
 for col,(angle,label) in enumerate([(0,'Front'),(90,'Direct side'),(180,'Back')]):
  with Image.open(p/f'{phase}-{angle}.png') as src:im.paste(src.crop((150,380,1050,1130)).resize((600,500),Image.Resampling.LANCZOS),(600*col,y+44))
  d.text((600*col+22,y+550),label,font=s,fill='#ddc58c')
d.text((22,1310),'Static placement trial only · source fabric/tie roughness remains · no runtime changes or push',font=s,fill='#e2bd7d')
im.save(p/'bikini-higher-hip-comparison.png')
with Image.open(p/'bikini-higher-hip-comparison.png') as check:check.verify()
print('Verified comparison composed')
