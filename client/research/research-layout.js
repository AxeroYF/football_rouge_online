import { researchLevelsFor, researchLevelPreview } from '../../shared/config/research-preview.mjs';
// Each route belongs to exactly one selected object. Edges connect its successive levels only.
export function researchTreeLayout(topic){
 if(!topic)return {nodes:[],edges:[]};
 const nodes=researchLevelsFor(topic).map(level=>({...researchLevelPreview(topic,level),id:`${topic.id}:level:${level}`,topicId:topic.id}));
 return {nodes,edges:nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id}))};
}
