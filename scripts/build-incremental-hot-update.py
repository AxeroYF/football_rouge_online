"""Build a complete incremental payload, including new files, against a prior bundle."""
import argparse, datetime, hashlib, json, pathlib, shutil, subprocess, sys, re
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--baseline',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--version',required=True)
parser.add_argument('--scope',required=True)
args=parser.parse_args()
assert re.fullmatch(r'[0-9]{8}-r[0-9]+',args.version)
baseline=pathlib.Path(args.baseline).resolve()
bundle=pathlib.Path(args.output).resolve()/('yellowdogs-hot-update-'+args.version)
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text(encoding='utf-8'))
subprocess.run([sys.executable,str(ROOT/'scripts/build-browser-module-versions.py'),'--check'],check=True)
previous=read(baseline/'MANIFEST.json')
assert read(baseline/'QA.json')['passed'] is True
assert not bundle.exists(),'Refusing to overwrite an existing bundle'
# Prefer the checked-in effective release snapshot. Older local bundles remain supported.
snapshot_path=baseline/'BASELINE.json'
if snapshot_path.exists():
    snapshot=read(snapshot_path)
    assert snapshot['kind']=='rougelite-release-baseline' and snapshot['version']==previous['version']
    expected={f['path']:f['sha256'] for f in snapshot['files']}
    original=dict(expected)
    public_paths=set(subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0'))
else:
    expected={f['path']:f['sha256'] for f in previous.get('requiredBaseFiles',[])}
    for f in previous['files']:
        assert sha(baseline/'payload'/f['path'])==f['sha256'],f['path']
        expected[f['path']]=f['sha256']
    release=ROOT/'outputs/aliyun-release-20260909-s4accounts/yellowdogs-rougelite-aliyun'
    original={line.split('  ',1)[1].removeprefix('app/'):line.split('  ',1)[0] for line in (release/'SHA256SUMS').read_text().splitlines() if line.split('  ',1)[1].startswith('app/')}
    public_paths=None
candidates=[]
for group in ['client','engine','server','shared','styles']:
    candidates += [p for p in (ROOT/group).rglob('*') if p.is_file() and p.suffix in ['.js','.mjs','.json','.css']]
candidates += [p for p in ROOT.iterdir() if p.is_file() and (p.suffix in ['.js','.mjs','.html','.css'] or p.name in ['package.json','package-lock.json'])]
for p in (ROOT/'assets').rglob('*'):
    if not p.is_file():continue
    rel=p.relative_to(ROOT).as_posix()
    if rel.startswith(('assets/player-profiles/','assets/player-packs/','assets/data/s4-')):continue
    if public_paths is not None and rel not in public_paths:continue
    if rel in expected or sha(p)!=original.get(rel):candidates.append(p)
for rel in expected:
    assert (ROOT/rel).is_file(),'Deletion needs an explicit migration: '+rel
    candidates.append(ROOT/rel)
assert sha(ROOT/'package-lock.json')==expected['package-lock.json'],'Incremental package requires unchanged dependencies'
entries=[]
for current in sorted(set(candidates)):
    rel=current.relative_to(ROOT).as_posix()
    assert not current.is_symlink() and not any(part.startswith('.') for part in current.relative_to(ROOT).parts),rel
    current_hash=sha(current)
    old_hash=expected.get(rel,original.get(rel))
    if current_hash==old_hash:continue
    if old_hash is not None:expected.setdefault(rel,old_hash)
    entries.append({'path':rel,'sha256':current_hash,'bytes':current.stat().st_size,'baselineSha256':old_hash})
assert entries,'No changes since baseline'
for f in entries:
    target=bundle/'payload'/f['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/f['path'],target)
manifest={'kind':'rougelite-hot-update','version':args.version,'builtAt':datetime.datetime.now().astimezone().isoformat(),'baseline':previous['version'],'scope':args.scope,'dependencies':previous['dependencies'],'requiredBaseFiles':[{'path':rel,'sha256':value} for rel,value in sorted(expected.items())],'files':entries}
(bundle/'MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for name in ['update.sh','hot-update.mjs','updater.mjs']:
    source=ROOT/'deploy/hot-update'/name
    (bundle/name).write_bytes(source.read_bytes().replace(b'\r\n',b'\n') if name.endswith('.sh') else source.read_bytes())
print(json.dumps({'bundle':str(bundle),'files':[f['path'] for f in entries],'newFiles':[f['path'] for f in entries if f['baselineSha256'] is None],'bytes':sum(f['bytes'] for f in entries)},ensure_ascii=False))
