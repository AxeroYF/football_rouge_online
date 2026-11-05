import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function startLocalServer({publicOnly = true, matchEngine = 'v3'} = {}) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const data=await mkdtemp(path.join(os.tmpdir(),'yffm1-http-'));
  const child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,APP_ENV:'test',APP_LABEL:'YFFM1 Test',VERSUS_HOST:'127.0.0.1',DEVTOOL_PORT:'0',VERSUS_PUBLIC_ONLY:publicOnly?'1':'0',YFFM_MATCH_ENGINE:matchEngine,YFFM_ADMIN_PASSWORD:'isolated-test-password-only',VERSUS_ACCOUNTS_PATH:path.join(data,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(data,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(data,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(data,'studio.json')}});
  let output='';
  const exit=new Promise(resolve=>child.once('exit',resolve));
  async function stop(){if(child.exitCode===null)child.kill();await exit;await rm(data,{recursive:true,force:true});}
  let timer;
  try {
    const url=await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Server startup timed out: '+output)),15000);
      child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match)resolve(match[0]);});
      child.stderr.on('data',chunk=>{output+=chunk;});
      child.once('error',reject);child.once('exit',code=>reject(new Error('Server exited: '+code+' '+output)));
    });
    clearTimeout(timer);return {url,stop};
  }catch(error){clearTimeout(timer);await stop();throw error;}
}
