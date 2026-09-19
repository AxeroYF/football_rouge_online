"""Build an isolated Ubuntu runtime package from the current working tree."""
import argparse, collections, hashlib, json, os, pathlib, shutil, subprocess, tarfile, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--finalize', action='store_true')
args = parser.parse_args()
output = pathlib.Path(args.output).resolve()
bundle = output / 'yellowdogs-v0.1'
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
if not args.finalize:
    if bundle.exists(): raise SystemExit('Refusing to overwrite an existing release staging directory')
    (bundle/'app').mkdir(parents=True)
    for directory in ['assets','client','engine','server','shared','styles']:
        shutil.copytree(ROOT/directory,bundle/'app'/directory,ignore=shutil.ignore_patterns('*.test.js','*.test.mjs','__pycache__'))
    for p in ROOT.iterdir():
        if p.is_file() and (p.suffix in ['.js','.mjs','.css','.html'] or p.name in ['package.json','package-lock.json']):
            shutil.copy2(p,bundle/'app'/p.name)
    (bundle/'app/scripts').mkdir()
    for name in ['import-s4-accounts.mjs']:
        shutil.copy2(ROOT/'scripts'/name,bundle/'app/scripts'/name)
    lock=json.loads((ROOT/'package-lock.json').read_text(encoding='utf-8'))
    dependencies=[]
    for key,value in lock['packages'].items():
        if not key or value.get('dev'): continue
        p=ROOT/key
        actual=json.loads((p/'package.json').read_text(encoding='utf-8'))
        if actual['version']!=value['version']: raise SystemExit('Installed dependency differs from lock: '+key)
        shutil.copytree(p,bundle/'app'/key)
        dependencies.append({'package':actual['name'],'version':actual['version']})
    shutil.copytree(ROOT/'deploy',bundle/'deploy')
    shutil.copy2(ROOT/'deploy/DEPLOY_UBUNTU_V0.1.md',bundle/'README_部署.md')
    shutil.copy2(ROOT/'deploy/DEPLOY_UBUNTU_V0.1.md',output/'黄狗风云V0.1-上传部署说明.md')
    (bundle/'runtime').mkdir()
    runtime=ROOT/'outputs/v01-runtime/node-v24.20.0-linux-x64.tar.xz'
    if digest(runtime)!='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2': raise SystemExit('Node checksum mismatch')
    shutil.copy2(runtime,bundle/'runtime'/runtime.name)
    archive=next((ROOT/'YDL_backup').glob('ydl-s4-final-20260825-172250/ydl-s4-final-20260825-172250/archives/football-s4-data-20260825-172250.tar.gz'))
    with tarfile.open(archive) as t: account_bytes=t.extractfile('data/versus-accounts.json').read()
    private=ROOT/'outputs/v01-private-source'
    private.mkdir(exist_ok=True)
    source=private/'s4-final-accounts.json'
    source.write_bytes(account_bytes)
    os.chmod(source,0o600)
    seed=bundle/'seed/campaign-accounts.json'
    subprocess.run(['node',str(ROOT/'scripts/import-s4-accounts.mjs'),str(source),str(seed)],check=True)
    imported=json.loads(seed.read_text(encoding='utf-8'))
    original=json.loads(account_bytes)
    originals={a['id']:a for a in original['accounts'].values()}
    for account in imported['accounts'].values():
        origin=originals[account['id']]
        assert account['passwordHash']==origin['passwordHash'] and account['nickname']==origin['nickname']
        assert account['token'] is None and account['draft'] is None
    assert len(imported['accounts'])==len(originals)==11
    report={'version':'0.1.0','source':'current working tree','builtAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'node':'24.20.0 linux-x64','accountSource':str(archive.relative_to(ROOT)),'accountMember':'data/versus-accounts.json',
        'accountSourceSha256':hashlib.sha256(account_bytes).hexdigest(),'importedAccounts':len(originals),
        'oldSessionsImported':False,'campaignProgress':'fresh','dependencies':dependencies}
    (bundle/'RELEASE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'staging':str(bundle),'importedAccounts':len(originals),'runtimeDependencies':len(dependencies)},ensure_ascii=False))
else:
    if not (bundle/'QA.json').exists(): raise SystemExit('QA.json required before final packaging')
    manifest=[]
    for p in sorted(bundle.rglob('*')):
        if p.is_symlink(): raise SystemExit('Unexpected symlink: '+str(p))
        if p.is_file() and p.name!='SHA256SUMS': manifest.append(digest(p)+'  '+p.relative_to(bundle).as_posix())
    (bundle/'SHA256SUMS').write_text('\n'.join(manifest)+'\n',encoding='utf-8')
    artifact=output/'yellowdogs-v0.1-ubuntu-x64.tar.gz'
    if artifact.exists(): raise SystemExit('Refusing to overwrite an existing release archive')
    def attributes(info):
        info.uid=info.gid=0;info.uname=info.gname='root'
        info.mode=0o755 if info.isdir() or info.name.endswith('.sh') else 0o600 if '/seed/' in info.name else 0o644
        return info
    with tarfile.open(artifact,'w:gz',compresslevel=3) as t: t.add(bundle,arcname=bundle.name,filter=attributes)
    (output/(artifact.name+'.sha256')).write_text(digest(artifact)+'  '+artifact.name+'\n',encoding='utf-8')
    print(json.dumps({'archive':str(artifact),'MB':round(artifact.stat().st_size/1024/1024,2),'files':len(manifest),'sha256':digest(artifact)},ensure_ascii=False))
