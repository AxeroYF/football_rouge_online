const labels={base:"默认站位",attack:"进攻落位",defense:"防守落位"};
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
export function createShapePreviewController({panel,request,getPayload,showToast,scheduleFrame=callback=>requestAnimationFrame(callback)}) {
  let version=0,snapshot=null;
  const pitch=()=>panel.querySelector("#league-tactics-pitch");
  function control(state,mode=null) {
    const node=panel.querySelector("[data-league-tactical-shape-preview]");if(!node)return;
    node.classList.toggle("is-active",state==="active");node.classList.toggle("is-loading",state==="loading");
    node.querySelectorAll("[data-league-tactical-shape-mode]").forEach(button=>{button.classList.toggle("active",button.dataset.leagueTacticalShapeMode===mode);});
    const label=node.querySelector("[data-league-tactical-shape-preview-label]");if(label)label.textContent=state==="loading"?"正在计算落位":labels[mode]??"选择落位预览";
  }
  function stop() {
    version++;
    pitch()?.querySelectorAll("[data-league-magnet]").forEach(node=>{const pos=snapshot?.get(node.dataset.leagueMagnet);if(pos){node.style.left=pos.left;node.style.top=pos.top;}node.classList.remove("is-tactical-shape-previewing");});
    snapshot=null;pitch()?.classList.remove("is-tactical-shape-previewing");pitch()?.querySelector("[data-league-tactical-shape-preview-overlay]")?.remove();control("idle");
  }
  async function select(mode) {
    if(!Object.hasOwn(labels,mode))return;
    stop();panel.querySelector("[data-league-tactical-shape-preview]")?.removeAttribute("open");
    if(mode==="base"){control("active",mode);return;}
    const current=version;control("loading",mode);
    try {
      const value=await request("/api/campaign/tactics/preview",{method:"POST",body:getPayload()});
      if(current!==version||panel.hidden)return;
      const target=value.tacticalShapePreview?.frames?.find(frame=>frame.id===mode),board=pitch();
      if(!board||!target)throw new Error("没有可播放的动态阵型数据");
      const nodes=[...board.querySelectorAll("[data-league-magnet]")];
      snapshot=new Map(nodes.map(node=>[node.dataset.leagueMagnet,{left:node.style.left,top:node.style.top}]));
      board.classList.add("is-tactical-shape-previewing");
      board.insertAdjacentHTML("afterbegin",`<div class="league-tactical-shape-preview-overlay" data-league-tactical-shape-preview-overlay data-phase="${mode}"><svg class="league-tactical-shape-preview-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="league-tactical-shape-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L5,2.5 L0,5 Z" fill="currentColor"></path></marker></defs>${target.players.map(player=>`<polyline class="${escapeHtml(player.genericRole)} ${escapeHtml(player.tacticalDuty)}" points="${player.basePosition.x},${player.basePosition.y} ${player.targetPosition.x},${player.targetPosition.y}" vector-effect="non-scaling-stroke"></polyline>`).join("")}</svg></div>`);
      nodes.forEach(node=>node.classList.add("is-tactical-shape-previewing"));control("active",mode);
      scheduleFrame(()=>scheduleFrame(()=>{
        if(current!==version||panel.hidden)return;
        const targets=new Map(target.players.map(player=>[player.id,player.targetPosition]));
        nodes.forEach(node=>{const pos=targets.get(node.dataset.leagueMagnet);if(pos){node.style.left=`${pos.x}%`;node.style.top=`${pos.y}%`;}});
      }));
    }catch(error){if(current===version){stop();showToast(error.message||"落位预览失败");}}
  }
  return {select,stop};
}
