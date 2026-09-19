import { NEUTRAL_REWARD_LABELS } from '../../shared/config/neutral-rewards.mjs';
import { SPONSOR_CONTRACT_TYPES, sponsorById } from '../../shared/config/sponsorship.mjs';
import { resourceIconMarkup } from './resource-markup.js';
export const rewardEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function neutralRewardMarkup(reward,{preview=true}={}){
 if(!reward)return '';
 const kind=reward.kind,icon=kind==='pack'?'<span aria-hidden="true">🎴</span>':resourceIconMarkup(kind==='research'?'science':kind);
 const note=kind==='production'?'获得后指定建设项目':kind==='research'?'投入正在进行的研究 · 余量保留':kind==='sponsorship'?
  (sponsorById(reward.contract?.sponsorId)?.name??'')+' · '+(SPONSOR_CONTRACT_TYPES[reward.contract?.type]?.name??'')+' · '+reward.contract?.durationDays+' 天 / 每小时 '+reward.contract?.hourlyGold+' 金币':'';
 return '<div class="neutral-reward"><small>'+(reward.source==='wonder-competition'?rewardEscape(reward.label)+' · 奇观建造返还':preview?'征服奖励':'已获得')+'</small><strong>'+icon+' +'+Number(reward.amount)+' '+rewardEscape(NEUTRAL_REWARD_LABELS[kind])+'</strong>'+(note?'<span>'+rewardEscape(note)+'</span>':'')+'</div>';
}
