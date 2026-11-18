const paths={home:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',cup:'M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 14v5m-4 2h8',squad:'M3 3h18v18H3ZM3 12h18M12 3v18m-3-6a3 3 0 1 0 6 0 3 3 0 1 0-6 0',live:'M3 6h18v15H3ZM8 2l4 4 4-4m-6 9 5 3-5 3Z',cards:'M4 5h12v16H4ZM8 2h12v16',club:'M3 21V9l9-6 9 6v12M7 21V11m5 10V11m5 10V11M2 21h20',market:'M3 4h18l-2 7H5ZM6 11v10h12V11m-8 10v-6h4v6',mail:'M3 5h18v14H3Zm0 0 9 8 9-8',stats:'M4 21V11h4v10m3 0V3h4v18m3 0v-7h4v7'};
export const uiIcon=name=>`<svg class="yffm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.home}"/></svg>`;
export const NAV_GROUPS=[
  {label:'核心赛场',items:[['overview','俱乐部主场','home'],['schedule','日程表','cup'],['cup','冠军杯','cup'],['predictions','比赛预测','stats'],['squad','阵容战术','squad'],['television','比赛电视台','live'],['stats','数据榜单','stats']]},
  {label:'球队与经营',items:[['players','球员信息','cards'],['backpack','背包收藏','cards'],['enhancement','球员强化','cards'],['club','俱乐部','club'],['shop','商店','market'],['market','交易市场','market'],['inbox','收件箱','mail']]},
];
export function clubNavMarkup(tab,unread=0,live=false){
 return `<nav class="league-nav" id="league-primary-nav" aria-label="游戏导航">${NAV_GROUPS.map(g=>`<div class="yffm-nav-group"><small>${g.label}</small>${g.items.map(([id,label,icon])=>`<button type="button" class="${tab===id?'active':''}" data-league-tab="${id}" title="${label}" aria-label="${label}" ${tab===id?'aria-current="page"':''}>${uiIcon(icon)}<b>${label}</b>${id==='inbox'&&unread?`<span class="nav-count">${unread}</span>`:id==='television'&&live?'<span class="league-nav-live-badge">LIVE</span>':''}</button>`).join('')}</div>`).join('')}</nav>`;
}
export function clubMobileNavMarkup(tab){
 const group=id=>id==='schedule'?['schedule','cup','predictions','stats'].includes(tab):id==='club'?['club','players','backpack','enhancement','shop','market','inbox'].includes(tab):id===tab;
 return `<nav class="yffm-bottom-nav" aria-label="手机主导航">${[['overview','主场','home'],['schedule','赛事','cup'],['squad','阵容','squad'],['television','直播','live'],['club','俱乐部','club']].map(([id,label,icon])=>`<button type="button" data-league-tab="${id}" class="${group(id)?'active':''}">${uiIcon(icon)}<span>${label}</span></button>`).join('')}</nav>`;
}
export function clubSubnavMarkup(tab){
 const ids=['schedule','cup','predictions','stats'].includes(tab)?['schedule','cup','predictions','stats']:['players','backpack','enhancement'].includes(tab)?['players','backpack','enhancement']:['club','shop','market','inbox'].includes(tab)?['club','shop','market','inbox']:[];
 return `<nav class="yffm-subnav" aria-label="相关页面">${ids.map(id=>{const item=NAV_GROUPS.flatMap(g=>g.items).find(i=>i[0]===id);return `<button type="button" data-league-tab="${id}" class="${tab===id?'active':''}">${item[1]}</button>`;}).join('')}</nav>`;
}
