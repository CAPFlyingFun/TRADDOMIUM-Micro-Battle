"""Import Chapter 1 only from a pinned local TMB-Story checkout. No audio generation."""
import hashlib, json, pathlib, subprocess, sys

source = pathlib.Path(sys.argv[1]).resolve()
root = pathlib.Path(__file__).resolve().parents[1]
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
def read(path):
    return subprocess.check_output(['git', 'show', f'{revision}:{path}'], cwd=source)
def write(path, value):
    p = root / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

manifest = json.loads(read('audio/manifests/chapter-01.json'))
segments = manifest['segments']
assert manifest['chapter'] == 1 and manifest['timeline']['complete']
assert len(segments) == manifest['segmentCount']
speakers = {'jack-bennett':'jack', 'sarah-bennett':'sarah', 'system':'system', 'narrator':'narrator'}
def index(prefix):
    found = [i for i,s in enumerate(segments) if s['displayText'].startswith(prefix)]
    assert len(found) == 1, (prefix, found)
    return found[0]

starts = {
    'wake':0,
    'trace':index('Several windows were opening'),
    'lock':index("Oh, no you don't."),
    'call':index('He reached for the intercom.'),
    'arrive':index('He reached for the keyboard just as'),
    'logs':index('Sarah started powering up'),
    'baby':index('Sarah shook her head, but Jack caught'),
    'request':index('A new warning tone interrupted them.'),
    'reject':index('Jack reached across the console and rejected'),
    'credentials':index('He entered his administrator credentials,')
}
inventory = {}
def copy(path):
    assert path.startswith('audio/') and '..' not in pathlib.PurePosixPath(path).parts
    data = read(path)
    digest = hashlib.sha256(data).hexdigest()
    # New content-addressed URLs bypass stale mobile audio caches.
    dest = 'audio/chapter-01/' + digest[:12] + '-' + pathlib.Path(path).name
    out = root / 'public' / dest
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    inventory[path] = {'src':'/'+dest, 'sha256':digest, 'bytes':len(data)}
    return {'src':'/'+dest, 'sha256':digest}

queues, recordings = {}, {}
bounds = list(starts.items()) + [('end',len(segments))]
for (queue,start),(_,end) in zip(bounds,bounds[1:]):
    assert start < end
    queues[queue] = []
    for n in range(start,end):
        s = segments[n]
        key = f'chapter1:{queue}:{n-start}'
        person = speakers[s['speaker']]
        queues[queue].append({'speaker':person,'text':s['displayText'],'voiceKey':key,'sourceIndex':n})
        recordings[key] = {**copy(s['audio']), 'clipId':s['clipId'], 'speaker':person, 'sourceText':s['displayText']}

registry = json.loads(read('audio/sfx-registry.json'))['assets']
config = json.loads(read('audio/config.json'))
# Current canonical manifest already repairs the chair and keyboard anchors.
# Never append the old prototype repairs: that duplicates those sounds and
# incorrectly retires the now-valid Jack-gives-up-his-chair cue.
assert not manifest.get('cueProblems'), manifest.get('cueProblems')
cues = list(manifest['cues'])
assert len({c['cueId'] for c in cues}) == len(cues)
assert all(0 <= c['order'] < len(segments) for c in cues)
effects, events = {}, []
for cue in cues:
    asset = cue['asset']
    definition = registry[asset]
    category = cue.get('category') or definition.get('category','foley')
    key = 'chapter1:'+asset
    effects[key] = {**copy(cue['audio']), 'category':category,'loop':cue.get('loop',False),
                    'gain':cue.get('gain',.04),'duck':config['mix']['duckUnderSpeechTo'].get(category,1),
                    **({'credit':definition['credit']} if definition.get('credit') else {})}
    if not cue.get('loop',False):
        events.append({'id':cue['cueId'],'sourceIndex':cue['order'],'asset':key,'gain':cue.get('gain',.04),
                       'timing':cue['timing'],'offsetMs':cue.get('offsetMs',0)})

staging = {'approach':index('Sarah Bennett walked straight in,'),
           'closeDistance':index('Sarah closed the distance between them.'),
           'pointMonitor':index('Jack pointed toward the monitor.'),
           'tablet':index('Jack straightened in his chair while Sarah placed'),
           'chairExchange':index('Jack gave Sarah his chair,'),
           'personal':starts['baby'], 'warning':starts['request'],
           'lock':index('He immediately locked the terminal.'), 'door':starts['arrive']}
write('app/game/data/lab-dialogue.json',queues)
write('app/game/data/chapter1-audio.json',{'source':{'repository':'CAPFlyingFun/TMB-Story','revision':revision},'lines':recordings,'effects':effects})
write('app/game/data/chapter1-cues.json',{'staging':staging,'events':events})
write('docs/chapter1-audio-source.json',{'revision':revision,'segments':len(segments),'files':inventory,'staging':staging,
      'cueCount':len(cues),'cuePolicy':'Current canonical manifest, once per cue ID; no legacy repair duplicates or retired canonical cues.',
      'arrivalReconciliation':'Approach begins when Sarah walks straight in, not at the later pointing line.',
      'upstreamCueProblems':manifest.get('cueProblems',[])})
(root/'docs/chapter1-manuscript.md').write_bytes(read(manifest['source']))
print(json.dumps({'revision':revision,'segments':len(segments),'files':len(inventory),'queues':{k:len(v) for k,v in queues.items()}}))
