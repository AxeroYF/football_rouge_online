export function createDevelopmentFogController({button,getState,getRequest,campaignStore,onState,showToast}){
 let pending=false;
 function update(){const dev=getState()?.development;button.hidden=!dev?.enabled||!getState()?.setupComplete;button.disabled=pending;
  button.textContent=dev?.fogEnabled?'迷雾：开':'迷雾：关';button.setAttribute('aria-pressed',String(dev?.fogEnabled===true));
  button.title=dev?.fogEnabled?'关闭迷雾，查看全图':'恢复正常地图迷雾';
 }
 button.addEventListener('click',async()=>{
  if(pending||getState()?.development?.enabled!==true||!getState()?.setupComplete)return;const enabled=!getState()?.development?.fogEnabled;pending=true;update();
  try{const v=await getRequest()('/api/campaign/development/fog',{method:'POST',body:{enabled}});
   campaignStore.setState(v.state,{source:'development-fog'});onState(v.state);
  }catch(error){showToast(error.message);}finally{pending=false;update();}
 });
 campaignStore.subscribe(update);update();return {update};
}
