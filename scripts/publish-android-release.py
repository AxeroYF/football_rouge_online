"""Publish the private Android APK/update feed on the existing Aliyun Nginx host.
Run with sudo from the uploaded Android release kit. Never modifies game data.
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, time, uuid
MAX_APK_BYTES = 64 * 1024 * 1024
INCLUDE = 'include /etc/nginx/snippets/yellowdogs-android-releases.conf;'
CONF = pathlib.Path('/etc/nginx/conf.d/yellowdogs-rougelite.conf')
SNIPPET = pathlib.Path('/etc/nginx/snippets/yellowdogs-android-releases.conf')
RELEASES = pathlib.Path('/var/lib/yellowdogs-android/releases')

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(65536), b''): h.update(chunk)
    return h.hexdigest()

def validate_release(folder, current=None):
    metadata = folder/'latest.json'
    if metadata.stat().st_size > 65536: raise ValueError('Update metadata too large')
    value = json.loads(metadata.read_text(encoding='utf-8'))
    code, size = value.get('versionCode'), value.get('sizeBytes')
    if type(code) is not int or not 1 <= code <= 2100000000: raise ValueError('Invalid versionCode')
    if type(size) is not int or not 1 <= size <= MAX_APK_BYTES: raise ValueError('Invalid sizeBytes')
    name = 'yellowdogs-android-v' + str(code) + '.apk'
    if value.get('apkUrl') != 'https://yellowdogsleague.online/android/releases/' + name: raise ValueError('Invalid APK URL')
    if not isinstance(value.get('versionName'), str) or not value['versionName']: raise ValueError('Missing versionName')
    if not isinstance(value.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', value['sha256']): raise ValueError('Invalid SHA256')
    apk = folder/name
    if apk.is_symlink() or not apk.is_file() or apk.stat().st_size != size or digest(apk) != value['sha256']: raise ValueError('APK hash/size mismatch')
    if current:
        previous = current.get('versionCode')
        if type(previous) is not int: raise ValueError('Existing update metadata invalid')
        if previous > code: raise ValueError('Refusing version downgrade')
        if previous == code and current.get('sha256') != value['sha256']: raise ValueError('Same versionCode cannot replace a different APK')
    return value, apk

def with_update_include(text):
    if text.count(INCLUDE) == 1: return text
    if INCLUDE in text: raise ValueError('Duplicate Android includes')
    if 'ssl_certificate ' not in text or 'yellowdogsleague.online' not in text: raise ValueError('Not the expected HTTPS game site')
    matches = list(re.finditer(r'(?m)^[ \t]*location / \{', text))
    if len(matches) != 1: raise ValueError('Game site layout changed; cannot insert automatically')
    match = matches[0]
    return text[:match.start()] + '    ' + INCLUDE + '\n' + text[match.start():]

def atomic_write(path, contents, mode=0o644):
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as file:
            os.chmod(temporary, mode); file.write(contents); file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists(): temporary.unlink()

def run(*args): subprocess.run(args, check=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', help='Validate uploaded release without modifying server')
    args = parser.parse_args()
    folder = pathlib.Path(__file__).resolve().parent
    previous = json.loads((RELEASES/'latest.json').read_text(encoding='utf-8')) if (RELEASES/'latest.json').exists() else None
    value, apk = validate_release(folder, previous)
    if args.check:
        print(json.dumps({'valid':True, 'versionCode':value['versionCode'], 'sizeBytes':value['sizeBytes']})); return
    if os.name != 'posix' or os.geteuid() != 0: raise SystemExit('Run: sudo python3 publish-android-release.py')
    if not CONF.is_file(): raise SystemExit('Game Nginx site missing; install the game first')
    if not (folder/'yellowdogs-android-releases.conf').is_file(): raise SystemExit('Android Nginx snippet missing')
    run('nginx','-t')
    old_conf = CONF.read_bytes(); new_conf = with_update_include(old_conf.decode('utf-8')).encode('utf-8')
    old_snippet = SNIPPET.read_bytes() if SNIPPET.exists() else None
    old_latest = (RELEASES/'latest.json').read_bytes() if (RELEASES/'latest.json').exists() else None
    if (RELEASES/apk.name).exists() and digest(RELEASES/apk.name) != value['sha256']: raise SystemExit('Existing versioned APK differs; increase versionCode')
    backup = pathlib.Path('/var/backups/yellowdogs-android')/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    (backup/'nginx-before.conf').write_bytes(old_conf)
    if old_snippet is not None: (backup/'android-snippet-before.conf').write_bytes(old_snippet)
    if old_latest is not None: (backup/'latest-before.json').write_bytes(old_latest)
    RELEASES.mkdir(mode=0o755, parents=True, exist_ok=True)
    SNIPPET.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    atomic_write(RELEASES/apk.name, apk.read_bytes())
    try:
        atomic_write(SNIPPET,(folder/'yellowdogs-android-releases.conf').read_bytes())
        atomic_write(CONF,new_conf)
        run('nginx','-t'); run('systemctl','reload','nginx')
        # APK first, metadata last: nobody is offered a partially uploaded APK.
        atomic_write(RELEASES/'latest.json',(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    except Exception:
        atomic_write(CONF,old_conf)
        if old_snippet is None:
            if SNIPPET.exists(): SNIPPET.unlink()
        else: atomic_write(SNIPPET,old_snippet)
        if old_latest is not None: atomic_write(RELEASES/'latest.json',old_latest)
        elif (RELEASES/'latest.json').exists(): (RELEASES/'latest.json').unlink()
        try: run('nginx','-t'); run('systemctl','reload','nginx')
        except Exception: print('Please inspect Nginx; original files have been restored.')
        raise
    print('Android release published: ' + value['apkUrl'])
    print('Update feed: https://yellowdogsleague.online/android/releases/latest.json')
    print('Game service and saved progress were not changed. Config backup: '+str(backup))

if __name__ == '__main__': main()
