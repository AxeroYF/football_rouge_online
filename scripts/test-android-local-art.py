import pathlib,subprocess,os,json,zipfile
R=pathlib.Path(__file__).resolve().parents[1];release=pathlib.Path(json.loads((R/'outputs/android/current-release.json').read_text())['release']);build=R/'outputs/android/builds'/release.name.split('-',1)[1];work=release/'device-test';work.mkdir(exist_ok=True)
sdk=pathlib.Path(os.environ['LOCALAPPDATA'])/'Android/Sdk';bt=sdk/'build-tools/36.0.0';android=sdk/'platforms/android-36/android.jar';java=next(p for p in sorted(pathlib.Path('C:/Program Files/Java').glob('jdk-*'),reverse=True) if (p/'bin/javac.exe').exists());env=dict(os.environ,JAVA_HOME=str(java));env['PATH']=str(java/'bin')+os.pathsep+env['PATH'];env['YDL_ANDROID_SIGNING_PASSWORD']=(R/'outputs/android-private/release-password.txt').read_text().strip()
def run(*args):
 p=subprocess.run(list(map(str,args)),env=env,capture_output=True);text=p.stdout.decode('utf-8',errors='replace')+p.stderr.decode('utf-8',errors='replace')
 if p.returncode:raise RuntimeError(text)
 return text
(work/'ArtTest.java').write_text('''package online.yellowdogsleague.arttest;
import android.app.Instrumentation;import android.os.Bundle;import android.webkit.WebResourceResponse;import java.util.*;import java.io.*;import java.net.URI;import java.lang.reflect.Field;import java.security.MessageDigest;
import online.yellowdogsleague.client.LocalArtCache;
public class ArtTest extends Instrumentation {
 public void onCreate(Bundle args){super.onCreate(args);start();}
 void check(boolean value){if(!value)throw new AssertionError();}
 public void onStart(){Bundle result=new Bundle();try{
  LocalArtCache cache=new LocalArtCache(getTargetContext());Field seedField=LocalArtCache.class.getDeclaredField("bundled"),currentField=LocalArtCache.class.getDeclaredField("current");seedField.setAccessible(true);currentField.setAccessible(true);Map<String,String> seed=(Map<String,String>)seedField.get(cache);check(seed.size()==817);currentField.set(cache,seed);int count=0;long total=0;
  for(Map.Entry<String,String> e:seed.entrySet()){
   String url=new URI("https","yellowdogsleague.online","/"+e.getKey(),null).toASCIIString();WebResourceResponse response=cache.intercept(url);check(response!=null&&"apk".equals(response.getResponseHeaders().get("X-YDL-Resource")));MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=response.getData()){byte[] bytes=new byte[32768];int n;while((n=in.read(bytes))!=-1){digest.update(bytes,0,n);total+=n;}}StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format("%02x",b&255));check(hash.toString().equals(e.getValue()));count++;
  }
  String path="assets/player-profiles/Adriano.webp",url="https://yellowdogsleague.online/"+path,hash=seed.get(path);check(hash!=null);
  currentField.set(cache,Collections.emptyMap());check(cache.intercept(url)==null);check(cache.intercept(url+"?v=sha256-"+hash)!=null);check(cache.intercept(url+"?v=old")==null);check(cache.intercept(url+"?v=sha256-"+new String(new char[64]).replace('\0','0'))==null);check(cache.intercept("https://other.test/"+path)==null);check(cache.intercept("https://yellowdogsleague.online/api/campaign/state")==null);check(cache.intercept("https://yellowdogsleague.online/assets/player-profiles/admin/test.webp")==null);
  result.putString("stream","PASS: "+count+" bundled resources read and SHA256 verified; "+total+" bytes; seven version/origin/fallback checks passed.");finish(-1,result);
 }catch(Throwable e){result.putString("stream","FAIL: "+e.toString());finish(0,result);}}
}''',encoding='utf-8')
(work/'AndroidManifest.xml').write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="online.yellowdogsleague.arttest"><uses-sdk android:minSdkVersion="26" android:targetSdkVersion="36"/><application android:label="YDL art verification"/><instrumentation android:name="online.yellowdogsleague.arttest.ArtTest" android:targetPackage="online.yellowdogsleague.client"/></manifest>')
(work/'classes').mkdir(exist_ok=True);(work/'dex').mkdir(exist_ok=True)
run(java/'bin/javac.exe','--release','8','-cp',str(android)+';'+str(build/'classes'),'-d',work/'classes',work/'ArtTest.java');run(java/'bin/jar.exe','cf',work/'test.jar','-C',work/'classes','.')
run(bt/'d8.bat','--lib',android,'--min-api','26','--output',work/'dex',work/'test.jar');run(bt/'aapt2.exe','link','-o',work/'unsigned.apk','--manifest',work/'AndroidManifest.xml','-I',android)
with zipfile.ZipFile(work/'unsigned.apk','a') as z:z.write(work/'dex/classes.dex','classes.dex')
run(bt/'zipalign.exe','-p','4',work/'unsigned.apk',work/'aligned.apk');run(bt/'apksigner.bat','sign','--ks',R/'outputs/android-private/yellowdogs-release.p12','--ks-key-alias','yellowdogs','--ks-pass','env:YDL_ANDROID_SIGNING_PASSWORD','--out',work/'test.apk',work/'aligned.apk')
adb=[sdk/'platform-tools/adb.exe','-s','RFCY90BH9CD'];print(run(*adb,'install','-t',work/'test.apk'))
try:
 result=run(*adb,'shell','am','instrument','-w','online.yellowdogsleague.arttest/.ArtTest');(release/'DEVICE_ART_TEST.txt').write_text(result,encoding='utf-8');print(result);assert 'PASS:' in result and 'FAIL:' not in result
finally:
 print(run(*adb,'uninstall','online.yellowdogsleague.arttest'));print(run(*adb,'shell','am','start','-n','online.yellowdogsleague.client/.MainActivity'))
