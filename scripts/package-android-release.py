"""Build a public Android upload kit from a strict file allowlist."""
import hashlib, importlib.util, json, pathlib, tarfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',ROOT/'scripts/publish-android-release.py')
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
state=json.loads((ROOT/'outputs/android/current-release.json').read_text(encoding='utf-8'))
release=pathlib.Path(state['release']).resolve()
release.relative_to((ROOT/'outputs/android/releases').resolve())
value,apk=publisher.validate_release(release)
files=[(apk,apk.name),(release/'latest.json','latest.json'),(release/'SHA256SUMS','SHA256SUMS'),(ROOT/'scripts/publish-android-release.py','publish-android-release.py'),(ROOT/'deploy/yellowdogs-android-releases.conf','yellowdogs-android-releases.conf'),(ROOT/'deploy/ANDROID_CLIENT.md','README.md')]
output=release/('yellowdogs-android-release-v'+str(value['versionCode'])+'.tar.gz')
with tarfile.open(output,'w:gz') as archive:
 for source,name in files:
  if source.is_symlink():raise ValueError('Symlink not allowed')
  info=archive.gettarinfo(str(source),'yellowdogs-android-release/'+name)
  info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o644
  with source.open('rb') as data:archive.addfile(info,data)
with tarfile.open(output,'r:gz') as archive:
 assert sorted(archive.getnames())==sorted('yellowdogs-android-release/'+name for _,name in files)
sha=hashlib.sha256(output.read_bytes()).hexdigest()
output.with_name(output.name+'.sha256').write_text(sha+'  '+output.name+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'kit':str(output),'sha256':sha,'files':[name for _,name in files]},ensure_ascii=False))
