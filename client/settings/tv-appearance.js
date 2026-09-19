export const TV_OPTIONS=Object.freeze({
 pitchColor:[['green','经典绿'],['silver','浅灰']],
 pitchStyle:[['striped','纵向条纹'],['checker','棋盘草纹'],['plain','纯色草皮']],
 standStyle:[['none','无看台效果'],['classic','经典分层看台'],['steep','陡峭压迫看台'],['continuous','连续环形看台']],
 backgroundEffect:[['none','无背景效果'],['meteor','流星雨背景']],
});
export const TV_DEFAULTS=Object.freeze({pitchColor:'green',pitchStyle:'striped',standStyle:'classic',backgroundEffect:'none'});
export const tvStorageKey=id=>'yellowdogs-tv-appearance-v1:'+encodeURIComponent(id);
export function normalizeTvAppearance(value){return Object.fromEntries(Object.entries(TV_OPTIONS).map(([key,choices])=>[key,choices.some(([id])=>id===value?.[key])?value[key]:TV_DEFAULTS[key]]));}
export function readTvAppearance(storage,id){try{return normalizeTvAppearance(JSON.parse(storage.getItem(tvStorageKey(id))));}catch{return {...TV_DEFAULTS};}}
export function saveTvAppearance(storage,id,value){const settings=normalizeTvAppearance(value);storage.setItem(tvStorageKey(id),JSON.stringify(settings));return settings;}
let current={...TV_DEFAULTS};
export function meteorMarkup(){return Array.from({length:48},(_,i)=>`<i style="--meteor-x:${(i*47)%138-18}%;--meteor-y:${(i*31)%130-24}%;--meteor-delay:${-((i*37)%100)/10}s;--meteor-duration:${3.4+i%7*.42}s;--meteor-length:${46+i%6*12}px;--meteor-opacity:${.24+i%5*.1}"></i>`).join('');}
export function syncTvBackground(root){
 if(!root)return;let layer=root.querySelector(':scope > .tv-meteor-background');
 if(current.backgroundEffect!=='meteor'||root.hidden||root.closest('[hidden]')){layer?.remove();return;}
 if(!layer){layer=root.ownerDocument.createElement('div');layer.className='tv-meteor-background';layer.setAttribute('aria-hidden','true');layer.innerHTML=meteorMarkup();root.prepend(layer);}
}
export function applyTvAppearance(value,doc=document){
 current=normalizeTvAppearance(value);
 for(const [key,value] of Object.entries(current))doc.documentElement.dataset['tv'+key[0].toUpperCase()+key.slice(1)]=value;
 syncTvBackground(doc.querySelector('#campaign-broadcast'));syncTvBackground(doc.querySelector('.tv-settings-preview'));
 return {...current};
}
