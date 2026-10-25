"""Compose a region review sheet: male before/after and Sarah before/after, side by side.

    python3 sheet.py <out.jpg> "<title>" "<male views,...>" "<sarah views,...>" "<male note>" "<sarah note>"
A view name of '-' leaves that cell empty. Renders are read from $TOUCHUP_SHOTS (default shots/baseTouchup)/R-<male|sarah>-<0 before|1 after>/."""
import os, sys
from PIL import Image, ImageDraw, ImageFont
F = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'; R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
out, title, mviews, sviews, mnote, snote = sys.argv[1:7]
mviews = [v for v in mviews.split(',') if v]; sviews = [v for v in sviews.split(',') if v]
T = 300; PAD = 10; LBL = 128
cols = max(len(mviews), len(sviews))
W = LBL + cols * (T + PAD) + PAD
blocks = []
for name, views, note, tag in (('Male base', mviews, mnote, 'male'), ('Sarah v2', sviews, snote, 'sarah')):
    if views: blocks.append((name, views, note, tag))
H = 64 + sum(2 * (T + PAD) + 40 for _ in blocks) + PAD
sh = Image.new('RGB', (W, H), (18, 19, 23)); d = ImageDraw.Draw(sh)
d.text((PAD, 16), title, font=ImageFont.truetype(F, 26), fill=(240, 196, 120))
y = 64
for name, views, note, tag in blocks:
    d.text((PAD, y), name, font=ImageFont.truetype(F, 18), fill=(240, 240, 240))
    d.text((LBL + PAD, y + 2), note, font=ImageFont.truetype(R, 15), fill=(190, 195, 200))
    y += 32
    for r, (lab, sub) in enumerate((('Before', '0'), ('After', '1'))):
        d.text((PAD, y + r * (T + PAD) + T // 2 - 10), lab, font=ImageFont.truetype(F, 17), fill=(220, 220, 220))
        for c, v in enumerate(views):
            if v == '-': continue
            im = Image.open(f"{os.environ.get('TOUCHUP_SHOTS', 'shots/baseTouchup')}/R-{tag}-{sub}/{v}.png").convert('RGB')
            w, h = im.size; s = min(w, h); im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((T, T), Image.LANCZOS)
            sh.paste(im, (LBL + c * (T + PAD), y + r * (T + PAD)))
    y += 2 * (T + PAD) + 8
sh.save(out, quality=88)
print(out, sh.size)
