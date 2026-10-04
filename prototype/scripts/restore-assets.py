"""Restore the minimal non-audio assets from an authorized Story checkout."""
import hashlib, json, pathlib, shutil, subprocess, sys

root = pathlib.Path(__file__).resolve().parents[1]
source = pathlib.Path(sys.argv[1]).resolve()
archive = pathlib.Path(sys.argv[2]).resolve()
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
assert revision == json.loads((root/'docs/chapter1-audio-source.json').read_text())['revision']
mapping = {
    'assets/backgrounds/lab-main.jpg': 'assets/tombs-laboratory.jpg',
    'assets/portraits/jack-3d.png': 'assets/jack-reference.png',
    'assets/portraits/sarah-3d.png': 'assets/sarah-reference.png',
}
files = {}
for src, dest in mapping.items():
    data = subprocess.check_output(['git', 'show', f'{revision}:{src}'], cwd=source)
    target = root/'public'/dest
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    files['/'+dest] = {'repository': 'CAPFlyingFun/TMB-Story', 'revision': revision,
                      'source': src, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                      'gitBlob': hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
omitted = json.loads((root/'handoff/omitted-assets.json').read_text())
original = {x['path']: x for x in omitted if 'public/assets/lab3d/' in x['path']}
for name in ['jack', 'sarah']:
    record = original[f'public/assets/lab3d/{name}.glb']
    # Exact omitted prototype binaries exist in authorized game history.
    # Resolve by object ID, not by a differently sized current/preview model.
    data = subprocess.check_output(['git', 'cat-file', 'blob', record['gitBlob']], cwd=root.parent)
    assert len(data) == record['bytes']
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == record['gitBlob']
    dest = f'/assets/lab3d/{name}.glb'
    target = root/'public'/dest[1:]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    files[dest] = {'repository': 'CAPFlyingFun/TRADDOMIUM-Micro-Battle',
                  'source': 'Git history: public/models/'+name+'.glb',
                  'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                  'gitBlob': record['gitBlob'], 'exactPrototypeBlob': True}
value = {
    'archive': {'name': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                'sourceCommit': json.loads((root/'handoff/source-manifest.json').read_text())['commit']},
    'repository': 'CAPFlyingFun/TMB-Story', 'revision': revision,
    'files': files, 'omittedPrototypeModels': original,
    'modelPolicy': 'Exact omitted prototype GLBs recovered from authorized TRADDOMIUM history by Git blob ID, not current Story models or the separate character-viewer variants. Original bytes preserved; actual rig/pose tests required.',
    'imagePolicy': 'Authorized Story lab background and 3D portraits replace missing title/portrait binaries. Procedural lab layout and materials remain from the ZIP.',
}
(root/'docs/asset-provenance.json').write_text(json.dumps(value, indent=2)+'\n')
print(json.dumps({'files': len(files), 'bytes': sum(x['bytes'] for x in files.values()), 'revision': revision}))