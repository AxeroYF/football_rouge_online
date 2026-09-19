"""Pin the entire browser module graph to content hashes across CDN/browser caches."""
import argparse,hashlib,json,posixpath,re
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
paths=[p for p in ROOT.iterdir() if p.is_file() and p.suffix in ('.js','.mjs')]
for folder in ('client','shared','engine'):
 paths.extend(p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in ('.js','.mjs'))
hashes={p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()[:20] for p in paths}
imports={}
def versioned(rel):return './'+rel+'?v=sha256-'+hashes[rel]
for rel in hashes:imports['./'+rel]=versioned(rel)
# Match static exports/imports and literal dynamic imports, including legacy query strings.
pattern=re.compile(r"(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)[\"']([^\"']+)[\"']")
for rel in hashes:
 for spec in pattern.findall((ROOT/rel).read_text(encoding='utf-8-sig')):
  if not spec.startswith('.'):continue
  parts=urlsplit(spec);target=posixpath.normpath(posixpath.join(posixpath.dirname(rel),parts.path))
  if target not in hashes:continue
  key='./'+target+('?' + parts.query if parts.query else '')+('#'+parts.fragment if parts.fragment else '')
  imports[key]=versioned(target)
p=ROOT/'index.html';before=p.read_text(encoding='utf-8');match=re.search(r'(<script type="importmap">)(.*?)(</script>)',before,re.S)
if not match:raise SystemExit('Missing import map')
existing=json.loads(match.group(2));bare={k:v for k,v in existing['imports'].items() if not k.startswith('.')}
text=json.dumps({'imports':{**bare,**dict(sorted(imports.items()))}},ensure_ascii=False,indent=2)
after=before[:match.start(2)]+'\n'+text+'\n    '+before[match.end(2):]
# Script tags do not resolve through import maps; version their URLs directly.
def tag_url(m):
 prefix,spec,suffix=m.groups();parts=urlsplit(spec);rel=parts.path.removeprefix('./')
 if rel not in hashes:return m.group(0)
 return prefix+versioned(rel)+suffix
after=re.sub(r'(<script[^>]*\bsrc=")([^" ]+)(")',tag_url,after)
# Styles can otherwise remain cached after an interaction change.
def style_url(m):
 prefix,spec,suffix=m.groups();rel=urlsplit(spec).path.removeprefix('./');file=ROOT/rel
 if not file.is_file() or file.suffix!='.css':return m.group(0)
 return prefix+'./'+rel+'?v=sha256-'+hashlib.sha256(file.read_bytes()).hexdigest()[:20]+suffix
after=re.sub(r'(<link[^>]*\bhref=")([^" ]+)(")',style_url,after)
if args.check:
 if before!=after:raise SystemExit('Browser module versions are stale; run python scripts/build-browser-module-versions.py')
else:
 with p.open('w',encoding='utf-8',newline='\r\n') as f:f.write(after)
print(json.dumps({'modules':len(hashes),'importMappings':len(imports),'checked':args.check}))
