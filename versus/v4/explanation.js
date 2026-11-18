// Explicit decision links identify physical outcomes; coordination is context.
// No later outcome is used to rewrite why an earlier decision was made.
export function explainEvent(events,eventId,asOf=Infinity){
  const visible=events.filter(e=>e.time<=asOf+1e-7),event=visible.find(e=>e.id===eventId);
  if(!event)return null;
  const prior=visible.filter(e=>e.id<=event.id),decision=event.decisionId?prior.find(e=>e.id===event.decisionId):event.decision?event:null;
  const base=decision??event;
  const context=prior.filter(e=>e.id<base.id&&base.time-e.time<=12&&e.sequence?.possession===base.sequence?.possession&&e.sequence?.restart===base.sequence?.restart&&
    ['transition','overlapCoordination','pressCoordination','pressBeaten'].includes(e.type)).slice(-3);
  const node=(e,relation)=>({id:e.id,time:e.time,type:e.type,text:e.text,reason:e.reason,relation});
  return {eventId:event.id,plan:base.plan??null,context:context.map(e=>node(e,'context')),
    decision:decision?{...node(decision,'decision'),comparison:decision.decision?.comparison??decision.reason,candidates:structuredClone(decision.decision?.candidates??[])}:null,
    outcome:event.id!==decision?.id?node(event,event.decisionId?'physicalOutcome':'observedEvent'):null};
}
