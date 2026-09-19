import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

// One-off local maintenance; no account credentials or other progress change.
export function resetTestBuildings(saved) {
  const accounts=Object.values(saved?.accounts ?? {}).filter(account=>account.nickname === "test");
  if(accounts.length !== 1) throw new Error("必须找到唯一的 test 账号");
  const account=accounts[0],world=saved.world;
  const home=world?.territories?.[account.homeTerritoryId];
  if(!home || home.ownerType !== "player" || home.ownerId !== account.id
    || !home.buildings?.some(building=>building.type === "main-stadium")) throw new Error("test 主场校验失败，停止清理");
  let removed=0,changedTerritories=0;
  for(const territory of Object.values(world.territories)) {
    if(territory.ownerType !== "player" || territory.ownerId !== account.id) continue;
    const buildings=territory.buildings ?? [];
    const kept=buildings.filter(building=>building.type === "main-stadium");
    const legacy=Object.hasOwn(territory,"scoutingCenter");
    if(kept.length === buildings.length && !legacy) continue;
    removed+=buildings.length-kept.length;
    territory.buildings=kept;
    delete territory.scoutingCenter;
    territory.version=Number(territory.version ?? 0)+1;
    changedTerritories++;
  }
  if(changedTerritories)world.revision=Number(world.revision ?? 0)+1;
  return {accountId:account.id,nickname:account.nickname,removed,changedTerritories};
}

async function assertServerStopped(port) {
  await new Promise((resolve,reject)=>{
    const socket=net.connect({host:"127.0.0.1",port});
    socket.setTimeout(1500);
    socket.once("connect",()=>{socket.destroy();reject(new Error(`请先在你的终端停止 ${port} 服务，避免旧内存存档覆盖清理结果`));});
    socket.once("error",error=>{socket.destroy();error.code === "ECONNREFUSED" ? resolve() : reject(error);});
    socket.once("timeout",()=>{socket.destroy();reject(new Error("无法确认服务已停止，未修改存档"));});
  });
}

export async function runReset({apply=false,savePath,port=4370}) {
  const original=fs.readFileSync(savePath);
  const saved=JSON.parse(original.toString("utf8"));
  const report=resetTestBuildings(saved);
  if(!apply || !report.changedTerritories)return {...report,applied:false};
  await assertServerStopped(port);
  if(!fs.readFileSync(savePath).equals(original))throw new Error("存档发生变化，请重新执行清理");
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const backupDir=path.join(path.dirname(savePath),"backups");
  fs.mkdirSync(backupDir,{recursive:true});
  const backup=path.join(backupDir,`test-buildings-before-${stamp}.json`);
  fs.writeFileSync(backup,original,{flag:"wx"});
  const temporary=savePath+`.reset-${process.pid}.tmp`;
  const descriptor=fs.openSync(temporary,"wx");
  try {fs.writeFileSync(descriptor,JSON.stringify(saved,null,2));fs.fsyncSync(descriptor);} finally {fs.closeSync(descriptor);}
  try {
    await assertServerStopped(port);
    if(!fs.readFileSync(savePath).equals(original))throw new Error("存档发生变化，已保留备份，未覆盖存档");
    fs.renameSync(temporary,savePath);
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return {...report,applied:true,backup};
}

if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  try {
    console.log(JSON.stringify(await runReset({apply:process.argv.includes("--apply"),
      savePath:path.join(root,"data/campaign-accounts.json"),port:Number(process.env.PORT ?? 4370)}),null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
