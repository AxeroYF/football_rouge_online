// Independent request generations protect account switches, category switches,
// and rapid mail selection. Only the visible page and selected detail are held.
export function createInboxPager({getScope,request,onChange=()=>{},onError=()=>{}}) {
  let scope,sequence=0,detailSequence=0,state;
  const fresh=()=>({filter:{category:'all',unreadOnly:false},cursors:[null],index:0,anchor:null,page:null,meta:null,loading:false,error:null,
    selectedId:null,detail:null,detailRevision:null,detailLoading:false,detailError:null,attemptedRevision:null,busy:false});
  function ensure() { const next=getScope();if(next!==scope){scope=next;sequence++;detailSequence++;state=fresh();}return scope; }
  function meta(value) {if(value && (!state.meta || Number(value.revision)>=Number(state.meta.revision))) state.meta=value;}
  function current(started,seq,detail=false) {ensure();return scope===started && seq===(detail?detailSequence:sequence);}
  const emit=()=>onChange(state);
  async function load({reset=false}={}) {
    const started=ensure();if(reset){state.cursors=[null];state.index=0;state.anchor=null;}
    const seq=++sequence;state.loading=true;state.error=null;state.attemptedRevision=state.meta?.revision;emit();
    try {
      const result=await request('/inbox/list',{...state.filter,cursor:state.cursors[state.index],anchor:state.anchor});
      if(!current(started,seq))return;
      if(Number(result.meta?.revision)<Number(state.meta?.revision))return await load();
      state.page=result;state.anchor=result.anchor;meta(result.meta);state.attemptedRevision=state.meta?.revision;
      // Deleted last-page items should not strand the user on an empty page.
      if(!result.messages.length && state.index>0){state.index--;return await load();}
      const summary=result.messages.find(m=>m.id===state.selectedId);
      if(summary && state.detail && (summary.updatedAt!==state.detail.updatedAt || JSON.stringify(summary.action)!==JSON.stringify(state.detail.action))) void open(summary.id);
      else if(!summary && state.detail && Number(result.meta?.revision)>Number(state.detailRevision)) void open(state.selectedId);
    } catch(error) {if(current(started,seq)){state.error=error.message;onError(error);}}
    finally {if(current(started,seq)){state.loading=false;emit();}}
  }
  async function open(id, retry=false) {
    const started=ensure(),seq=++detailSequence;
    state.selectedId=id;state.detail=null;state.detailLoading=true;state.detailError=null;emit();
    try {
      const result=await request('/inbox/detail',{messageId:id});
      if(!current(started,seq,true))return;
      state.detail=result.message;state.detailRevision=result.meta?.revision;meta(result.meta);emit();
      if(!result.message.readAt || Number(result.message.updatedAt)>Number(result.message.readAt)) {
        const receipt=await request('/inbox/read',{messageId:id,expectedUpdatedAt:result.message.updatedAt ?? result.message.createdAt});
        if(!current(started,seq,true))return;
        meta(receipt.meta);
        if(receipt.stale){if(!retry)return await open(id,true);throw new Error('邮件刚刚更新，请重新打开');}
        state.detail.readAt=receipt.readAt;
        state.detailRevision=receipt.meta?.revision ?? state.detailRevision;
        const row=state.page?.messages.find(m=>m.id===id);if(row)row.readAt=receipt.readAt;
      }
    } catch(error) {if(current(started,seq,true)){state.detailError=error.message;onError(error);}}
    finally {if(current(started,seq,true)){state.detailLoading=false;emit();}}
  }
  return {
    get state(){ensure();return state;},
    sync(value){ensure();meta(value);},
    ensureLoaded(filter){ensure();if(JSON.stringify(filter)!==JSON.stringify(state.filter)){state.filter={...filter};state.page=null;state.error=null;state.selectedId=null;state.detail=null;state.detailLoading=false;state.detailError=null;detailSequence++;return void load({reset:true});}
      if(!state.loading && (!state.page || state.attemptedRevision!==state.meta?.revision) && !state.error)void load();},
    load,open,
    next(){ensure();if(state.loading||!state.page?.hasNext)return;state.cursors=state.cursors.slice(0,state.index+1);state.cursors.push(state.page.nextCursor);state.index++;void load();},
    previous(){ensure();if(state.loading||!state.index)return;state.index--;void load();},
    async select(operation){ensure();return request('/inbox/selection',{...state.filter,operation});},
    async mutate(path,body){const started=ensure();if(state.busy)return;state.busy=true;emit();
      try {const result=await request(path,body);if(started!==ensure())return;meta(result.meta);detailSequence++;state.selectedId=null;state.detail=null;state.detailLoading=false;state.detailError=null;await load({reset:true});return result;}
      finally {if(started===ensure()){state.busy=false;emit();}}},
  };
}
