#!/usr/bin/env python3
"""Restore the original preservation ZIPs from SHA256-verified binary parts."""
import hashlib
import json
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def local(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError('Archive path escapes the repository')
    return path

def restore():
    for archive in json.loads((HERE / 'transport.json').read_text())['archives']:
        target = local(archive['path'])
        if target.exists():
            if target.stat().st_size != archive['bytes'] or digest(target) != archive['sha256']:
                raise RuntimeError(f'Refusing to overwrite a nonmatching file: {target.name}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.restore-partial')
            with temporary.open('wb') as output:
                for part in archive['parts']:
                    source = local(part['path'])
                    if source.stat().st_size != part['bytes'] or digest(source) != part['sha256']:
                        raise RuntimeError(f'Corrupt archive part: {source.name}')
                    with source.open('rb') as input_file:
                        for block in iter(lambda: input_file.read(1024 * 1024), b''):
                            output.write(block)
            if temporary.stat().st_size != archive['bytes'] or digest(temporary) != archive['sha256']:
                raise RuntimeError(f'Reassembled archive verification failed: {target.name}')
            with zipfile.ZipFile(temporary) as z:
                if z.testzip() is not None:
                    raise RuntimeError(f'Archive CRC failed: {target.name}')
            temporary.replace(target)
        print(f'Verified: {target.relative_to(ROOT)}', flush=True)

if __name__ == '__main__':
    restore()
