"""Build an isolated Ubuntu runtime package from the current working tree."""
import argparse, collections, hashlib, json, os, pathlib, shutil, subprocess, sys, tarfile, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--finalize', action='store_true')
args = parser.parse_args()
output = pathlib.Path(args.output).resolve()
bundle = output / 'yellowdogs-rougelite-aliyun'
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
    shutil.copytree(ROOT/'deploy/aliyun',bundle/'deploy/aliyun')
    for script in (bundle/'deploy/aliyun').glob('*.sh'): script.write_bytes(script.read_bytes().replace(b'\r\n',b'\n'))
    shutil.copy2(ROOT/'deploy/target.json',bundle/'deploy/target.json')
    shutil.copy2(ROOT/'deploy/DEPLOY_ALIYUN.md',bundle/'README_部署.md')
    shutil.copy2(ROOT/'deploy/DEPLOY_ALIYUN.md',output/'阿里云-上传部署说明.md')
    (bundle/'runtime').mkdir()
    runtime=ROOT/'outputs/v01-runtime/node-v24.20.0-linux-x64.tar.xz'
    if digest(runtime)!='2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2': raise SystemExit('Node checksum mismatch')
    shutil.copy2(runtime,bundle/'runtime'/runtime.name)
    check = subprocess.run(['node','--input-type=module','-e',
        "import {STARTING_GOLD} from './shared/config/economy.mjs';import {INITIAL_FANS} from './shared/config/fans.mjs';import {LAUNCH_REWARDS} from './shared/config/launch-rewards.mjs';import {DAILY_NEUTRAL_CONQUEST_LIMIT} from './shared/config/conquest.mjs'; console.log(JSON.stringify({startingGold:STARTING_GOLD,initialFans:INITIAL_FANS,launch:LAUNCH_REWARDS,dailyConquests:DAILY_NEUTRAL_CONQUEST_LIMIT}));"],
        cwd=bundle/'app',check=True,capture_output=True,text=True)
    grants=json.loads(check.stdout)
    assert grants['startingGold']==20000 and grants['initialFans']==8000 and grants['dailyConquests']==8
    assert grants['launch']['firstConquestGold']==15000 and grants['launch']['followingDayGold']==15000
    assert grants['launch']['production']==400 and grants['launch']['packs']=={'rare-player-pack':2,'exotic-player-pack':1}
    assert not (bundle/'app/data').exists()
    subprocess.run([sys.executable,str(ROOT/'scripts/prepare-s4-account-seed.py'),'--bundle',str(bundle)],check=True)
    accounts=json.loads((bundle/'S4_ACCOUNT_IMPORT.json').read_text(encoding='utf-8'))
    report={'version':'0.1.0-aliyun','source':'current working tree','builtAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
        'target':json.loads((ROOT/'deploy/target.json').read_text(encoding='utf-8')),
        'node':'24.20.0 linux-x64','accountSource':accounts['archive'],'importedAccounts':accounts['importedAccounts'],'accountSourceMember':accounts['member'],'seedSha256':accounts['seedSha256'],
        'credentialsBundled':True,'oldSessionsImported':False,'campaignProgress':'fresh','resources':grants,'dependencies':dependencies}
    (bundle/'RELEASE.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'staging':str(bundle),'credentialsBundled':True,'runtimeDependencies':len(dependencies)},ensure_ascii=False))
else:
    if not (bundle/'QA.json').exists(): raise SystemExit('QA.json required before final packaging')
    qa=json.loads((bundle/'QA.json').read_text(encoding='utf-8'))
    if qa.get('passed') is not True or qa.get('bundledAccountsVerified') != 11: raise SystemExit('Successful runtime and bundled S4 account QA required before packaging')
    account_report=json.loads((bundle/'S4_ACCOUNT_IMPORT.json').read_text(encoding='utf-8'))
    if digest(bundle/'seed/campaign-accounts.json')!=account_report['seedSha256']: raise SystemExit('Bundled account seed changed after verification')
    manifest=[]
    for p in sorted(bundle.rglob('*')):
        if p.is_symlink(): raise SystemExit('Unexpected symlink: '+str(p))
        if p.is_file() and p.name!='SHA256SUMS': manifest.append(digest(p)+'  '+p.relative_to(bundle).as_posix())
    (bundle/'SHA256SUMS').write_text('\n'.join(manifest)+'\n',encoding='utf-8',newline='\n')
    artifact=output/'yellowdogs-rougelite-aliyun-x64.tar.gz'
    if artifact.exists(): raise SystemExit('Refusing to overwrite an existing release archive')
    def attributes(info):
        info.uid=info.gid=0;info.uname=info.gname='root'
        info.mode=0o755 if info.isdir() or info.name.endswith('.sh') else 0o600 if '/seed/' in info.name else 0o644
        return info
    with tarfile.open(artifact,'w:gz',compresslevel=3) as t: t.add(bundle,arcname=bundle.name,filter=attributes)
    (output/(artifact.name+'.sha256')).write_text(digest(artifact)+'  '+artifact.name+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'archive':str(artifact),'MB':round(artifact.stat().st_size/1024/1024,2),'files':len(manifest),'sha256':digest(artifact)},ensure_ascii=False))
