import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Read the archive as plain data. Never import its runtime or content stores.
const archive = 'D:/Project/game_test/.worktrees/Rougelite';
const out = 'outputs/card-art-archive-audit-20261116';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const registryPath = archive + '/assets/data/s4-player-profile-registry.json';
const registry = read(registryPath).profiles;
const audit = read('outputs/card-art-assessment-20261116/audit.json');
const players = read('outputs/card-art-assessment-20261116/effective-players.json');
const pilotIds = new Set(read('data/player-art-pilot-20261116.json').players.map(p => p.id));
const liveFiles = ['data/ydl-content-overrides.json', 'data/ydl-player-card-studio.json'];
const liveHashes = liveFiles.map(hash);
fs.mkdirSync(out + '/originals', {recursive:true});
const matches = audit.rows.filter(p => p.grade !== 'X' && registry[p.id]).map(p => {
  const original = registry[p.id];
  const sourceFile = archive + '/assets/player-profiles/' + original.fileName;
  assert.ok(fs.existsSync(sourceFile), 'Missing archive image: ' + p.id);
  return {id:p.id, name:p.name, grade:p.grade, currentHasArt:p.usable,
    inPilot:pilotIds.has(p.id), original, sourceFile, sha256:hash(sourceFile),
    sameCurrentBytes:p.usable ? hash(p.file) === hash(sourceFile) : false};
});
const recoverable = matches.filter(p => !p.currentHasArt);
const pilotOverlap = matches.filter(p => p.inPilot);
const toEntry = m => {
  const p = players.find(p => p.id === m.id);
  const imageFile = `${out}/originals/${m.id}.webp`;
  fs.copyFileSync(m.sourceFile, imageFile);
  assert.equal(hash(imageFile),m.sha256);
  return {id:p.id,name:p.name,sourceName:p.sourceName,grade:p.grade,overall:p.overall,
    role:p.role,club:p.club,nationality:p.nationality,imageFile,
    imageUrl:'data:image/webp;base64,'+fs.readFileSync(imageFile).toString('base64'),
    sha256:m.sha256,position:{xPercent:m.original.x,yPercent:m.original.y,widthPercent:m.original.width},
    source:{type:'existing-user-art',registry:registryPath,file:m.sourceFile,...m.original}};
};
const save = (name,value) => fs.writeFileSync(`${out}/${name}`,JSON.stringify(value,null,2)+'\n');
save('recoverable-batch.json',{schemaVersion:2,frame:'shield-v1',note:'34 existing user images; original positions retained for later manual shield adjustment. Not applied.',players:recoverable.map(toEntry)});
save('pilot-originals-batch.json',{schemaVersion:2,frame:'shield-v1',note:'Original alternatives for 9 pilot players, including Ederson already recovered before the pilot. Does not replace approved pilot images.',players:pilotOverlap.map(toEntry)});
const count = rows => rows.reduce((a,p) => (a[p.grade]=(a[p.grade]||0)+1,a),{});
const remaining = audit.missing.filter(p => p.grade !== 'X' && !registry[p.id]);
const report = {generatedAt:new Date().toISOString(),applied:false,registryPath,registrySha256:hash(registryPath),
  archiveProfiles:Object.keys(registry).length,currentNonXExactIdMatches:matches.length,
  currentMissingWithOriginals:count(recoverable),recoverableCount:recoverable.length,
  pilotOverlapCount:pilotOverlap.length,previouslyRecoveredEderson:'s4-fc26-210257',
  unnecessaryNewPilotSources:pilotOverlap.filter(p=>p.id!=='s4-fc26-210257').map(p=>({id:p.id,name:p.name,grade:p.grade})),
  stillNeedSourcing:count(remaining),stillNeedSourcingCount:remaining.length,
  recoverable,pilotOverlap,remaining:remaining.map(({id,name,sourceName,grade})=>({id,name,sourceName,grade})),
  nameOnlyMatchRejected:{oldId:'ydl-custom-f764a5de-a1f7-483f-86bd-dfec9520d573',oldSourceName:'Hugo Almeida',currentId:'s4-fc26-277797',currentSourceName:'Marcos Leonardo',reason:'Same Chinese display name, different people; do not transfer artwork.'}};
save('report.json',report);
const table = rows => rows.map(p=>`| ${p.grade} | ${p.name} | ${p.id} | ${p.original.sourceFileName??path.basename(p.original.fileName)} |`).join('\n');
fs.writeFileSync(`${out}/README.md`, `# game_test 旧卡画核查\n\n核查时间：2026-11-16。只读原项目，未修改当前生效卡画。X 不参与。\n\n## 结论\n\n莱奥确实已有用户上传的 Leao.png，记录时间为 2026-08-11T00:18:17.072Z；定位 x=47.6、y=54.2、width=186。原图 SHA-256：${registry['s4-fc26-241721'].contentHash}（注册表前缀）。\n\n旧注册表共有 386 条，其中 296 条与当前非 X 球员 ID 精确匹配，图片均存在。当前缺图的 34 人可以直接恢复：A 11、B 18、C 5。20 人试批与旧注册表重叠 9 人，其中埃德松已在试批时恢复，另 8 人是遗漏旧图后重新找图。合计漏查 42 人。\n\n49 份 game_test 注册表副本的 profiles 内容哈希一致；YFFM3 的莱奥图片哈希与本次原图一致。旧项目另有 90 个自定义 ID 不在当前名单；同中文名的阿尔梅达实为两位球员，不作迁移。\n\n恢复 34 人后，需继续找图的是 A 27、B 213、C 176，共 416 人。目前只是核查与准备，尚未恢复写入，因此运行时缺图仍为 450 人。\n\n## 当前缺图、可直接恢复的 34 人\n\n| 等级 | 球员 | ID | 原文件名 |\n| --- | --- | --- | --- |\n${table(recoverable)}\n\n## 20 人试批中已有原图的 9 人\n\n| 等级 | 球员 | ID | 原文件名 |\n| --- | --- | --- | --- |\n${table(pilotOverlap)}\n\n## 复用文件\n\n- recoverable-batch.json：34 人原图与原定位，适配现有定位工具，尚未写入。\n- pilot-originals-batch.json：9 人旧图对照，不覆盖已批准的试批效果。\n- originals/：43 张原始 WebP 的逐字节副本。\n- report.json：完整路径、哈希和修正后的找图清单。\n\n旧图恢复须只带入卡画，不导入旧球员总评、等级或玩法字段；原矩形卡面定位仅作为盾形调整起点。\n`);
assert.deepEqual(liveFiles.map(hash), liveHashes, 'Audit must not mutate live game data');
console.log(JSON.stringify({applied:false,recoverable:report.currentMissingWithOriginals,pilotOverlap:pilotOverlap.length,remaining:report.stillNeedSourcing,report:`${out}/README.md`}));
