from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
from io import BytesIO
out=Path('shots/tank-spot-review');font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',25)
for close in [False,True]:
 im=Image.new('RGB',(2400,2220),'#1b2028');d=ImageDraw.Draw(im)
 for c,(name,title) in enumerate([('bikini','Approved bikini / body'),('relaxed','Relaxed + high leggings'),('spandex-spot','Spandex · spot repaired')]):
  d.text((c*800+20,20),title,font=font,fill='#eee8df')
  for r,(a,label) in enumerate([(0,'Front'),(90,'Direct side'),(45,'45°')]):
   with Image.open(out/f'{name}-100-{a}{"-close" if close else ""}.png') as src:
    crop=(150,50,1350,950) if close else (300,50,1300,950)
    tile=src.crop(crop).resize((800,600 if close else 720),Image.Resampling.LANCZOS);im.paste(tile,(c*800,60+r*720))
   d.text((c*800+15,60+r*720+675),label,font=font,fill='#d4bc7e')
 buf=BytesIO();im.save(buf,format='PNG');p=out/f'100-three-way-final{"-close" if close else ""}.png';p.write_bytes(buf.getvalue())
 with Image.open(p) as check:check.verify()
 print(p,p.stat().st_size)

# Matching camera crops: no generated or painted geometry.
im=Image.new('RGB',(1400,750),'#1b2028');d=ImageDraw.Draw(im)
for c,(name,label) in enumerate([('spandex-before','Before'),('spandex-spot','After local repair')]):
 with Image.open(out/f'{name}-100-0-close.png') as src:
  im.paste(src.crop((550,280,900,600)).resize((700,640),Image.Resampling.LANCZOS),(c*700,60))
 d.text((c*700+15,15),label,font=font,fill='#eee8df')
buf=BytesIO();im.save(buf,format='PNG');(out/'spot-before-after.png').write_bytes(buf.getvalue())
with Image.open(out/'spot-before-after.png') as check:check.verify()
