import {TV_OPTIONS,TV_DEFAULTS,readTvAppearance,saveTvAppearance,applyTvAppearance,syncTvBackground} from './tv-appearance.js?v=20260908-tv-v1';
import {registerStandardWindow,activateStandardWindow,deactivateStandardWindow} from '../ui/standard-window.js';
const labels={pitchColor:'草皮颜色',pitchStyle:'草皮样式',standStyle:'看台样式',backgroundEffect:'电视台背景'};
export function createTvSettingsController({root,trigger,getState,campaignStore,beforeOpen=()=>{},storage=window.localStorage}){
 let playerId=null,settings={...TV_DEFAULTS};
 root.innerHTML=`<section class="standard-window__surface tv-settings-surface"><header><div><small>设置</small><h1>电视台外观</h1></div><button type="button" data-stage-window-close aria-label="关闭电视台设置">×</button></header><div class="tv-settings-body"><form class="tv-settings-controls">${Object.entries(TV_OPTIONS).map(([key,choices])=>`<label>${labels[key]}<select name="${key}">${choices.map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>`).join('')}<p>选择后立即生效，当前浏览器按账号记住。</p><button type="button" data-tv-reset>恢复默认</button><p data-tv-status role="status"></p></form><div class="tv-settings-preview"><div class="broadcast-v2-field-column"><h2>球场预览</h2><div class="broadcast-v2-stadium"><div class="broadcast-v2-pitch"><div class="tv-preview-lines"><span></span><i></i><b></b><em></em></div></div></div></div></div></div></section>`;
 const status=root.querySelector('[data-tv-status]');
 function controls(){for(const [key,value] of Object.entries(settings))root.querySelector(`[name="${key}"]`).value=value;}
 function close(){root.hidden=true;root.querySelector('.tv-meteor-background')?.remove();deactivateStandardWindow(root);trigger.setAttribute('aria-expanded','false');}
 function update(){const state=getState();trigger.hidden=!state?.setupComplete;const nextId=state?.setupComplete?state.playerId:null;if(playerId===nextId)return;close();playerId=nextId;settings=playerId?readTvAppearance(storage,playerId):{...TV_DEFAULTS};applyTvAppearance(settings);controls();}
 function save(next){try{settings=saveTvAppearance(storage,playerId,next);applyTvAppearance(settings);controls();status.textContent='已保存';}catch{controls();status.textContent='无法保存设置，请检查浏览器存储权限后重试。';}}
 trigger.addEventListener('click',()=>{if(!playerId||!getState()?.setupComplete)return;beforeOpen();controls();status.textContent='';activateStandardWindow(root);trigger.setAttribute('aria-expanded','true');syncTvBackground(root.querySelector('.tv-settings-preview'));});
 root.addEventListener('change',event=>{if(event.target.matches('select'))save({...settings,[event.target.name]:event.target.value});});
 root.querySelector('form').addEventListener('submit',event=>event.preventDefault());root.querySelector('[data-tv-reset]').addEventListener('click',()=>save(TV_DEFAULTS));
 registerStandardWindow(root,{onRequestClose:close});campaignStore.subscribe(update);update();return {close};
}
