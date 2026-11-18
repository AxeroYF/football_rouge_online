import fs from 'node:fs/promises';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Windows may temporarily deny replacing an open destination while another
// reader closes it. Keep the old committed file intact throughout the retry.
export async function replaceCommittedFile(temporary,destination,{rename=fs.rename,wait=sleep,maxRetries=8}={}){
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>50)throw new Error('原子替换重试上限无效');
  for(let attempt=0;;attempt++){
    try{await rename(temporary,destination);return;}
    catch(error){
      if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=maxRetries)throw error;
      await wait(Math.min(100,5*2**attempt));
    }
  }
}

// Initial publication must not replace an existing job. A Windows scanner may
// briefly hold the prepared directory; retry only while the final name is absent.
export async function publishPreparedDirectory(temporary,destination){
  await replaceCommittedFile(temporary,destination,{maxRetries:32,rename:async(from,to)=>{
    try{await fs.lstat(to);throw Object.assign(new Error('待发布目录已存在'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.rename(from,to);
  }});
}
