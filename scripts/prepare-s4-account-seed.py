"""Extract only the approved S4 account member; never bundle raw saved progress."""
import argparse, hashlib, json, os, pathlib, subprocess, sys, tarfile, tempfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--bundle', required=True)
args = parser.parse_args()
bundle = pathlib.Path(args.bundle).resolve()
config = json.loads((ROOT/'deploy/s4-account-source.json').read_text(encoding='utf-8'))
archive = ROOT/config['archive']
sha = hashlib.sha256()
with archive.open('rb') as file:
    for chunk in iter(lambda: file.read(1024*1024), b''): sha.update(chunk)
if sha.hexdigest() != config['archiveSha256']: raise SystemExit('S4 backup checksum mismatch')
with tarfile.open(archive) as tar:
    member = tar.getmember(config['member'])
    if not member.isfile() or member.size > 20*1024*1024: raise SystemExit('Unexpected S4 account member')
    raw = tar.extractfile(member).read()
source = json.loads(raw.decode('utf-8-sig'))
if len(source['accounts']) != config['expectedAccounts']: raise SystemExit('S4 account count differs from approved backup')
seed = bundle/'seed/campaign-accounts.json'
with tempfile.TemporaryDirectory(prefix='ydl-s4-import-') as temp:
    private = pathlib.Path(temp)/'source.json'
    private.write_bytes(raw)
    os.chmod(private, 0o600)
    subprocess.run(['node', str(ROOT/'scripts/import-s4-accounts.mjs'), str(private), str(seed)], check=True, capture_output=True)
imported = json.loads(seed.read_text(encoding='utf-8'))
originals = {a['id']:a for a in source['accounts'].values()}
if set(imported['accounts']) != set(originals): raise SystemExit('Imported identities differ')
for key, account in imported['accounts'].items():
    original = originals[key]
    assert account['nickname'] == original['nickname'] and account['passwordHash'] == original['passwordHash']
    assert account['token'] is None and account['draft'] is None and account['setupComplete'] is False
    assert not any(k in account for k in ['gold','resources','inventory','launchRewards','tactics','battleHistory'])
assert imported['world'] is None
os.chmod(seed, 0o600)
report = {**config, 'importedAccounts':len(originals), 'sourceMemberSha256':hashlib.sha256(raw).hexdigest(),
    'seedSha256':hashlib.sha256(seed.read_bytes()).hexdigest(), 'passwordHashesPreserved':True,
    'oldSessionsImported':False, 'campaignProgress':'fresh'}
(bundle/'S4_ACCOUNT_IMPORT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
print(json.dumps({'importedAccounts':len(originals),'passwordHashesPreserved':True,'campaignProgress':'fresh'}))
