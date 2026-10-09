import json,pathlib,hashlib,tarfile,shutil,re
root=pathlib.Path.cwd();out=root/'outputs/hot-update-20260920-r33';name='yellowdogs-hot-update-20260920-r33';bundle=out/name
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
log=(root/'outputs/r33-full-tests.log').read_text(encoding='utf-8-sig');counts=re.findall(r'^# pass (\d+)',log,re.M);assert len(counts)==3 and re.findall(r'^# fail (\d+)',log,re.M)==['0','0','0']
qa=read(out/'incremental-preflight.json');qa.update(testsPassed=sum(map(int,counts)),cardTests=11,visualSizes=[280,180,110],includesR32=True)
write(bundle/'QA.json',qa)
doc="""# R33 球员卡特性显示

统一球员卡在强化标记下方显示最多两行特性名称，超过两个显示 +N，无特性不显示占位。长名称省略，完整信息保留在无障碍标签和球员详情。支持字符串名称、特性 ID、对象和嵌套 card 数据；仓库延迟渲染沿用同一组件。

特性来自已有数据，名称使用本地共享目录解析，没有逐卡网络请求、新增轮询或服务端写入。已更新浏览器模块和样式缓存版本。大、中、小卡截图见 outputs/card-traits-review/cards.png；11 项卡片测试与全量测试通过，升级和回滚演练通过。

基于 R31 的累积包，包含 R32 重复保存修复。尚未远程部署。无需重装 Windows 或安卓客户端，部署后重新打开游戏。

上传更新包及校验文件到 /home/admin，分别执行：

```bash
cd /home/admin
```

```bash
sha256sum -c yellowdogs-hot-update-20260920-r33.tar.gz.sha256
```

```bash
tar -xzf yellowdogs-hot-update-20260920-r33.tar.gz
```

```bash
cd yellowdogs-hot-update-20260920-r33
```

```bash
sudo bash update.sh --check
```

```bash
sudo bash update.sh apply
```

安装器保留配套代码与存档备份，健康失败自动回滚。此前 R32 保存次数诊断仍保留。
"""
(root/'handoff/CARD_TRAITS_R33_20260920.md').write_text(doc,encoding='utf-8');(bundle/'DEPLOY.md').write_text(doc,encoding='utf-8')
m=read(bundle/'MANIFEST.json')
for f in m['files']:assert hashlib.sha256((root/f['path']).read_bytes()).hexdigest()==f['sha256']
(bundle/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(bundle).as_posix()+'\n' for p in sorted(bundle.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'),encoding='utf-8')
a=out/(name+'.tar.gz')
with tarfile.open(a,'w:gz') as t:t.add(bundle,arcname=name)
sha=hashlib.sha256(a.read_bytes()).hexdigest();line=sha+'  '+a.name+'\n';pathlib.Path(str(a)+'.sha256').write_text(line,encoding='utf-8')
r=root/'releases/20260920-r33';r.mkdir()
for f in ['MANIFEST.json','QA.json']:shutil.copy2(bundle/f,r/f)
(r/'ARCHIVE.sha256').write_text(line,encoding='utf-8')
b=read(root/'releases/20260920-r31/BASELINE.json');b.update(version='20260920-r33',parent='20260920-r31',source='Cumulative R32 save fixes and R33 visible card traits');mp={f['path']:f for f in b['files']}
for f in m['files']:mp[f['path']]={'path':f['path'],'sha256':f['sha256']}
b['files']=list(mp.values());write(r/'BASELINE.json',b)
c=read(root/'releases/CURRENT.json');c.update(latestPublished='20260920-r33',sourceState='R31 confirmed; R33 cumulative card traits and R32 fixes locally verified, deployment unconfirmed');c['releases'].append({'version':'20260920-r33','parent':'20260920-r31','bundleSha256':sha,'baselineFiles':len(mp),'changedFiles':len(m['files']),'deployment':'not-confirmed'});write(root/'releases/CURRENT.json',c)
for f in ['README.md','CURRENT_STATE.md','MANIFEST.md','NEW_CHAT_PROMPT.md']:
 p=root/'handoff'/f;p.write_text('> 最新：R33 球员卡强化标记下显示特性，包含 R32 卡顿修复，基于 R31 的累积包。本地验证通过，未部署。见 [R33 说明](CARD_TRAITS_R33_20260920.md)。\n\n'+p.read_text(encoding='utf-8-sig'),encoding='utf-8')
with tarfile.open(a) as t:
 for ln in t.extractfile(name+'/SHA256SUMS').read().decode().splitlines():
  h,p=ln.split('  ',1);assert hashlib.sha256(t.extractfile(name+'/'+p).read()).hexdigest()==h
print(json.dumps({'sha256':sha,'files':len(m['files']),'tests':qa['testsPassed']}))
