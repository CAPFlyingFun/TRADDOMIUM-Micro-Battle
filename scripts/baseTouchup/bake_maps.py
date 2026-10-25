"""Per texel of a dumped body: which triangle, where on the body (P) and its normal (N).  python3 bake_maps.py <tag>..."""
import os, sys, time, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skin
from PIL import Image
for tag in sys.argv[1:]:
    t = time.time(); m = skin.load(tag)
    tid, bary = skin.raster(m, 2048)
    P = skin.attr_map(m, tid, bary, m['pos']); N = skin.attr_map(m, tid, bary, m['nor'])
    cov = tid >= 0
    D = f'{skin.ROOT}/{tag}'
    np.save(f'{D}/tid.npy', tid); np.save(f'{D}/bary.npy', bary); np.save(f'{D}/P.npy', P); np.save(f'{D}/N.npy', N)
    print(tag, 'covered', cov.mean().round(3), 'secs', round(time.time() - t, 1), 'y range', P[cov][:, 1].min(), P[cov][:, 1].max())
    # stripes every 5 cm in height, x sign in red: a check that the atlas lines up with the body
    y = P[..., 1]; img = np.zeros((2048, 2048, 3), np.uint8)
    band = (np.floor(y / 0.05) % 2).astype(bool)
    img[cov & band] = (40, 40, 40); img[cov & ~band] = (230, 230, 230)
    img[cov & (P[..., 0] > 0) & band] = (180, 40, 40)
    Image.fromarray(img).save(f'{D}/stripes.png')
