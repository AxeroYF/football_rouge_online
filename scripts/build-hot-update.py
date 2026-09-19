"""Build cumulative app updates without bundling accounts, server content or runtime."""
import argparse,hashlib,json,pathlib,shutil,tarfile,datetime,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);parser.add_argument('--version',required=True);parser.add_argument('--finalize',action='store_true');args=parser.parse_args()
if not re.fullmatch(r'[0-9]{8}-r[0-9]+',args.version):raise SystemExit('Invalid version')
out=pathlib.Path(args.output).resolve();bundle=out/('yellowdogs-hot-update-'+args.version)
base=ROOT/'outputs/aliyun-release-20260909-s4accounts/yellowdogs-rougelite-aliyun'
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def save(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if not args.finalize:
 subprocess.run([sys.executable,str(ROOT/'scripts/build-browser-module-versions.py'),'--check'],check=True)
 if bundle.exists():raise SystemExit('Refusing to overwrite an existing stage')
 (bundle/'payload').mkdir(parents=True)
 baseline={line.split('  ',1)[1]:line.split('  ',1)[0] for line in (base/'SHA256SUMS').read_text().splitlines()}
 candidates=[]
 for group in ['client','engine','server','shared','styles']:
  candidates += [p for p in (ROOT/group).rglob('*') if p.is_file() and p.suffix in ['.js','.mjs','.json','.css']]
 candidates += [p for p in ROOT.iterdir() if p.is_file() and (p.suffix in ['.js','.mjs','.html','.css'] or p.name in ['package.json','package-lock.json'])]
 for p in (ROOT/'assets').rglob('*'):
  if not p.is_file():continue
  rel=p.relative_to(ROOT).as_posix()
  if rel.startswith(('assets/player-profiles/','assets/data/s4-')):continue
  if sha(p)!=baseline.get('app/'+rel):candidates.append(p)
 entries=[]
 for p in sorted(set(candidates)):
  rel=p.relative_to(ROOT).as_posix()
  if p.is_symlink() or any(part.startswith('.') for part in p.relative_to(ROOT).parts):raise SystemExit('Unexpected hidden or linked path: '+rel)
  dest=bundle/'payload'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
  entries.append({'path':rel,'sha256':sha(dest),'bytes':dest.stat().st_size,'baselineSha256':baseline.get('app/'+rel)})
 lock=json.loads((ROOT/'package-lock.json').read_text())
 old=json.loads((base/'app/package-lock.json').read_text())
 deps=[{'path':k,'version':v['version']} for k,v in lock['packages'].items() if k and not v.get('dev')]
 assert all(old['packages'].get(d['path'],{}).get('version')==d['version'] for d in deps),'Runtime dependencies changed'
 save(bundle/'MANIFEST.json',{'kind':'rougelite-hot-update','version':args.version,'builtAt':datetime.datetime.now().astimezone().isoformat(),'baseline':'aliyun-20260909-s4accounts','scope':'Cumulative app and assets from S4 bond display through warfare, resource trades, oil legend purchases, expedition fitness, research rewards, injury substitutions content-versioned browser module cache repair, compact trade-up results, explicit player choice confirmation and stable notification scrolling','dependencies':deps,'files':entries})
 for p in (ROOT/'deploy/hot-update').iterdir():
  if p.is_file():
   shutil.copy2(p,bundle/p.name)
   if p.suffix=='.sh':(bundle/p.name).write_bytes(p.read_bytes().replace(b'\r\n',b'\n'))
 print(json.dumps({'bundle':str(bundle),'files':len(entries),'payloadMB':round(sum(f['bytes'] for f in entries)/1048576,2),'dependencies':len(deps)},ensure_ascii=False))
else:
 qa=json.loads((bundle/'QA.json').read_text());assert qa.get('passed') is True
 for entry in json.loads((bundle/'MANIFEST.json').read_text())['files']:assert sha(bundle/'payload'/entry['path'])==entry['sha256']
 paths=sorted(p for p in bundle.rglob('*') if p.is_file() and p.name!='SHA256SUMS')
 (bundle/'SHA256SUMS').write_text('\n'.join(sha(p)+'  '+p.relative_to(bundle).as_posix() for p in paths)+'\n',encoding='utf-8',newline='\n')
 artifact=out/(bundle.name+'.tar.gz')
 if artifact.exists():raise SystemExit('Refusing to overwrite existing archive')
 def attrs(info):
  info.uid=info.gid=0;info.uname=info.gname='root';info.mode=0o755 if info.isdir() or info.name.endswith('.sh') else 0o644;return info
 with tarfile.open(artifact,'w:gz',compresslevel=6) as tar:tar.add(bundle,arcname=bundle.name,filter=attrs)
 (out/(artifact.name+'.sha256')).write_text(sha(artifact)+'  '+artifact.name+'\n',encoding='utf-8',newline='\n')
 print(json.dumps({'artifact':str(artifact),'MB':round(artifact.stat().st_size/1048576,2),'sha256':sha(artifact)},ensure_ascii=False))
