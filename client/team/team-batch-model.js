export const squadOf=(assignments,id)=>assignments?.[id]==='expedition'?'expedition':'garrison';
export function createBatchDraft(snapshot){
 let base=snapshot,assignments={...snapshot.assignments},history=[];
 const changes=()=>base.players.filter(p=>squadOf(assignments,p.id)!==squadOf(base.assignments,p.id)).map(p=>({playerId:p.id,squadId:squadOf(assignments,p.id)}));
 return {
  get base(){return base;},get assignments(){return assignments;},get canUndo(){return history.length>0;},changes,
  move(ids,squad){const allowed=new Set(base.players.filter(p=>!base.locks[p.id]).map(p=>p.id));const next={...assignments};for(const id of ids)if(allowed.has(id))next[id]=squad;
   if(JSON.stringify(next)===JSON.stringify(assignments))return;history.push(assignments);assignments=next;},
  undo(){if(history.length)assignments=history.pop();},
  reset(){assignments={...base.assignments};history=[];},
  revert(id){history.push(assignments);assignments={...assignments,[id]:squadOf(base.assignments,id)};},
  refresh(next){const pending=changes(),ids=new Set(next.players.map(p=>p.id));base=next;assignments={...next.assignments};history=[];const missing=[];
   for(const c of pending){if(ids.has(c.playerId))assignments[c.playerId]=c.squadId;else missing.push(c.playerId);}return missing;},
 };
}
