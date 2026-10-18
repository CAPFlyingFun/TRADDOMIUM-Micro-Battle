from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from io import BytesIO
p=Path('shots/navel-transition-review');font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',26)
out=Image.new('RGB',(1200,1930),'#1b2028');d=ImageDraw.Draw(out)
for c,title in enumerate(['Previous navel','Gentler ring transition']):d.text((c*600+20,18),title,font=font,fill='#eee8df')
for row,(a,label) in enumerate([(0,'Front'),(90,'Direct side'),(45,'45°')]):
 for col,phase in enumerate(['before','after']):
  im=Image.open(p/f'{phase}-{a}.png');im.load();out.paste(im.crop((600,310,1000,690)).resize((600,570),Image.Resampling.LANCZOS),(col*600,60+row*620))
 d.text((20,60+row*620+578),label,font=font,fill='#d4bc7e')
b=BytesIO();out.save(b,format='PNG');(p/'navel-transition-before-after.png').write_bytes(b.getvalue())
with Image.open(p/'navel-transition-before-after.png') as im:im.verify()
