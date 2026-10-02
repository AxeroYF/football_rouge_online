export function mergeRosterDelta(state,response) {
 if(response.state)return response.state;
 const patch=response.statePatch;
 if(!patch || patch.playerId!==state?.playerId)return state;
 const next={...state,...patch},delta=response.rosterDelta;
 if(delta&&state.draft){
  const cards=new Map(delta.cards.map(card=>[String(card.id),card]));
  const roster=state.draft.roster.map(card=>{const value=cards.get(String(card.id));cards.delete(String(card.id));return value??card;});
  next.draft={...state.draft,roster:[...roster,...cards.values()],counts:delta.counts,positionCounts:delta.positionCounts,pickNumber:delta.pickNumber};
 }
 return next;
}
