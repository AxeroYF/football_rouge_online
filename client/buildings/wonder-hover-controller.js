import { MARITIME_MAX_RANGE_KM } from '../../shared/config/maritime.mjs';
import { facilityEffectText } from '../../shared/config/facility-levels.mjs';
import { goldAmountMarkup } from '../ui/currency.js';
import { resourceAmountMarkup } from "../resources/resource-markup.js?v=20260907-resource-hover-v1";

const facilityDescriptions={
 'oil-well':'只能建在有石油资源的地块。建成后每小时开采 3 单位石油，在线和离线均累积。单等级设施，不可升级。石油用于远征队与球探移动，也可交易。',
 'factory':'提升建设生产力。基础 4；丘陵 +3、森林 +2、山脉/沿海各 +1，地形合计上限 6。同地块与陆地相邻地块每座己方已建成设施 +1，港口/商店改为 +2；己方含油地块额外 +1，已建成油井作为设施再 +1，邻接合计上限 6。选址基础总和 × 等级，按球迷覆盖率折算；全队在建项目共享产能。工厂供油消耗 1 石油/小时；油井产出或可用库存能持续供油时，自身产出额外 +20%，断供后恢复基础产出。',
 'university':'提升科技研究能力。基础 4；山脉 +3、森林 +2、平原/沿海各 +1，地形合计上限 6。同地块与陆地相邻地块每座己方已建成设施 +1，总部/训练/医疗改为 +2，邻接合计上限 6。选址基础总和 × 等级，按球迷覆盖率折算。',

 'main-stadium':'承办俱乐部主场比赛，升级提升球场座位容量，为联赛主场容量提供标准。',
 'scout-center':'派遣球探发掘球员，升级可增加球探名额，并提高球员品质概率，发掘基础费用不变。',
 'training-center':'训练球员属性，每次训练分配 5 点成长；费用随球员总评提升，未完成取消全额退款。升级增加训练席位与核心属性倾向。',
 'medical-center':'安排受伤球员治疗，减少伤停回合。升级增加床位，并缩短治疗时间、降低费用。',
 'recovery-center':'加快辐射范围内己方及盟友远征队的体力恢复，升级扩大范围，多座重叠取最高速度。',
 'club-shop':'利用地块球迷覆盖产生金币收入，升级提高收入上限。',
 'port':`无港口航程 ${MARITIME_MAX_RANGE_KM} 公里。远距离跨海征服需在出发地建设港口；升级扩大航程并缩短海运时间，仅限沿海地块。`,
};
export function facilityHoverMarkup(entry,escapeHtml=String){
 return `<header><img src="${escapeHtml(entry.iconPath)}" alt=""><h3>${escapeHtml(entry.label)}</h3><button type="button" data-wonder-hover-close aria-label="关闭设施说明">×</button></header><section><h4>设施用途</h4><p>${escapeHtml(facilityDescriptions[entry.type]??'建设后为俱乐部提供配套服务。')}</p><p>占用 1 个建筑槽位${entry.maxPerPlayer?' · 每位玩家最多 '+entry.maxPerPlayer+' 座':''}${entry.coastalOnly?' · 仅限沿海地块':''}</p></section><section><h4>建设费用</h4><p>金币建造 ${goldAmountMarkup(entry.buildCostGold??entry.costsGold?.[0]??0)} · 立即建成</p><p>生产力建造 ${resourceAmountMarkup('production',entry.buildCostProduction??0)} · 按产能施工</p></section><section><h4>等级效果</h4><ul>${Array.from({length:entry.maxLevel??5},(_,i)=>`<li><b>LV${i+1}</b> ${escapeHtml(facilityEffectText(entry.type,i+1))}</li>`).join('')}</ul>${entry.maxLevel===1?'<p>单等级设施，不可升级。</p>':'<p>升级需满足对应的俱乐部总部等级。</p>'}</section>`;
}
export function wonderHoverMarkup(wonder, escapeHtml = String) {
  if(wonder.hoverKind==='facility')return facilityHoverMarkup(wonder,escapeHtml);
  return `<header><img src="${escapeHtml(wonder.iconPath)}" alt=""><h3>${escapeHtml(wonder.label)}</h3><button type="button" data-wonder-hover-close aria-label="关闭奇观说明">×</button></header>
    <section><h4>奇观效果</h4><p>${escapeHtml(wonder.effectText)}</p>${wonder.dependency ? `<p class="wonder-pending-system">待${escapeHtml(wonder.dependency)}开放后生效</p>` : ""}</section>
    <section><h4>建设要求</h4><p class="wonder-hover-production">生产力总需求 ${resourceAmountMarkup("production",wonder.construction.totalProduction)}</p><ul>${wonder.checks.map(c=>`<li>${c.met ? "✓" : "○"} ${escapeHtml(c.label)}</li>`).join("")}</ul></section>`;
}

export function createWonderHoverController({documentRef, content, getWonders, escapeHtml}) {
  const root = documentRef.querySelector("#wonder-hover");
  if (!root) return {beforeRender(){},update(){},close(){}};
  const viewport = documentRef.defaultView;
  let activeId = null, hideTimer = null, rendered = "", restoringFocus = false;
  const rows = () => [...content.querySelectorAll("[data-wonder-id]")];
  const anchor = () => rows().find(node=>node.dataset.wonderId===activeId);
  const stopHide = () => {viewport.clearTimeout(hideTimer);hideTimer=null;};
  function close() {
    stopHide();restoringFocus=false;activeId=null;root.hidden=true;
    for(const node of rows())node.querySelector("[data-wonder-info]")?.setAttribute("aria-expanded","false");
  }
  function position() {
    if(root.hidden)return;
    const row=anchor();if(!row)return close();
    const rect=row.getBoundingClientRect(), panel=documentRef.querySelector("#territory-inspector").getBoundingClientRect();
    if(rect.bottom<panel.top || rect.top>panel.bottom)return close();
    const width=Math.min(360,viewport.innerWidth-16);
    root.style.width=width+"px";root.style.maxHeight=(viewport.innerHeight-16)+"px";
    const height=root.getBoundingClientRect().height;
    const fitsRight=panel.right+12+width<=viewport.innerWidth-8;
    const left=fitsRight?panel.right+12:Math.max(8,Math.min(rect.left,viewport.innerWidth-width-8));
    const top=fitsRight?rect.top:(rect.bottom+8+height<=viewport.innerHeight-8?rect.bottom+8:rect.top-height-8);
    root.style.left=left+"px";root.style.top=Math.max(8,Math.min(top,viewport.innerHeight-height-8))+"px";
  }
  function update() {
    restoringFocus=false;
    if(!activeId)return;
    const wonder=getWonders().find(w=>(w.wonderId||w.type)===activeId);
    if(!wonder||!anchor())return close();
    const html=wonderHoverMarkup(wonder,escapeHtml);
    if(html!==rendered){const scroll=root.scrollTop;root.innerHTML=html;root.scrollTop=scroll;rendered=html;}
    root.hidden=false;
    for(const node of rows())node.querySelector("[data-wonder-info]")?.setAttribute("aria-expanded",String(node.dataset.wonderId===activeId));
    position();
  }
  function open(row) {stopHide();activeId=row.dataset.wonderId;update();}
  const scheduleHide=()=>{stopHide();hideTimer=viewport.setTimeout(close,160);};
  content.addEventListener("pointerover",event=>{if(event.pointerType==="touch")return;const row=event.target.closest?.("[data-wonder-id]");if(row)open(row);});
  content.addEventListener("pointerout",event=>{
    if(event.pointerType==="touch")return;
    const row=event.target.closest?.("[data-wonder-id]");
    if(row&&!row.contains(event.relatedTarget)&&!root.contains(event.relatedTarget))scheduleHide();
  });
  content.addEventListener("focusin",event=>{if(restoringFocus)return;const row=event.target.closest?.("[data-wonder-id]");if(row)open(row);});
  content.addEventListener("click",event=>{const info=event.target.closest?.("[data-wonder-info]");if(info)open(info.closest("[data-wonder-id]"));});
  root.addEventListener("pointerenter",stopHide);
  root.addEventListener("pointerleave",event=>{if(event.pointerType!=="touch")scheduleHide();});
  root.addEventListener("click",event=>{if(event.target.closest?.("[data-wonder-hover-close]"))close();});
  documentRef.addEventListener("pointerdown",event=>{if(!event.target.closest?.("[data-wonder-id]")&&!root.contains(event.target))close();},{capture:true});
  documentRef.addEventListener("focusin",event=>{if(!event.target.closest?.("[data-wonder-id]")&&!root.contains(event.target))close();});
  documentRef.addEventListener("keydown",event=>{if(event.key==="Escape"&&!root.hidden){close();event.preventDefault();event.stopPropagation();}},{capture:true});
  documentRef.addEventListener("scroll",position,true);
  viewport.addEventListener("resize",position);
  return {beforeRender(){restoringFocus=true;},update,close};
}
