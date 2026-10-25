"""Per texel: which UV chart (triangles sharing a vertex share one). Writes <work>/<tag>/chart.npy.  python3 charts.py <tag>..."""
import os, numpy as np, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import skin
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
for tag in sys.argv[1:]:
    m = skin.load(tag); idx = m['idx']; V = len(m['uv'])
    # triangles sharing a vertex index share a UV chart
    T = len(idx)
    rows = np.repeat(np.arange(T), 3); cols = idx.ravel()
    A = coo_matrix((np.ones(3 * T), (rows, T + cols)), shape=(T + V, T + V))
    n, lab = connected_components(A, directed=False)
    chart = lab[:T]
    tid = np.load(f'{skin.ROOT}/{tag}/tid.npy'); cov = tid >= 0
    C = np.full(tid.shape, -1); C[cov] = chart[tid[cov]]
    nch = len(np.unique(C[cov]))
    lbl, nl = ndimage.label(cov, np.ones((3, 3)))
    # texels with a different chart in their 3x3 neighbourhood
    touch = np.zeros_like(cov)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            S = np.roll(np.roll(C, dy, 0), dx, 1)
            touch |= cov & (S >= 0) & (S != C)
    np.save(f'{skin.ROOT}/{tag}/chart.npy', C.astype(np.int32))
    print(tag, 'charts', nch, 'atlas islands', nl, 'texels touching another chart', int(touch.sum()), f'({100*touch.sum()/cov.sum():.2f}% of skin)', 'texel mm', round(float(np.sqrt(1.0 / cov.sum()) * 1000), 2))
