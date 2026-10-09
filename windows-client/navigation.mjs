// Page usability must not wait for optional images or other load-event resources.
export function navigateUntilInteractive(window, url, {signal, timeoutMs=30000, onPhase=()=>{}}={}) {
  return new Promise((resolve,reject)=>{
    const contents=window.webContents;
    let settled=false;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);
      contents.removeListener('dom-ready',ready);contents.removeListener('did-fail-load',failed);
      contents.removeListener('render-process-gone',crashed);contents.removeListener('did-navigate',navigated);
      window.removeListener('closed',closed);signal?.removeEventListener('abort',aborted);
      error?reject(error):resolve();
    };
    const ready=()=>{if(new URL(contents.getURL()).origin===new URL(url).origin)finish();};
    const failed=(_event,code,description,_url,isMainFrame)=>{if(isMainFrame&&code!==-3)finish(Error('页面连接失败：'+description));};
    const crashed=()=>finish(Error('游戏页面意外退出，请重试'));
    const closed=()=>finish(Error('已关闭游戏窗口'));
    const aborted=()=>finish(signal.reason??Error('已取消连接'));
    const navigated=()=>onPhase('正在加载游戏程序…');
    const timer=setTimeout(()=>finish(Error('连接超过 30 秒，请重试或使用在线资源进入')),timeoutMs);
    contents.on('dom-ready',ready);contents.on('did-fail-load',failed);contents.on('render-process-gone',crashed);contents.on('did-navigate',navigated);
    window.on('closed',closed);signal?.addEventListener('abort',aborted,{once:true});
    if(signal?.aborted){aborted();return;}
    try{contents.loadURL(url).then(ready,error=>finish(error));}catch(error){finish(error);}
  });
}
