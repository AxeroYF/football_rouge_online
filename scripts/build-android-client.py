"""Build/sign the private Android client using the installed SDK, without Gradle downloads.

Signing material remains under ignored outputs/android-private, never in the release directory.
Keep that directory backed up: subsequent APK upgrades must use the same signing identity.
"""
import argparse, hashlib, json, os, pathlib, secrets, shutil, subprocess, time, urllib.parse, uuid, zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'android-client'
parser = argparse.ArgumentParser()
parser.add_argument('--sdk', default=os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or str(pathlib.Path(os.environ.get('LOCALAPPDATA', '~')) / 'Android/Sdk'))
parser.add_argument('--java-home', default=os.environ.get('JAVA_HOME'))
args = parser.parse_args()
config = json.loads((SOURCE / 'client.json').read_text(encoding='utf-8'))
for key in ('gameUrl', 'updateUrl'):
    url = urllib.parse.urlsplit(config[key])
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment:
        raise SystemExit(key + ' requires a valid HTTPS URL')
if urllib.parse.urlsplit(config['gameUrl']).netloc != urllib.parse.urlsplit(config['updateUrl']).netloc:
    raise SystemExit('Updates must use the game origin')
if config['applicationId'] != 'online.yellowdogsleague.client' or config['orientation'] != 'sensorLandscape':
    raise SystemExit('Package/orientation changes require matching manifest and Java changes')
if type(config['versionCode']) is not int or not 1 <= config['versionCode'] <= 2100000000:
    raise SystemExit('Invalid versionCode')

sdk = pathlib.Path(args.sdk).expanduser().resolve()
tools = sdk / 'build-tools/36.0.0'
android = sdk / 'platforms/android-36/android.jar'
suffix = '.exe' if os.name == 'nt' else ''
if args.java_home:
    java_home = pathlib.Path(args.java_home).resolve()
else:
    compiler = shutil.which('javac')
    candidates = [pathlib.Path(compiler).resolve().parent.parent] if compiler else []
    if os.name == 'nt': candidates += sorted(pathlib.Path('C:/Program Files/Java').glob('jdk-*'), reverse=True)
    java_home = next((p for p in candidates if (p / ('bin/javac' + suffix)).exists()), None)
    if java_home is None: raise SystemExit('JDK 17+ required; use --java-home')
for required in [tools / ('aapt2' + suffix), android, java_home / ('bin/javac' + suffix)]:
    if not required.is_file(): raise SystemExit('Missing build dependency: ' + str(required))
env = dict(os.environ, JAVA_HOME=str(java_home))
env['PATH'] = str(java_home / 'bin') + os.pathsep + env.get('PATH', '')
def run(*command):
    result = subprocess.run([str(c) for c in command], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try: result.stdout=result.stdout.decode("utf-8")
    except UnicodeDecodeError: result.stdout=result.stdout.decode("gb18030",errors="replace")
    if result.returncode: raise SystemExit(result.stdout)
    if result.stdout.strip(): print(result.stdout.strip())
    return result.stdout
def java_tool(name): return java_home / ('bin/' + name + suffix)
def sdk_tool(name): return tools / (name + ('.bat' if os.name == 'nt' and name in ('d8','apksigner') else suffix))

stamp = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
work = ROOT / 'outputs/android/builds' / stamp
release = ROOT / 'outputs/android/releases' / (str(config['versionCode']) + '-' + stamp)
for d in [work / 'classes', work / 'dex', work / 'res/drawable', work / 'res/values', work / 'generated', work / 'tests', release]: d.mkdir(parents=True, exist_ok=False)
shutil.copy2(SOURCE / 'res/values/styles.xml', work / 'res/values/styles.xml')
shutil.copy2(ROOT / 'assets/yellowdog-logo-transparent.png', work / 'res/drawable/app_icon.png')
ET.register_namespace('android','http://schemas.android.com/apk/res/android')
manifest = ET.parse(SOURCE / 'AndroidManifest.xml')
manifest.write(work / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
fields = {'GAME_URL':config['gameUrl'],'UPDATE_URL':config['updateUrl'],'VERSION_NAME':config['versionName'],'LANDSCAPE_CSS':(SOURCE/'landscape.css').read_text(encoding='utf-8')}
generated = 'package online.yellowdogsleague.client;\npublic final class BuildConfig {\n' + ''.join('public static final String '+key+'='+json.dumps(value,ensure_ascii=True)+';\n' for key,value in fields.items()) + 'public static final int VERSION_CODE='+str(config['versionCode'])+';\n}\n'
(work / 'generated/BuildConfig.java').write_text(generated, encoding='utf-8')
run(java_tool('javac'),'--release','8','-encoding','UTF-8','-d',work / 'tests',SOURCE / 'src/online/yellowdogsleague/client/UpdatePolicy.java',SOURCE / 'test/UpdatePolicyTest.java')
policy_output=run(java_tool('java'),'-cp',work / 'tests','online.yellowdogsleague.client.UpdatePolicyTest')
run(sdk_tool('aapt2'),'compile','--dir',work / 'res','-o',work / 'resources.zip')
run(sdk_tool('aapt2'),'link','-o',work / 'unsigned.apk','--manifest',work / 'AndroidManifest.xml','-I',android,'--min-sdk-version',config['minSdk'],'--target-sdk-version',config['targetSdk'],'--version-code',config['versionCode'],'--version-name',config['versionName'],work / 'resources.zip')
run(java_tool('javac'),'--release','8','-encoding','UTF-8','-cp',android,'-d',work / 'classes',*sorted((SOURCE / 'src').rglob('*.java')),work / 'generated/BuildConfig.java')
run(java_tool('jar'),'cf',work / 'classes.jar','-C',work / 'classes','.')
run(sdk_tool('d8'),'--lib',android,'--min-api',config['minSdk'],'--output',work / 'dex',work / 'classes.jar')
with zipfile.ZipFile(work / 'unsigned.apk','a',compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted((work / 'dex').glob('*.dex')): archive.write(file,file.name)
run(sdk_tool('zipalign'),'-p','4',work / 'unsigned.apk',work / 'aligned.apk')

private = ROOT / 'outputs/android-private'
private.mkdir(parents=True,exist_ok=True)
key = private / 'yellowdogs-release.p12'
password = private / 'release-password.txt'
if key.exists() != password.exists(): raise SystemExit('Incomplete signing identity; recover its backup, do not replace the key')
if not key.exists():
    password.write_text(secrets.token_urlsafe(48),encoding='utf-8')
    os.chmod(password,0o600)
    env['YDL_ANDROID_SIGNING_PASSWORD']=password.read_text(encoding='utf-8').strip()
    run(java_tool('keytool'),'-genkeypair','-keystore',key,'-storetype','PKCS12','-alias','yellowdogs','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=YellowDogsLeague Android Client,O=YellowDogsLeague,C=CN','-storepass:env','YDL_ANDROID_SIGNING_PASSWORD','-keypass:env','YDL_ANDROID_SIGNING_PASSWORD')
    os.chmod(key,0o600)
else: env['YDL_ANDROID_SIGNING_PASSWORD']=password.read_text(encoding='utf-8').strip()
apk = release / ('yellowdogs-android-v'+str(config['versionCode'])+'.apk')
run(sdk_tool('apksigner'),'sign','--ks',key,'--ks-key-alias','yellowdogs','--ks-pass','env:YDL_ANDROID_SIGNING_PASSWORD','--v4-signing-enabled','false','--out',apk,work / 'aligned.apk')
signature_output=run(sdk_tool('apksigner'),'verify','--verbose','--print-certs',apk)
(release / 'SIGNATURE.txt').write_text(signature_output,encoding='utf-8')
digest=hashlib.sha256(apk.read_bytes()).hexdigest()
update={'versionCode':config['versionCode'],'versionName':config['versionName'],'apkUrl':urllib.parse.urljoin(config['updateUrl'],apk.name),'sha256':digest,'sizeBytes':apk.stat().st_size,'notes':'安卓朋友测试版：横屏游戏、自动检查更新、下载校验及系统安装。'}
(release / 'latest.json').write_text(json.dumps(update,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(release / 'SHA256SUMS').write_text(digest+'  '+apk.name+'\n',encoding='utf-8',newline='\n')
report={'builtAt':stamp,'config':config,'apk':str(apk),'bytes':apk.stat().st_size,'sha256':digest,'signed':True,'policyTests':policy_output.strip(),'deviceTest':'pending; see DEVICE_QA.json when present','websiteProbe':'not performed by build script','signingBackup':'outputs/android-private (private; never upload with APK)'}
(release / 'BUILD.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'outputs/android/current-release.json').write_text(json.dumps({'release':str(release),'apk':str(apk)}),encoding='utf-8')
print(json.dumps({'releaseDirectory':str(release),'apk':str(apk),'bytes':apk.stat().st_size,'sha256':digest},ensure_ascii=False))
