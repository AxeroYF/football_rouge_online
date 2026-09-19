import hashlib, importlib.util, json, pathlib, tempfile, unittest
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/publish-android-release.py'
spec=importlib.util.spec_from_file_location('publisher',SCRIPT)
publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
class AndroidReleaseTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
  self.apk=self.root/'yellowdogs-android-v2.apk';self.apk.write_bytes(b'test APK bytes')
  self.value={'versionCode':2,'versionName':'0.1.1','apkUrl':'https://yellowdogsleague.online/android/releases/yellowdogs-android-v2.apk','sha256':hashlib.sha256(self.apk.read_bytes()).hexdigest(),'sizeBytes':self.apk.stat().st_size}
 def write(self): (self.root/'latest.json').write_text(json.dumps(self.value),encoding='utf-8')
 def test_valid_and_idempotent(self):
  self.write();self.assertEqual(publisher.validate_release(self.root)[0],self.value);publisher.validate_release(self.root,self.value)
 def test_downgrade_or_replaced_version_rejected(self):
  self.write()
  for current in [{'versionCode':3},{'versionCode':2,'sha256':'0'*64},{'versionCode':'2'}]:
   with self.subTest(current=current),self.assertRaises(ValueError):publisher.validate_release(self.root,current)
 def test_invalid_metadata_rejected(self):
  for key,wrong in [('versionCode',True),('versionCode',0),('versionCode',2100000001),('sizeBytes',True),('sizeBytes',0),('sizeBytes',publisher.MAX_APK_BYTES+1),('sha256','bad'),('versionName',''),('apkUrl','https://evil.test/a.apk'),('apkUrl','https://yellowdogsleague.online/android/releases/../private.apk')]:
   with self.subTest(key=key,wrong=wrong):
    original=self.value[key];self.value[key]=wrong;self.write()
    with self.assertRaises(ValueError):publisher.validate_release(self.root)
    self.value[key]=original
 def test_tampered_bytes_rejected(self):
  self.write();self.apk.write_bytes(b'changed')
  with self.assertRaises(ValueError):publisher.validate_release(self.root)
 def test_snippet_insert_preserves_game_and_is_idempotent(self):
  text='server {\nlisten 443 ssl;\nserver_name yellowdogsleague.online;\nssl_certificate /existing.pem;\n    location / {\nproxy_pass http://127.0.0.1:4380;\n}\n}\n'
  updated=publisher.with_update_include(text);self.assertEqual(updated.count(publisher.INCLUDE),1);self.assertIn('proxy_pass http://127.0.0.1:4380;',updated);self.assertEqual(publisher.with_update_include(updated),updated)
 def test_unknown_layout_rejected(self):
  for text in ['server {}','ssl_certificate /a; yellowdogsleague.online;\n location / {\n location / {',publisher.INCLUDE+'\n'+publisher.INCLUDE]:
   with self.subTest(text=text),self.assertRaises(ValueError):publisher.with_update_include(text)
 def test_atomic_publication(self):
  path=self.root/'latest.json';publisher.atomic_write(path,b'first');publisher.atomic_write(path,b'second');self.assertEqual(path.read_bytes(),b'second');self.assertEqual(list(self.root.glob('*.tmp')),[])
if __name__=='__main__':unittest.main()
